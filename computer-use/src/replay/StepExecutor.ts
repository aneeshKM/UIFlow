import type {
  ArtifactTarget,
  CapabilityStep,
  CheckpointCondition,
  InputDefinition,
  LocatorHint,
} from "../artifact/types.js";
import type { ActionResult, LocatorSpec } from "../browser/types.js";
import { InputResolver, InputValidationError } from "./InputResolver.js";
import type {
  ReplayBrowserActions,
  ReplayFailure,
  ReplaySurfaceObserver,
  RuntimeInputs,
  RuntimeOutputs,
  StepExecutionResult,
} from "./types.js";

function toLocatorSpec(hint: LocatorHint): LocatorSpec {
  if ("role" in hint) return { strategy: "role", role: hint.role, name: hint.name };
  if ("label" in hint) return { strategy: "label", label: hint.label };
  if ("text" in hint) return { strategy: "text", text: hint.text };
  if ("placeholder" in hint) return { strategy: "placeholder", placeholder: hint.placeholder };
  return { strategy: "testId", testId: hint.testId };
}

function targetCandidates(target: ArtifactTarget): LocatorSpec[] {
  const { fallbacks = [], ...primary } = target;
  return [toLocatorSpec(primary as LocatorHint), ...fallbacks.map(toLocatorSpec)];
}

function hasOutput(outputs: RuntimeOutputs, name: string): boolean {
  if (!Object.prototype.hasOwnProperty.call(outputs, name)) return false;
  const value = outputs[name];
  return value !== undefined && value !== null && value !== "";
}

function urlMatches(observed: string, expected: string): boolean {
  if (observed === expected || observed.includes(expected)) return true;
  try {
    return new URL(observed).pathname === expected;
  } catch {
    return false;
  }
}

export class StepExecutor {
  constructor(
    private readonly actions: ReplayBrowserActions,
    private readonly observer: ReplaySurfaceObserver,
    private readonly inputResolver: InputResolver,
    private readonly inputDefinitions: InputDefinition[],
  ) {}

