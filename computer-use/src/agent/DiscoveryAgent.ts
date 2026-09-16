import type { ActionResult, LocatorSpec, SurfaceObservation } from "../browser/types.js";
import { evidenceWriter } from "../evidence/EvidenceWriter.js";
import {
  isSensitiveKey,
  redactObservation,
  redactValue,
  sanitizeDecisionSummary,
} from "../evidence/Redactor.js";
import type { ActionPolicy } from "../policy/ActionPolicy.js";
import { PolicyViolation } from "../policy/ActionPolicy.js";
import type {
  InterventionDetails,
  InterventionHandler,
  InterventionReason,
} from "../escalation/types.js";
import { classifyApplicationState } from "../outcomes/classifyApplicationState.js";
import { DiscoveryRunState } from "./runState.js";
import type {
  ActionExecutionResult,
  AgentDecision,
  AgentModel,
  AgentRunStatus,
  AgentStep,
  AgentTarget,
  DiscoveryEvidencePaths,
  DiscoveryRun,
} from "./types.js";

export interface DiscoveryBrowserActions {
  navigate(url: string): Promise<ActionResult>;
  click(target: LocatorSpec): Promise<ActionResult>;
  fill(target: LocatorSpec, value: string): Promise<ActionResult>;
  readText(target: LocatorSpec): Promise<ActionResult<string>>;
  waitFor(target: LocatorSpec): Promise<ActionResult>;
  wait(durationMs?: number): Promise<ActionResult>;
}

export interface DiscoverySurfaceObserver {
  observe(): Promise<SurfaceObservation>;
  captureScreenshot(): Promise<Buffer>;
}

export interface DiscoveryAgentOptions {
  maxSteps: number;
  runTimeoutMs: number;
  stallLimit?: number;
  runId?: string;
  evidencePaths?: DiscoveryEvidencePaths;
  startedAt?: Date;
  waitDurationMs?: number;
  onStep?: (step: AgentStep) => void | Promise<void>;
  now?: () => Date;
  interventionManager?: InterventionHandler;
  maxInterventions?: number;
}

class DiscoveryTimeoutError extends Error {
  constructor() {
    super("Discovery timed out.");
    this.name = "DiscoveryTimeoutError";
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isModelTimeout(error: unknown): boolean {
  return typeof error === "object"
    && error !== null
    && "code" in error
    && (error as { code?: unknown }).code === "timeout";
}

function observationFingerprint(observation: SurfaceObservation): string {
  return `${observation.url}\n${observation.ariaSnapshot}\n${observation.visibleText}`;
}

function surfaceContentFingerprint(observation: SurfaceObservation): string {
  return `${observation.title}\n${observation.ariaSnapshot}\n${observation.visibleText}`;
}

function isStaleRouteTransition(
  previous: SurfaceObservation | undefined,
  current: SurfaceObservation,
  decision: AgentDecision | undefined,
  result: ActionExecutionResult | undefined,
): boolean {
  return previous !== undefined
    && result?.success === true
    && (decision?.action === "click" || decision?.action === "navigate")
    && previous.url !== current.url
    && surfaceContentFingerprint(previous) === surfaceContentFingerprint(current);
}

function repeatedActionSignature(decision: AgentDecision, currentUrl: string): string | undefined {
  if (!["click", "type", "navigate", "wait"].includes(decision.action)) return undefined;
  return JSON.stringify({
    url: currentUrl,
    action: decision.action,
    target: decision.target ?? null,
    value: decision.value ?? null,
  });
}

export function redactDiscoveryRun(run: DiscoveryRun): DiscoveryRun {
  const safeRun = redactValue(run) as DiscoveryRun;
  for (const step of safeRun.steps) {
    const decision = step.decision;
    step.observation.ariaSnapshot = redactObservation(step.observation.ariaSnapshot);
    step.observation.visibleText = redactObservation(step.observation.visibleText);
    if (decision !== undefined) {
      decision.decisionSummary = sanitizeDecisionSummary(decision.decisionSummary);
    }
    const targetName = `${decision?.target?.name ?? ""} ${decision?.target?.text ?? ""}`;
    if (decision?.value !== undefined && isSensitiveKey(targetName)) {
      decision.value = "[REDACTED]";
    }
  }
  return safeRun;
}

function targetToLocator(target: AgentTarget): LocatorSpec {
  if (target.role !== undefined) {
    return { strategy: "role", role: target.role, ...(target.name === undefined ? {} : { name: target.name }) };
  }
  if (target.text !== undefined) return { strategy: "text", text: target.text };
  throw new Error("The policy accepted a target that cannot be resolved.");
}

function fromBrowserResult(
  action: AgentDecision["action"],
  result: ActionResult<unknown>,
): ActionExecutionResult {
  return {
    success: result.success,
    action,
    ...(typeof result.data === "string" ? { value: result.data } : {}),
    ...(result.error === undefined
      ? {}
      : { error: { type: result.error.type, message: result.error.message } }),
  };
}

async function withAbort<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) throw new DiscoveryTimeoutError();
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => reject(new DiscoveryTimeoutError());
    signal.addEventListener("abort", onAbort, { once: true });
    operation.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

export class DiscoveryAgent {
  private readonly now: () => Date;

