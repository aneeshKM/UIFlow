import type { AgentRole } from "../agent/types.js";

export type ControlOwner = "AUTOMATION" | "HUMAN";

export type InterventionSource = "discovery" | "replay";

export type InterventionReason =
  | "LOCATOR_NOT_FOUND"
  | "UNEXPECTED_STATE"
  | "UNEXPECTED_DIALOG"
  | "CHECKPOINT_FAILED"
  | "POLICY_BLOCKED"
  | "RETRIES_EXHAUSTED"
  | "AGENT_STUCK"
  | "AGENT_TIMEOUT";

export interface InterventionRequest {
  interventionId: string;
  runId: string;
  source: InterventionSource;
  capabilityId?: string;
  goal?: string;
  stepId?: string;
  stepIndex?: number;
  reason: InterventionReason;
  message: string;
  currentUrl: string;
  observation: string;
  screenshotPath: string;
  createdAt: string;
}

export type InterventionResolution =
  | { action: "RETRY_STEP"; note?: string }
  | { action: "STEP_COMPLETED"; note?: string }
  | { action: "ABORT"; note?: string };

export interface HumanActionRecord {
  timestamp: string;
  action: "observe" | "click" | "type" | "read";
  target?: {
    role?: AgentRole;
    name?: string;
  };
  value?: "[REDACTED]";
  result: "success" | "failure";
}

export interface InterventionDetails {
  runId: string;
  source: InterventionSource;
  capabilityId?: string;
  goal?: string;
  stepId?: string;
  stepIndex?: number;
  reason: InterventionReason;
  message: string;
}

export interface InterventionEvidencePaths {
  json: string;
  beforeScreenshot: string;
  afterScreenshot?: string;
}

export interface InterventionOutcome {
  request: InterventionRequest;
  resolution: InterventionResolution;
  humanActions: HumanActionRecord[];
  evidence: InterventionEvidencePaths;
  resolvedAt?: string;
}

export interface InterventionHandler {
  requestIntervention(details: InterventionDetails): Promise<InterventionOutcome>;
}