  async execute(
    step: CapabilityStep,
    inputs: RuntimeInputs,
    outputs: RuntimeOutputs,
    baseUrl: string,
  ): Promise<StepExecutionResult> {
    try {
      let result: StepExecutionResult;
      switch (step.action) {
        case "navigate": {
          const value = this.inputResolver.resolve(step.value, inputs, this.inputDefinitions);
          let url: string;
          try {
            url = new URL(value, baseUrl).toString();
          } catch {
            return this.failure(step.id, "ACTION_FAILED", `Navigation value is not a valid URL: ${value}`, value);
          }
          if (new URL(url).origin !== new URL(baseUrl).origin) {
            return this.failure(
              step.id,
              "ACTION_FAILED",
              `Navigation outside ${new URL(baseUrl).origin} is blocked by replay policy.`,
              new URL(baseUrl).origin,
              new URL(url).origin,
            );
          }
          result = await this.executeAction(step, undefined, (timeoutMs) => this.actions.navigate(url, timeoutMs));
          break;
        }
        case "click":
          result = await this.executeTargetAction(step, step.target, (target, timeoutMs) =>
            this.actions.click(target, timeoutMs));
          break;
        case "type": {
          const value = this.inputResolver.resolve(step.value, inputs, this.inputDefinitions);
          result = await this.executeTargetAction(step, step.target, (target, timeoutMs) =>
            this.actions.fill(target, value, timeoutMs));
          break;
        }
        case "extract": {
          const extraction = await this.executeTargetAction<string>(step, step.target, (target, timeoutMs) =>
            this.actions.readText(target, timeoutMs));
          if (extraction.status === "failure") return extraction;
          const text = extraction.data;
          let extracted = text;
          if (step.pattern !== undefined) {
            let match: RegExpMatchArray | null;
            try {
              match = text.match(new RegExp(step.pattern));
            } catch (error) {
              return this.failure(
                step.id,
                "ACTION_FAILED",
                `Extraction pattern is invalid: ${error instanceof Error ? error.message : String(error)}`,
                step.pattern,
                text,
              );
            }
            if (!match) {
              return this.failure(
                step.id,
                "ACTION_FAILED",
                `Extracted text did not match the declared pattern for output "${step.output}".`,
                step.pattern,
                text,
              );
            }
            extracted = match[1] ?? match[0];
          }
          outputs[step.output] = extracted;
          result = { status: "success", output: { name: step.output, value: extracted } };
          break;
        }
        case "wait_for":
          result = await this.executeTargetAction(step, step.target, (target, timeoutMs) =>
            this.actions.waitFor(target, "visible", timeoutMs));
          break;
        case "assert": {
          const assertion = await this.evaluateCondition(step.condition, outputs, step.timeoutMs);
          if (!assertion.success) {
            return this.failure(step.id, "ACTION_FAILED", assertion.message, step.condition, assertion.observed);
          }
          result = { status: "success" };
          break;
        }
      }

      if (result.status === "failure") return result;
      if (step.expected.kind !== "action_succeeds") {
        const expected = await this.evaluateCondition(step.expected, outputs, step.timeoutMs);
        if (!expected.success) {
          return this.failure(step.id, "ACTION_FAILED", expected.message, step.expected, expected.observed);
        }
      }
      return result;
    } catch (error) {
      if (error instanceof InputValidationError) {
        return this.failure(step.id, "INVALID_INPUT", error.message);
      }
      return this.failure(
        step.id,
        "ACTION_FAILED",
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  private async executeAction(
    step: CapabilityStep,
    expected: unknown,
    operation: (timeoutMs: number) => Promise<ActionResult>,
  ): Promise<StepExecutionResult> {
    let actionResult = await operation(step.timeoutMs);
    if (!actionResult.success && this.isRecoverable(actionResult)) {
      await this.refreshObservation();
      actionResult = await operation(step.timeoutMs);
    }
    if (actionResult.success) return { status: "success" };
    return this.actionFailure(step.id, actionResult, expected);
  }

  private async executeTargetAction<T = undefined>(
    step: CapabilityStep,
    target: ArtifactTarget,
    operation: (target: LocatorSpec, timeoutMs: number) => Promise<ActionResult<T>>,
  ): Promise<({ status: "success"; data: T } | ReplayFailure)> {
    let lastResult: ActionResult<T> | undefined;
    const candidates = targetCandidates(target);

    for (let attempt = 0; attempt < 2; attempt += 1) {
      for (const candidate of candidates) {
        lastResult = await operation(candidate, step.timeoutMs);
        if (lastResult.success) return { status: "success", data: lastResult.data as T };
        if (!this.isRecoverable(lastResult)) return this.actionFailure(step.id, lastResult, target);
      }
      if (attempt === 0) await this.refreshObservation();
    }

    return this.actionFailure(step.id, lastResult!, target);
  }

  private async refreshObservation(): Promise<void> {
    try {
      await this.observer.observe();
    } catch {
      // The retry itself produces the actionable browser failure.
    }
  }

  private isRecoverable(result: ActionResult<unknown>): boolean {
    return result.error?.type === "ELEMENT_NOT_FOUND" || result.error?.type === "ACTION_TIMEOUT";
  }

  private actionFailure(stepId: string, result: ActionResult<unknown>, expected: unknown): ReplayFailure {
    const errorType = result.error?.type;
    if (errorType === "ELEMENT_NOT_FOUND") {
      return this.failure(stepId, "LOCATOR_NOT_FOUND", result.error?.message ?? "Locator was not found.", expected);
    }
    if (errorType === "ACTION_TIMEOUT") {
      return this.failure(stepId, "TIMEOUT", result.error?.message ?? "Browser action timed out.", expected);
    }
    return this.failure(stepId, "ACTION_FAILED", result.error?.message ?? "Browser action failed.", expected);
  }

  private async evaluateCondition(
    condition: CheckpointCondition,
    outputs: RuntimeOutputs,
    timeoutMs: number,
  ): Promise<{ success: true } | { success: false; message: string; observed?: unknown }> {
    if (condition.kind === "output_present") {
      return hasOutput(outputs, condition.output)
        ? { success: true }
        : { success: false, message: `Output "${condition.output}" is missing.`, observed: outputs };
    }

    if (condition.kind === "url_matches") {
      const observation = await this.observer.observe();
      return urlMatches(observation.url, condition.value)
        ? { success: true }
        : { success: false, message: `URL does not match "${condition.value}".`, observed: observation.url };
    }

    for (const candidate of targetCandidates(condition.target)) {
      const result = await this.actions.isVisible(candidate, timeoutMs);
      if (result.success && result.data === true) return { success: true };
    }
    return { success: false, message: "Expected target is not visible.", observed: false };
  }

  private failure(
    stepId: string,
    code: ReplayFailure["code"],
    message: string,
    expected?: unknown,
    observed?: unknown,
  ): ReplayFailure {
    return {
      status: "failure",
      code,
      stepId,
      ...(expected === undefined ? {} : { expected }),
      ...(observed === undefined ? {} : { observed }),
      message,
    };
  }
}