  constructor(
    private readonly model: AgentModel,
    private readonly observer: DiscoverySurfaceObserver,
    private readonly actions: DiscoveryBrowserActions,
    private readonly policy: ActionPolicy,
    private readonly options: DiscoveryAgentOptions,
  ) {
    if (!Number.isInteger(options.maxSteps) || options.maxSteps < 1) {
      throw new Error("maxSteps must be a positive integer.");
    }
    if (!Number.isFinite(options.runTimeoutMs) || options.runTimeoutMs < 1) {
      throw new Error("runTimeoutMs must be positive.");
    }
    if (options.stallLimit !== undefined
      && (!Number.isInteger(options.stallLimit) || options.stallLimit < 1)) {
      throw new Error("stallLimit must be a positive integer.");
    }
    if (options.maxInterventions !== undefined
      && (!Number.isInteger(options.maxInterventions) || options.maxInterventions < 0)) {
      throw new Error("maxInterventions must be a non-negative integer.");
    }
    this.now = options.now ?? (() => new Date());
  }

  async run(goal: string): Promise<DiscoveryRun> {
    const trimmedGoal = goal.trim();
    if (!trimmedGoal) throw new Error("Discovery goal must not be empty.");

    const state = new DiscoveryRunState(trimmedGoal, this.options.runId, this.now, this.options.startedAt);
    let controller = new AbortController();
    let timeout = this.startTimeout(controller);
    let stepLimit = this.options.maxSteps;
    const stallLimit = this.options.stallLimit ?? 2;
    let lastObservationFingerprint: string | undefined;
    let lastSettledObservation: SurfaceObservation | undefined;
    let repeatedObservationCount = 0;
    let loadingRetries = 0;
    const repeatedActions = new Map<string, number>();

    const intervene = async (
      reason: InterventionReason,
      message: string,
      stepId?: string,
      stepIndex?: number,
    ): Promise<"resume" | "abort" | "unavailable" | "error"> => {
      if (this.options.interventionManager === undefined) return "unavailable";
      if (state.interventionCount >= (this.options.maxInterventions ?? 3)) return "unavailable";
      clearTimeout(timeout);
      controller.abort();
      const details: InterventionDetails = {
        runId: state.runId,
        source: "discovery",
        goal: trimmedGoal,
        ...(stepId === undefined ? {} : { stepId }),
        ...(stepIndex === undefined ? {} : { stepIndex }),
        reason,
        message,
      };
      try {
        const outcome = await this.options.interventionManager.requestIntervention(details);
        state.recordIntervention();
        if (outcome.resolution.action === "ABORT") return "abort";
        controller = new AbortController();
        timeout = this.startTimeout(controller);
        lastObservationFingerprint = undefined;
        lastSettledObservation = undefined;
        repeatedObservationCount = 0;
        loadingRetries = 0;
        repeatedActions.clear();
        return "resume";
      } catch {
        return "error";
      }
    };

    try {
      for (;;) {
        if (state.currentStep >= stepLimit) {
          const resolution = await intervene(
            "AGENT_STUCK",
            `Discovery reached its ${this.options.maxSteps}-step limit without finishing.`,
            undefined,
            state.currentStep,
          );
          if (resolution === "resume") {
            stepLimit += this.options.maxSteps;
            continue;
          }
          if (resolution === "abort") return this.complete(state, "failure", "human_aborted");
          if (resolution === "error") return this.complete(state, "failure", "intervention_error");
          return this.complete(state, "stopped", "max_steps");
        }

        let observation: SurfaceObservation;
        try {
          observation = await withAbort(this.observer.observe(), controller.signal);
          if (isStaleRouteTransition(
            lastSettledObservation,
            observation,
            state.lastDecision,
            state.lastResult,
          )) {
            const waitResult = await withAbort(
              this.actions.wait(this.options.waitDurationMs ?? 500),
              controller.signal,
            );
            if (!waitResult.success) {
              return this.complete(
                state,
                "failure",
                `route_transition_wait_failed: ${waitResult.error?.message}`,
              );
            }
            observation = await withAbort(this.observer.observe(), controller.signal);
            if (isStaleRouteTransition(
              lastSettledObservation,
              observation,
              state.lastDecision,
              state.lastResult,
            )) {
              const resolution = await intervene(
                "AGENT_TIMEOUT",
                "The application URL changed, but the observable UI did not update after one bounded retry.",
              );
              if (resolution === "resume") continue;
              if (resolution === "abort") return this.complete(state, "failure", "human_aborted");
              if (resolution === "error") return this.complete(state, "failure", "intervention_error");
              return this.complete(state, "stopped", "route_transition_timeout");
            }
          }
        } catch (error) {
          if (error instanceof DiscoveryTimeoutError || controller.signal.aborted) {
            const resolution = await intervene("AGENT_TIMEOUT", "Discovery timed out while observing the browser.");
            if (resolution === "resume") continue;
            if (resolution === "abort") return this.complete(state, "failure", "human_aborted");
            if (resolution === "error") return this.complete(state, "failure", "intervention_error");
          }
          return this.complete(
            state,
            error instanceof DiscoveryTimeoutError ? "stopped" : "failure",
            error instanceof DiscoveryTimeoutError ? "timeout" : `observation_error: ${errorMessage(error)}`,
          );
        }

        const step = state.recordObservation(observation);
        lastSettledObservation = observation;
        const applicationState = classifyApplicationState(observation);
        if (applicationState.kind === "business_outcome") {
          state.setBusinessOutcome(applicationState.outcome);
          return this.complete(state, "business_outcome", undefined);
        }
        if (applicationState.kind === "session_expired") {
          await this.reportStep(step);
          return this.complete(state, "failure", "session_expired");
        }
        if (applicationState.kind === "known_app_error") {
          await this.reportStep(step);
          return this.complete(state, "failure", `application_error: ${applicationState.message}`);
        }
        if (applicationState.kind === "loading") {
          if (loadingRetries >= 1) {
            const resolution = await intervene(
              "AGENT_TIMEOUT",
              "The application remained in a transient loading state after one bounded retry.",
              undefined,
              step.step,
            );
            if (resolution === "resume") continue;
            if (resolution === "abort") return this.complete(state, "failure", "human_aborted");
            if (resolution === "error") return this.complete(state, "failure", "intervention_error");
            return this.complete(state, "stopped", "loading_timeout");
          }
          loadingRetries += 1;
          const decision: AgentDecision = {
            action: "wait",
            decisionSummary: "The observable UI is still loading, so a short bounded wait is appropriate.",
          };
          state.recordDecision(step, decision);
          const result = fromBrowserResult(
            "wait",
            await withAbort(this.actions.wait(this.options.waitDurationMs ?? 500), controller.signal),
          );
          state.recordResult(step, result);
          await this.reportStep(step);
          if (!result.success) return this.complete(state, "failure", `loading_wait_failed: ${result.error?.message}`);
          continue;
        }
        loadingRetries = 0;

        const fingerprint = observationFingerprint(observation);
        if (fingerprint === lastObservationFingerprint) {
          repeatedObservationCount += 1;
        } else {
          lastObservationFingerprint = fingerprint;
          repeatedObservationCount = 1;
        }
        if (repeatedObservationCount > stallLimit) {
          const resolution = await intervene(
            "AGENT_STUCK",
            `Discovery observed the same settled browser state ${repeatedObservationCount} times without progress.`,
            undefined,
            step.step,
          );
          if (resolution === "resume") continue;
          if (resolution === "abort") return this.complete(state, "failure", "human_aborted");
          if (resolution === "error") return this.complete(state, "failure", "intervention_error");
          return this.complete(state, "stopped", "repeated_state");
        }

        let decision: AgentDecision;
        try {
          decision = await withAbort(this.model.decideNextAction({
            goal: trimmedGoal,
            step: step.step,
            maxSteps: this.options.maxSteps,
            observation,
            previousDecision: state.lastDecision,
            previousResult: state.lastResult,
            extractedOutputs: state.extractedOutputs,
            signal: controller.signal,
          }), controller.signal);
          decision = {
            ...decision,
            decisionSummary: sanitizeDecisionSummary(decision.decisionSummary),
          };
        } catch (error) {
          if (error instanceof DiscoveryTimeoutError || controller.signal.aborted || isModelTimeout(error)) {
            const resolution = await intervene(
              "AGENT_TIMEOUT",
              "Discovery timed out while waiting for the model.",
              undefined,
              step.step,
            );
            if (resolution === "resume") continue;
            if (resolution === "abort") return this.complete(state, "failure", "human_aborted");
            if (resolution === "error") return this.complete(state, "failure", "intervention_error");
          } else {
            const resolution = await intervene(
              "AGENT_STUCK",
              `The discovery model failed: ${errorMessage(error)}`,
              undefined,
              step.step,
            );
            if (resolution === "resume") continue;
            if (resolution === "abort") return this.complete(state, "failure", "human_aborted");
            if (resolution === "error") return this.complete(state, "failure", "intervention_error");
          }
          return this.complete(
            state,
            error instanceof DiscoveryTimeoutError || controller.signal.aborted || isModelTimeout(error)
              ? "stopped"
              : "failure",
            error instanceof DiscoveryTimeoutError || controller.signal.aborted || isModelTimeout(error)
              ? "timeout"
              : `llm_error: ${errorMessage(error)}`,
          );
        }

        state.recordDecision(step, decision);
        try {
          this.policy.validate(decision, observation.url);
        } catch (error) {
          const result: ActionExecutionResult = {
            success: false,
            action: decision.action,
            error: {
              type: error instanceof PolicyViolation ? "POLICY_REJECTED" : "POLICY_ERROR",
              message: errorMessage(error),
            },
          };
          state.recordResult(step, result);
          await this.reportStep(step);
          const resolution = await intervene(
            "POLICY_BLOCKED",
            result.error?.message ?? "The action policy blocked discovery.",
            undefined,
            step.step,
          );
          if (resolution === "resume") continue;
          if (resolution === "abort") return this.complete(state, "failure", "human_aborted");
          if (resolution === "error") return this.complete(state, "failure", "intervention_error");
          return this.complete(state, "failure", `policy_rejected: ${result.error?.message}`);
        }

        const actionSignature = repeatedActionSignature(decision, observation.url);
        if (actionSignature !== undefined) {
          const attempts = (repeatedActions.get(actionSignature) ?? 0) + 1;
          repeatedActions.set(actionSignature, attempts);
          if (attempts > stallLimit) {
            const result: ActionExecutionResult = {
              success: false,
              action: decision.action,
              error: {
                type: "REPEATED_ACTION",
                message: `The same action was selected ${attempts} times without producing an output.`,
              },
            };
            state.recordResult(step, result);
            await this.reportStep(step);
            const resolution = await intervene(
              "AGENT_STUCK",
              result.error!.message,
              undefined,
              step.step,
            );
            if (resolution === "resume") continue;
            if (resolution === "abort") return this.complete(state, "failure", "human_aborted");
            if (resolution === "error") return this.complete(state, "failure", "intervention_error");
            return this.complete(state, "stopped", "repeated_action");
          }
        }

        let result: ActionExecutionResult;
        if (decision.action === "finish") {
          const extractedOutputs = state.extractedOutputs;
          const finalOutputs = decision.result ?? {};
          const unverified = Object.entries(finalOutputs)
            .filter(([name, value]) => extractedOutputs[name] !== value)
            .map(([name]) => name);
          const omitted = Object.keys(extractedOutputs)
            .filter((name) => !Object.prototype.hasOwnProperty.call(finalOutputs, name));
          if (unverified.length > 0 || omitted.length > 0) {
            const message = `Finish must return exactly the verified extracted outputs. Unverified: ${unverified.join(", ") || "none"}; omitted: ${omitted.join(", ") || "none"}.`;
            result = {
              success: false,
              action: "finish",
              error: {
                type: "UNVERIFIED_OUTPUT",
                message,
              },
            };
            state.recordResult(step, result);
            await this.reportStep(step);
            return this.complete(state, "failure", `unverified_output: ${message}`);
          }
        }
        try {
          result = await withAbort(this.execute(decision, observation.url), controller.signal);
        } catch (error) {
          if (error instanceof DiscoveryTimeoutError || controller.signal.aborted) {
            const resolution = await intervene(
              "AGENT_TIMEOUT",
              "Discovery timed out while executing a browser action.",
              undefined,
              step.step,
            );
            if (resolution === "resume") continue;
            if (resolution === "abort") return this.complete(state, "failure", "human_aborted");
            if (resolution === "error") return this.complete(state, "failure", "intervention_error");
            return this.complete(state, "stopped", "timeout");
          }
          result = {
            success: false,
            action: decision.action,
            error: { type: "ACTION_EXCEPTION", message: errorMessage(error) },
          };
        }

        state.recordResult(step, result);
        if (decision.action === "read" && result.success && result.value !== undefined && decision.outputName !== undefined) {
          state.setOutput(decision.outputName, result.value);
          lastObservationFingerprint = undefined;
          repeatedObservationCount = 0;
          repeatedActions.clear();
        }
        if (decision.action === "finish" && decision.result !== undefined) state.setOutputs(decision.result);
        await this.reportStep(step);

        if (decision.action === "finish") return this.complete(state, "success", undefined);
        if (decision.action === "fail") {
          const resolution = await intervene(
            "AGENT_STUCK",
            `The discovery model stopped: ${decision.decisionSummary}`,
            undefined,
            step.step,
          );
          if (resolution === "resume") continue;
          if (resolution === "abort") return this.complete(state, "failure", "human_aborted");
          if (resolution === "error") return this.complete(state, "failure", "intervention_error");
          return this.complete(state, "failure", `model_failed: ${decision.decisionSummary}`);
        }
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  private startTimeout(controller: AbortController): NodeJS.Timeout {
    const timeout = setTimeout(() => controller.abort(), this.options.runTimeoutMs);
    timeout.unref();
    return timeout;
  }

  private async execute(decision: AgentDecision, currentUrl: string): Promise<ActionExecutionResult> {
    switch (decision.action) {
      case "click":
        return fromBrowserResult("click", await this.actions.click(targetToLocator(decision.target!)));
      case "type":
        return fromBrowserResult("type", await this.actions.fill(targetToLocator(decision.target!), decision.value!));
      case "read": {
        const result = fromBrowserResult("read", await this.actions.readText(targetToLocator(decision.target!)));
        if (!result.success || result.value === undefined || decision.extractionPattern === undefined) return result;
        const match = result.value.match(new RegExp(decision.extractionPattern));
        if (match === null) {
          return {
            success: false,
            action: "read",
            error: {
              type: "EXTRACTION_FAILED",
              message: `Read text did not match extractionPattern for output "${decision.outputName}".`,
            },
          };
        }
        return { ...result, value: match[1] ?? match[0] };
      }
      case "navigate":
        return fromBrowserResult("navigate", await this.actions.navigate(new URL(decision.value!, currentUrl).toString()));
      case "wait":
        return fromBrowserResult(
          "wait",
          decision.target === undefined
            ? await this.actions.wait(this.options.waitDurationMs ?? 500)
            : await this.actions.waitFor(targetToLocator(decision.target)),
        );
      case "finish":
        return { success: true, action: "finish" };
      case "fail":
        return {
          success: false,
          action: "fail",
          error: { type: "MODEL_FAILED", message: decision.decisionSummary },
        };
    }
  }

  private async reportStep(step: AgentStep): Promise<void> {
    try {
      await this.options.onStep?.(step);
    } catch {
      // Reporting must not alter browser execution.
    }
  }

  private async complete(
    state: DiscoveryRunState,
    status: Exclude<AgentRunStatus, "running">,
    reason: string | undefined,
  ): Promise<DiscoveryRun> {
    let run = state.finish(status, reason, this.now);
    if (this.options.evidencePaths === undefined) return run;

    const evidence: DiscoveryEvidencePaths = {
      json: this.options.evidencePaths.json,
      screenshot: this.options.evidencePaths.screenshot,
      ...(this.options.evidencePaths.trace === undefined ? {} : { trace: this.options.evidencePaths.trace }),
    };
    state.setEvidence(evidence);

    try {
      await evidenceWriter.writeBinary(evidence.screenshot, await this.observer.captureScreenshot());
      run = state.snapshot();
      await evidenceWriter.writeJson(evidence.json, redactDiscoveryRun(run));
      return run;
    } catch (error) {
      run = state.finish("failure", `evidence_error: ${errorMessage(error)}`, this.now);
      try {
        await evidenceWriter.writeJson(evidence.json, redactDiscoveryRun(run));
      } catch {
        // The structured return still reports the evidence failure.
      }
      return run;
    }
  }
}
