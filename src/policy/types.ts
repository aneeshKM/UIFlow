import type { ControlOwner } from "../escalation/types.js";

export type ActionRisk = "SAFE" | "REQUIRES_HUMAN" | "BLOCKED";

export type PolicyAction =
  | "observe"
  | "navigate"
  | "click"
  | "type"
  | "read"
  | "read_many"
  | "wait"
  | "finish"
  | "business_outcome"
  | "fail";

export interface PolicyTarget {
  role?: string;
  name?: string;
  text?: string;
  label?: string;
  placeholder?: string;
  testId?: string;
}

export interface PolicyRequest {
  action: PolicyAction;
  owner?: ControlOwner;
  currentUrl?: string;
  destination?: string;
  target?: PolicyTarget;
  requestedRisk?: ActionRisk;
}

export type PolicyDecision =
  | { allowed: true; risk: "SAFE" | "REQUIRES_HUMAN" }
  | { allowed: false; risk: "REQUIRES_HUMAN" | "BLOCKED"; reason: string };
