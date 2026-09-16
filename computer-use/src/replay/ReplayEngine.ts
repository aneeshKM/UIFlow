import { randomUUID } from "node:crypto";
import { ArtifactValidationError, ArtifactValidator } from "../artifact/ArtifactValidator.js";
import type { CapabilityArtifact } from "../artifact/types.js";
import type {
  InterventionDetails,
  InterventionOutcome,
  InterventionReason,
} from "../escalation/types.js";
import type { ActionPolicy } from "../policy/ActionPolicy.js";
import { PolicyViolation } from "../policy/ActionPolicy.js";
import { InputResolver, InputValidationError } from "./InputResolver.js";
import type {
  ReplayCheckpointEvaluator,
  ReplayFailure,
  ReplayOutcomeDetector,
  ReplayResult,
  ReplayStepExecutor,
  RuntimeInputs,
  RuntimeOutputs,
} from "./types.js";

export interface ReplayEngineOptions {
  runId?: string;
  now?: () => number;
  prepare?: (artifact: CapabilityArtifact) => Promise<void>;
  onStepCompleted?: (completedSteps: number, stepId: string, outputs: RuntimeOutputs) => void;
  allowReviewRisk?: boolean;
  maxInterventions?: number;
}

export interface ReplayEngineDependencies {
  stepExecutor: ReplayStepExecutor;
  checkpointEvaluator: ReplayCheckpointEvaluator;
  outcomeDetector: ReplayOutcomeDetector;
  inputResolver?: InputResolver;
  artifactValidator?: ArtifactValidator;
  actionPolicy: ActionPolicy;
  interventionManager?: import("./types.js").ReplayInterventionHandler;
}

export class ReplayEngine {
  private readonly inputResolver: InputResolver;
  private readonly artifactValidator: ArtifactValidator;
  private readonly now: () => number;

  constructor(
    private readonly dependencies: ReplayEngineDependencies,
    private readonly options: ReplayEngineOptions = {},
  ) {
    this.inputResolver = dependencies.inputResolver ?? new InputResolver();
    this.artifactValidator = dependencies.artifactValidator ?? new ArtifactValidator();
    this.now = options.now ?? (() => performance.now());
    if (options.maxInterventions !== undefined
      && (!Number.isInteger(options.maxInterventions) || options.maxInterventions < 0)) {
      throw new Error("maxInterventions must be a non-negative integer.");
    }
  }

