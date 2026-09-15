import { randomUUID } from "node:crypto";
import { ArtifactValidationError, ArtifactValidator } from "../artifact/ArtifactValidator.js";
import type { CapabilityArtifact } from "../artifact/types.js";
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
}

export interface ReplayEngineDependencies {
  stepExecutor: ReplayStepExecutor;
  checkpointEvaluator: ReplayCheckpointEvaluator;
  outcomeDetector: ReplayOutcomeDetector;
  inputResolver?: InputResolver;
  artifactValidator?: ArtifactValidator;
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
      await this.options.prepare?.(artifact);
    } catch (error) {
      return this.failure(
        "ACTION_FAILED",
        `Replay setup failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    const outputs: RuntimeOutputs = {};
    let completedSteps = 0;

    for (const step of artifact.steps) {
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
      if (execution.status === "failure") return execution;

      completedSteps += 1;
      this.options.onStepCompleted?.(completedSteps, step.id, { ...outputs });

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
      if (outcome.status === "business_outcome") return { ...outcome, stepId: step.id };
      if (outcome.status === "failure") return { ...outcome, stepId: outcome.stepId ?? step.id };
    }

    let checkpoint;
    try {
      checkpoint = await this.dependencies.checkpointEvaluator.evaluate(artifact.checkpoint, outputs);
    } catch (error) {
      return this.failure(
        "CHECKPOINT_FAILED",
        `Could not evaluate the final checkpoint: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (!checkpoint.success) {
      return {
        status: "failure",
        code: "CHECKPOINT_FAILED",
        expected: checkpoint.expected,
        ...(checkpoint.observed === undefined ? {} : { observed: checkpoint.observed }),
        message: checkpoint.message,
      };
    }

    return {
      status: "success",
      capabilityId: artifact.capability.id,
      capabilityVersion: artifact.capability.version,
      runId,
      outputs,
      completedSteps,
      durationMs: Math.max(0, Math.round(this.now() - startedAt)),
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
