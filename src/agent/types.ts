import type { LocatorSpec, SurfaceObservation } from "../browser/types.js";
import type { BusinessOutcome } from "../outcomes/types.js";

type RoleLocatorSpec = Extract<LocatorSpec, { strategy: "role" }>;

export type AgentRole = RoleLocatorSpec["role"];
export type AgentActionType =
  | "click"
  | "type"
  | "read"
  | "read_many"
  | "navigate"
  | "wait"
  | "finish"
  | "business_outcome"
  | "fail";
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
  outputFields?: string[];
  extractionPattern?: string;
  decisionSummary: string;
  businessOutcome?: BusinessOutcome;
  result?: AgentOutputs;
}

export type AgentRecord = Record<string, string>;
export type AgentOutputValue = string | AgentRecord[];
export type AgentOutputs = Record<string, AgentOutputValue>;

export interface ActionExecutionResult {
  success: boolean;
  action: AgentActionType;
  value?: AgentOutputValue;
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
  outputs?: AgentOutputs;
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
  extractedOutputs: AgentOutputs;
  signal?: AbortSignal;
}

export interface AgentModel {
  decideNextAction(context: AgentDecisionContext): Promise<AgentDecision>;
}