  async run(artifactInput: unknown, runtimeInputs: RuntimeInputs): Promise<ReplayResult> {
    const startedAt = this.now();
    const runId = this.options.runId ?? randomUUID();
    let artifact: CapabilityArtifact;

    try {
      artifact = this.artifactValidator.validate(artifactInput);
    } catch (error) {
      return this.failure(
        "UNEXPECTED_STATE",
        error instanceof ArtifactValidationError ? error.message : `Artifact validation failed: ${String(error)}`,
      );
    }

    try {
      this.inputResolver.validate(artifact.inputs, runtimeInputs);
    } catch (error) {
      return this.failure(
        "INVALID_INPUT",
        error instanceof InputValidationError ? error.message : String(error),
      );
    }

    try {
      this.dependencies.actionPolicy.assertOriginAllowed(artifact.target.baseUrl);
    } catch (error) {
      return this.failure(
        "POLICY_BLOCKED",
        error instanceof PolicyViolation ? error.message : `Target policy validation failed: ${String(error)}`,
      );
    }

    const riskDecision = this.dependencies.actionPolicy.evaluateArtifactRisk(artifact.policy.riskLevel);
    if (!riskDecision.allowed && riskDecision.risk === "BLOCKED") {
      return this.failure("POLICY_BLOCKED", riskDecision.reason);
    }
    const needsRiskApproval = !riskDecision.allowed
      && riskDecision.risk === "REQUIRES_HUMAN"
      && this.options.allowReviewRisk !== true;
    if (needsRiskApproval && this.dependencies.interventionManager === undefined) {
      return this.failure("POLICY_REQUIRES_HUMAN", riskDecision.reason);
    }

    try {
      await this.options.prepare?.(artifact);
    } catch (error) {
      return this.failure(
        "ACTION_FAILED",
        `Replay setup failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    const outputs: RuntimeOutputs = {};
    let completedSteps = 0;
    let interventions = 0;

    if (needsRiskApproval) {
      const approvalFailure = this.failure("POLICY_REQUIRES_HUMAN", riskDecision.reason);
      const intervention = await this.intervene(approvalFailure, {
        runId,
        source: "replay",
        capabilityId: artifact.capability.id,
        goal: artifact.capability.description,
        reason: "POLICY_BLOCKED",
        message: riskDecision.reason,
      });
      if (intervention === undefined) return approvalFailure;
      if ("status" in intervention) return intervention;
      interventions += 1;
      if (intervention.resolution.action === "ABORT") {
        return this.humanAborted(undefined, intervention.resolution.note, interventions);
      }
    }

    for (const [stepIndex, step] of artifact.steps.entries()) {
      let stepComplete = false;
      while (!stepComplete) {
        let execution;
        try {
          execution = await this.dependencies.stepExecutor.execute(
            step,
            runtimeInputs,
            outputs,
            artifact.target.baseUrl,
          );
        } catch (error) {
          return this.failure(
            "ACTION_FAILED",
            error instanceof Error ? error.message : String(error),
            step.id,
          );
        }
        if (execution.status === "success") {
          stepComplete = true;
          continue;
        }

        const reason = this.reasonFor(execution.code);
        if (reason === undefined || interventions >= (this.options.maxInterventions ?? 3)) return execution;
        const intervention = await this.intervene(execution, {
          runId,
          source: "replay",
          capabilityId: artifact.capability.id,
          goal: artifact.capability.description,
          stepId: step.id,
          stepIndex,
          reason,
          message: execution.message,
        });
        if (intervention === undefined) return execution;
        if ("status" in intervention) return intervention;
        interventions += 1;
        if (intervention.resolution.action === "ABORT") {
          return this.humanAborted(step.id, intervention.resolution.note, interventions);
        }
        if (intervention.resolution.action === "STEP_COMPLETED") stepComplete = true;
      }

      completedSteps += 1;
      this.options.onStepCompleted?.(completedSteps, step.id, { ...outputs });

      for (;;) {
        let outcome;
        try {
          outcome = await this.dependencies.outcomeDetector.detect();
        } catch (error) {
          return this.failure(
            "UNEXPECTED_STATE",
            `Could not inspect the application state: ${error instanceof Error ? error.message : String(error)}`,
            step.id,
          );
        }
        if (outcome.status === "normal") break;
        if (outcome.status === "business_outcome") return { ...outcome, stepId: step.id };

        const failure = { ...outcome, stepId: outcome.stepId ?? step.id };
        const reason = this.reasonFor(failure.code);
        if (reason === undefined || interventions >= (this.options.maxInterventions ?? 3)) return failure;
        const intervention = await this.intervene(failure, {
          runId,
          source: "replay",
          capabilityId: artifact.capability.id,
          goal: artifact.capability.description,
          stepId: step.id,
          stepIndex,
          reason,
          message: failure.message,
        });
        if (intervention === undefined) return failure;
        if ("status" in intervention) return intervention;
        interventions += 1;
        if (intervention.resolution.action === "ABORT") {
          return this.humanAborted(step.id, intervention.resolution.note, interventions);
        }
      }
    }

    for (;;) {
      let checkpoint;
      try {
        checkpoint = await this.dependencies.checkpointEvaluator.evaluate(artifact.checkpoint, outputs);
      } catch (error) {
        return this.failure(
          "CHECKPOINT_FAILED",
          `Could not evaluate the final checkpoint: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      if (checkpoint.success) break;

      const failure: ReplayFailure = {
        status: "failure",
        code: "CHECKPOINT_FAILED",
        expected: checkpoint.expected,
        ...(checkpoint.observed === undefined ? {} : { observed: checkpoint.observed }),
        message: checkpoint.message,
      };
      if (interventions >= (this.options.maxInterventions ?? 3)) return failure;
      const intervention = await this.intervene(failure, {
        runId,
        source: "replay",
        capabilityId: artifact.capability.id,
        goal: artifact.capability.description,
        reason: "CHECKPOINT_FAILED",
        message: checkpoint.message,
      });
      if (intervention === undefined) return failure;
      if ("status" in intervention) return intervention;
      interventions += 1;
      if (intervention.resolution.action === "ABORT") {
        return this.humanAborted(undefined, intervention.resolution.note, interventions);
      }
    }

    return {
      status: "success",
      capabilityId: artifact.capability.id,
      capabilityVersion: artifact.capability.version,
      runId,
      outputs,
      completedSteps,
      durationMs: Math.max(0, Math.round(this.now() - startedAt)),
      ...(interventions === 0 ? {} : { interventions }),
    };
  }

  private reasonFor(code: ReplayFailure["code"]): InterventionReason | undefined {
    switch (code) {
      case "LOCATOR_NOT_FOUND":
        return "LOCATOR_NOT_FOUND";
      case "UNEXPECTED_STATE":
      case "SESSION_EXPIRED":
        return "UNEXPECTED_STATE";
      case "CHECKPOINT_FAILED":
        return "CHECKPOINT_FAILED";
      case "TIMEOUT":
        return "RETRIES_EXHAUSTED";
      case "POLICY_REQUIRES_HUMAN":
        return "POLICY_BLOCKED";
      case "POLICY_BLOCKED":
      case "INVALID_INPUT":
      case "ACTION_FAILED":
      case "HUMAN_ABORTED":
        return undefined;
    }
  }

  private async intervene(
    originalFailure: ReplayFailure,
    details: InterventionDetails,
  ): Promise<InterventionOutcome | ReplayFailure | undefined> {
    if (this.dependencies.interventionManager === undefined || this.reasonFor(originalFailure.code) === undefined) {
      return undefined;
    }
    try {
      return await this.dependencies.interventionManager.requestIntervention(details);
    } catch (error) {
      return this.failure(
        "ACTION_FAILED",
        `Human intervention failed: ${error instanceof Error ? error.message : String(error)}`,
        originalFailure.stepId,
      );
    }
  }

  private humanAborted(stepId: string | undefined, note: string | undefined, interventions: number): ReplayFailure {
    return {
      status: "failure",
      code: "HUMAN_ABORTED",
      ...(stepId === undefined ? {} : { stepId }),
      message: note === undefined ? "The human operator aborted replay." : `The human operator aborted replay: ${note}`,
      interventions,
    };
  }

  private failure(code: ReplayFailure["code"], message: string, stepId?: string): ReplayFailure {
    return {
      status: "failure",
      code,
      ...(stepId === undefined ? {} : { stepId }),
      message,
    };
  }
}
