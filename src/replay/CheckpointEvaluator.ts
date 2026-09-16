import type { Checkpoint, CheckpointCondition, LocatorHint } from "../artifact/types.js";
import type { LocatorSpec } from "../browser/types.js";
import type {
  CheckpointResult,
  ReplayBrowserActions,
  ReplaySurfaceObserver,
  RuntimeOutputs,
} from "./types.js";

function toLocatorSpec(hint: LocatorHint): LocatorSpec {
  if ("role" in hint) return { strategy: "role", role: hint.role, name: hint.name };
  if ("label" in hint) return { strategy: "label", label: hint.label };
  if ("text" in hint) return { strategy: "text", text: hint.text };
  if ("placeholder" in hint) return { strategy: "placeholder", placeholder: hint.placeholder };
  return { strategy: "testId", testId: hint.testId };
}

function hasOutput(outputs: RuntimeOutputs, name: string): boolean {
  const value = outputs[name];
  return Object.prototype.hasOwnProperty.call(outputs, name)
    && value !== undefined
    && value !== null
    && value !== "";
}

export class CheckpointEvaluator {
  constructor(
    private readonly actions: ReplayBrowserActions,
    private readonly observer: ReplaySurfaceObserver,
    private readonly timeoutMs = 10_000,
  ) {}

  async evaluate(checkpoint: Checkpoint, outputs: RuntimeOutputs): Promise<CheckpointResult> {
    const results: CheckpointResult[] = [];
    for (const condition of checkpoint.conditions) {
      results.push(await this.evaluateCondition(condition, outputs));
    }

    const success = checkpoint.type === "all"
      ? results.every((result) => result.success)
      : results.some((result) => result.success);
    if (success) return { success: true };

    const failures = results.filter((result): result is Extract<CheckpointResult, { success: false }> =>
      !result.success);
    return {
      success: false,
      expected: checkpoint,
      observed: failures.map(({ observed, message }) => ({ observed, message })),
      message: `Final checkpoint (${checkpoint.type}) was not satisfied.`,
    };
  }

  async evaluateCondition(condition: CheckpointCondition, outputs: RuntimeOutputs): Promise<CheckpointResult> {
    if (condition.kind === "output_present") {
      return hasOutput(outputs, condition.output)
        ? { success: true }
        : {
            success: false,
            expected: condition,
            observed: outputs,
            message: `Required output "${condition.output}" is missing.`,
          };
    }

    if (condition.kind === "url_matches") {
      const observation = await this.observer.observe();
      const matches = observation.url === condition.value || observation.url.includes(condition.value);
      return matches
        ? { success: true }
        : {
            success: false,
            expected: condition,
            observed: observation.url,
            message: `Observed URL does not match "${condition.value}".`,
          };
    }

    const { fallbacks = [], ...primary } = condition.target;
    for (const hint of [primary as LocatorHint, ...fallbacks]) {
      const result = await this.actions.isVisible(toLocatorSpec(hint), this.timeoutMs);
      if (result.success && result.data === true) return { success: true };
    }
    return {
      success: false,
      expected: condition,
      observed: false,
      message: "Required target is not visible.",
    };
  }
}
