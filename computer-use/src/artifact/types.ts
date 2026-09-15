import type { AgentRole } from "../agent/types.js";

export const CAPABILITY_SCHEMA_VERSION = "1.0.0" as const;

export type InputType = "string";
export type OutputType = "string";
export type RiskLevel = "safe" | "review" | "blocked";
export type CapabilityAction = "navigate" | "click" | "type" | "extract" | "wait_for" | "assert";

export interface InputDefinition {
  name: string;
  type: InputType;
  required: boolean;
  description?: string;
}

export interface OutputDefinition {
  name: string;
  type: OutputType;
  description?: string;
}

export type LocatorHint =
  | { role: AgentRole; name: string }
  | { label: string }
  | { text: string }
  | { placeholder: string }
  | { testId: string };

export type ArtifactTarget = LocatorHint & {
  fallbacks?: LocatorHint[];
};

export type StepValue =
  | { input: string }
  | { literal: string }
  | { template: string };

export type CheckpointCondition =
  | { kind: "visible"; target: ArtifactTarget }
  | { kind: "output_present"; output: string }
  | { kind: "url_matches"; value: string };

export type StepExpectation =
  | { kind: "action_succeeds" }
  | CheckpointCondition;

interface StepBase {
  id: string;
  timeoutMs: number;
  expected: StepExpectation;
}

export type CapabilityStep =
  | (StepBase & { action: "navigate"; value: StepValue })
  | (StepBase & { action: "click"; target: ArtifactTarget })
  | (StepBase & { action: "type"; target: ArtifactTarget; value: StepValue })
  | (StepBase & {
      action: "extract";
      target: ArtifactTarget;
      output: string;
      pattern?: string;
    })
  | (StepBase & { action: "wait_for"; target: ArtifactTarget })
  | (StepBase & { action: "assert"; condition: CheckpointCondition });

export interface Checkpoint {
  type: "all" | "any";
  conditions: CheckpointCondition[];
}

export interface CapabilityArtifact {
  schemaVersion: typeof CAPABILITY_SCHEMA_VERSION;
  capability: {
    id: string;
    name: string;
    description: string;
    version: number;
  };
  target: {
    app: string;
    baseUrl: string;
  };
  inputs: InputDefinition[];
  outputs: OutputDefinition[];
  steps: CapabilityStep[];
  checkpoint: Checkpoint;
  policy: {
    allowedActions: CapabilityAction[];
    riskLevel: RiskLevel;
  };
  metadata: {
    createdAt: string;
    sourceRunId: string;
  };
}
