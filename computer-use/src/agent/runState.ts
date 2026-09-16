import { randomUUID } from "node:crypto";
import type {
  ActionExecutionResult,
  AgentDecision,
  AgentRunStatus,
  AgentStep,
  DiscoveryEvidencePaths,
  DiscoveryRun,
} from "./types.js";
import type { SurfaceObservation } from "../browser/types.js";
import type { BusinessOutcome } from "../outcomes/types.js";

export class DiscoveryRunState {
  readonly runId: string;
  readonly goal: string;
  readonly startedAt: string;
  private readonly steps: AgentStep[] = [];
  private readonly outputs: Record<string, string> = {};
  private status: AgentRunStatus = "running";
  private completedAt?: string;
  private stopReason?: string;
  private evidence?: DiscoveryEvidencePaths;
  private businessOutcome?: BusinessOutcome;
  private previousDecision?: AgentDecision;
  private previousResult?: ActionExecutionResult;
  private interventions = 0;

  constructor(
    goal: string,
    runId: string = randomUUID(),
    now: () => Date = () => new Date(),
    startedAt: Date = now(),
  ) {
    this.runId = runId;
    this.goal = goal;
    this.startedAt = startedAt.toISOString();
  }

  get currentStep(): number {
    return this.steps.length;
  }

  get lastDecision(): AgentDecision | undefined {
    return this.previousDecision;
  }

  get lastResult(): ActionExecutionResult | undefined {
    return this.previousResult;
  }

  get extractedOutputs(): Record<string, string> {
    return { ...this.outputs };
  }

  get interventionCount(): number {
    return this.interventions;
  }

  recordObservation(observation: SurfaceObservation): AgentStep {
    const step: AgentStep = {
      step: this.steps.length + 1,
      url: observation.url,
      observation,
    };
    this.steps.push(step);
    return step;
  }

  recordDecision(step: AgentStep, decision: AgentDecision): void {
    step.decision = decision;
    this.previousDecision = decision;
  }

  recordResult(step: AgentStep, result: ActionExecutionResult): void {
    step.result = result;
    this.previousResult = result;
  }

  setOutput(name: string, value: string): void {
    this.outputs[name] = value;
  }

  setOutputs(outputs: Record<string, string>): void {
    Object.assign(this.outputs, outputs);
  }

  setEvidence(evidence: DiscoveryEvidencePaths): void {
    this.evidence = evidence;
  }

  setBusinessOutcome(outcome: BusinessOutcome): void {
    this.businessOutcome = {
      ...outcome,
      ...(outcome.details === undefined ? {} : { details: { ...outcome.details } }),
    };
  }

  recordIntervention(): void {
    this.interventions += 1;
  }

  finish(status: Exclude<AgentRunStatus, "running">, reason: string | undefined, now: () => Date): DiscoveryRun {
    this.status = status;
    this.stopReason = reason;
    this.completedAt = now().toISOString();
    return this.snapshot();
  }

  snapshot(): DiscoveryRun {
    return {
      runId: this.runId,
      goal: this.goal,
      startedAt: this.startedAt,
      ...(this.completedAt === undefined ? {} : { completedAt: this.completedAt }),
      status: this.status,
      steps: this.steps.map((step) => ({ ...step })),
      ...(Object.keys(this.outputs).length === 0 ? {} : { outputs: { ...this.outputs } }),
      ...(this.businessOutcome === undefined
        ? {}
        : {
            businessOutcome: {
              ...this.businessOutcome,
              ...(this.businessOutcome.details === undefined
                ? {}
                : { details: { ...this.businessOutcome.details } }),
            },
          }),
      ...(this.stopReason === undefined ? {} : { stopReason: this.stopReason }),
      ...(this.evidence === undefined ? {} : { evidence: { ...this.evidence } }),
      ...(this.interventions === 0 ? {} : { interventions: this.interventions }),
    };
  }
}
