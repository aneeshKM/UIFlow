import type { LocatorSpec, SurfaceObservation } from "../browser/types.js";
import type { BusinessOutcome } from "../outcomes/types.js";

type RoleLocatorSpec = Extract<LocatorSpec, { strategy: "role" }>;

export type AgentRole = RoleLocatorSpec["role"];
export type AgentActionType = "click" | "type" | "read" | "navigate" | "wait" | "finish" | "fail";
export type AgentRunStatus = "running" | "success" | "business_outcome" | "failure" | "stopped";

export interface AgentTarget {
  role?: AgentRole;
  name?: string;
  text?: string;
}

export interface AgentDecision {
  action: AgentActionType;
  target?: AgentTarget;
  value?: string;
  inputName?: string;
  outputName?: string;
  extractionPattern?: string;
  decisionSummary: string;
  result?: Record<string, string>;
}

export interface ActionExecutionResult {
  success: boolean;
  action: AgentActionType;
  value?: string;
  error?: {
    type: string;
    message: string;
  };
}

export interface AgentStep {
  step: number;
  url: string;
  observation: SurfaceObservation;
  decision?: AgentDecision;
  result?: ActionExecutionResult;
}

export interface DiscoveryEvidencePaths {
  json: string;
  screenshot: string;
  trace?: string;
}

export interface DiscoveryRun {
  runId: string;
  goal: string;
  startedAt: string;
  completedAt?: string;
  status: AgentRunStatus;
  steps: AgentStep[];
  outputs?: Record<string, string>;
  businessOutcome?: BusinessOutcome;
  stopReason?: string;
  evidence?: DiscoveryEvidencePaths;
  interventions?: number;
}

export interface AgentDecisionContext {
  goal: string;
  step: number;
  maxSteps: number;
  observation: SurfaceObservation;
  previousDecision?: AgentDecision;
  previousResult?: ActionExecutionResult;
  extractedOutputs: Record<string, string>;
  signal?: AbortSignal;
}

export interface AgentModel {
  decideNextAction(context: AgentDecisionContext): Promise<AgentDecision>;
}
