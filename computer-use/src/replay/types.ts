import type {
  CapabilityArtifact,
  CapabilityStep,
  CheckpointCondition,
} from "../artifact/types.js";
import type { ActionResult, LocatorSpec, SurfaceObservation } from "../browser/types.js";
import type { InterventionHandler } from "../escalation/types.js";

export type ReplayStatus = "success" | "business_outcome" | "failure";

export type RuntimeInputs = Record<string, unknown>;
export type RuntimeOutputs = Record<string, unknown>;

export interface ReplaySuccess {
  status: "success";
  capabilityId: string;
  capabilityVersion: number;
  runId: string;
  outputs: RuntimeOutputs;
  completedSteps: number;
  durationMs: number;
  interventions?: number;
}

export interface ReplayBusinessOutcome {
  status: "business_outcome";
  code: string;
  stepId?: string;
  details?: Record<string, unknown>;
}

export type ReplayFailureCode =
  | "INVALID_INPUT"
  | "LOCATOR_NOT_FOUND"
  | "ACTION_FAILED"
  | "POLICY_BLOCKED"
  | "POLICY_REQUIRES_HUMAN"
  | "CHECKPOINT_FAILED"
  | "TIMEOUT"
  | "SESSION_EXPIRED"
  | "UNEXPECTED_STATE"
  | "HUMAN_ABORTED";

export interface ReplayFailure {
  status: "failure";
  code: ReplayFailureCode;
  stepId?: string;
  expected?: unknown;
  observed?: unknown;
  message: string;
  interventions?: number;
}

export type ReplayResult = ReplaySuccess | ReplayBusinessOutcome | ReplayFailure;

export type StepExecutionResult =
  | { status: "success"; output?: { name: string; value: unknown } }
  | ReplayFailure;

export type CheckpointResult =
  | { success: true }
  | { success: false; expected: unknown; observed?: unknown; message: string };

export type RuntimeState =
  | { kind: "normal" }
  | { kind: "member_not_found"; message: string }
  | { kind: "session_expired"; message: string }
  | { kind: "known_app_error"; message: string }
  | { kind: "loading"; message: string };

export type OutcomeDetectionResult =
  | { status: "normal" }
  | { status: "business_outcome"; code: "MEMBER_NOT_FOUND"; details?: Record<string, unknown> }
  | ReplayFailure;

export interface ReplayBrowserActions {
  navigate(url: string, timeoutMs?: number): Promise<ActionResult>;
  click(target: LocatorSpec, timeoutMs?: number): Promise<ActionResult>;
  fill(target: LocatorSpec, value: string, timeoutMs?: number): Promise<ActionResult>;
  readText(target: LocatorSpec, timeoutMs?: number): Promise<ActionResult<string>>;
  waitFor(target: LocatorSpec, state?: "visible" | "hidden" | "attached", timeoutMs?: number): Promise<ActionResult>;
  isVisible(target: LocatorSpec, timeoutMs?: number): Promise<ActionResult<boolean>>;
  wait(durationMs?: number): Promise<ActionResult>;
}

export interface ReplaySurfaceObserver {
  observe(): Promise<SurfaceObservation>;
}

export interface ReplayStepExecutor {
  execute(
    step: CapabilityStep,
    inputs: RuntimeInputs,
    outputs: RuntimeOutputs,
    baseUrl: string,
  ): Promise<StepExecutionResult>;
}

export interface ReplayCheckpointEvaluator {
  evaluate(
    checkpoint: CapabilityArtifact["checkpoint"],
    outputs: RuntimeOutputs,
  ): Promise<CheckpointResult>;
  evaluateCondition(
    condition: CheckpointCondition,
    outputs: RuntimeOutputs,
  ): Promise<CheckpointResult>;
}

export interface ReplayOutcomeDetector {
  detect(): Promise<OutcomeDetectionResult>;
}

export type ReplayInterventionHandler = InterventionHandler;
