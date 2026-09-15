import type { AgentDecision, AgentTarget } from "../agent/types.js";

const TARGET_ACTIONS = new Set(["click", "type", "read"]);
const RISKY_CONTROL = /\b(delete|remove|transfer|payment|close account|create|open new|submit|confirm)\b/i;
const OUTPUT_NAME = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;

export class PolicyViolation extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PolicyViolation";
  }
}

function targetDescription(target: AgentTarget | undefined): string {
  return [target?.role, target?.name, target?.text].filter(Boolean).join(" ");
}

export class ActionPolicy {
  private readonly allowedOrigin: string;

  constructor(bankAppUrl: string) {
    this.allowedOrigin = new URL(bankAppUrl).origin;
  }

  validate(decision: AgentDecision, currentUrl: string): void {
    if (TARGET_ACTIONS.has(decision.action)) this.validateTarget(decision.target);

    switch (decision.action) {
      case "click": {
        const description = targetDescription(decision.target);
        if (RISKY_CONTROL.test(description)) {
          throw new PolicyViolation(`Clicking potentially irreversible control "${description}" is blocked.`);
        }
        return;
      }
      case "type":
        if (decision.value === undefined || decision.value.length === 0) {
          throw new PolicyViolation("Type requires a non-empty value.");
        }
        if (decision.value.length > 1_000) throw new PolicyViolation("Type value exceeds the policy limit.");
        return;
      case "read":
        if (decision.outputName === undefined || !OUTPUT_NAME.test(decision.outputName)) {
          throw new PolicyViolation("Read requires a stable camelCase outputName.");
        }
        return;
      case "navigate": {
        if (decision.value === undefined) throw new PolicyViolation("Navigate requires a URL or route in value.");
        let destination: URL;
        try {
          destination = new URL(decision.value, currentUrl);
        } catch {
          throw new PolicyViolation("Navigate value is not a valid URL or route.");
        }
        if (destination.origin !== this.allowedOrigin) {
          throw new PolicyViolation(`Navigation outside ${this.allowedOrigin} is blocked.`);
        }
        return;
      }
      case "wait":
        if (decision.target !== undefined) this.validateTarget(decision.target);
        return;
      case "finish":
      case "fail":
        return;
    }
  }

  private validateTarget(target: AgentTarget | undefined): void {
    if (target === undefined) throw new PolicyViolation("This action requires a semantic target.");
    const hasRoleTarget = target.role !== undefined && target.name !== undefined;
    const hasTextTarget = target.text !== undefined;
    if (!hasRoleTarget && !hasTextTarget) {
      throw new PolicyViolation("Target requires role and accessible name, or exact visible text.");
    }
  }
}
