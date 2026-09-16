import type { AgentDecision, AgentTarget } from "../agent/types.js";
import type { RiskLevel } from "../artifact/types.js";
import type {
  ActionRisk,
  PolicyAction,
  PolicyDecision,
  PolicyRequest,
  PolicyTarget,
} from "./types.js";

const TARGET_ACTIONS = new Set(["click", "type", "read"]);
const ALLOWED_ACTIONS = new Set<PolicyAction>([
  "observe",
  "navigate",
  "click",
  "type",
  "read",
  "wait",
  "finish",
  "business_outcome",
  "fail",
]);
const BLOCKED_CONTROL = /\b(delete|remove|transfer|wire|payment|close (?:an? )?(?:account|member)|terminate)\b/i;
const REVIEW_CONTROL = /\b(create|open new|new (?:account|member)|submit|confirm|approve|save|update|edit)\b/i;
const OUTPUT_NAME = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
const MAX_EXTRACTION_PATTERN_LENGTH = 200;

export class PolicyViolation extends Error {
  readonly risk: "REQUIRES_HUMAN" | "BLOCKED";

  constructor(message: string, risk: "REQUIRES_HUMAN" | "BLOCKED" = "BLOCKED") {
    super(message);
    this.name = "PolicyViolation";
    this.risk = risk;
  }
}

function targetDescription(target: PolicyTarget | AgentTarget | undefined): string {
  return [
    target?.role,
    target?.name,
    target?.text,
    "label" in (target ?? {}) ? (target as PolicyTarget).label : undefined,
    "placeholder" in (target ?? {}) ? (target as PolicyTarget).placeholder : undefined,
    "testId" in (target ?? {}) ? (target as PolicyTarget).testId : undefined,
  ].filter(Boolean).join(" ");
}

function normalizeRoutePrefix(prefix: string): string {
  const trimmed = prefix.trim();
  if (trimmed === "" || trimmed === "/") return "/";
  return `/${trimmed.replace(/^\/+|\/+$/g, "")}`;
}

function riskFromArtifact(value: RiskLevel): ActionRisk {
  if (value === "review") return "REQUIRES_HUMAN";
  if (value === "blocked") return "BLOCKED";
  return "SAFE";
}

export class ActionPolicy {
  private readonly allowedOrigins: ReadonlySet<string>;
  private readonly allowedRoutePrefixes: readonly string[];

  constructor(allowedOrigins: string | string[], allowedRoutePrefixes: string[] = ["/"]) {
    const origins = (Array.isArray(allowedOrigins) ? allowedOrigins : [allowedOrigins])
      .map((value) => new URL(value).origin);
    if (origins.length === 0) throw new Error("ActionPolicy requires at least one allowed origin.");
    this.allowedOrigins = new Set(origins);
    this.allowedRoutePrefixes = [...new Set(allowedRoutePrefixes.map(normalizeRoutePrefix))];
    if (this.allowedRoutePrefixes.length === 0) {
      throw new Error("ActionPolicy requires at least one allowed route prefix.");
    }
  }

  get primaryOrigin(): string {
    return this.allowedOrigins.values().next().value as string;
  }

  validate(decision: AgentDecision, currentUrl: string): void {
    if (TARGET_ACTIONS.has(decision.action)) this.validateTarget(decision.target);

    switch (decision.action) {
      case "click": {
        break;
      }
      case "type":
        if (decision.value === undefined || decision.value.length === 0) {
          throw new PolicyViolation("Type requires a non-empty value.");
        }
        if (decision.value.length > 1_000) throw new PolicyViolation("Type value exceeds the policy limit.");
        if (decision.inputName === undefined || !OUTPUT_NAME.test(decision.inputName)) {
          throw new PolicyViolation("Type requires a stable camelCase inputName.");
        }
        break;
      case "read":
        if (decision.outputName === undefined || !OUTPUT_NAME.test(decision.outputName)) {
          throw new PolicyViolation("Read requires a stable camelCase outputName.");
        }
        if (decision.extractionPattern !== undefined) {
          if (decision.extractionPattern.length > MAX_EXTRACTION_PATTERN_LENGTH) {
            throw new PolicyViolation("Read extractionPattern exceeds the policy limit.");
          }
          try {
            new RegExp(decision.extractionPattern);
          } catch {
            throw new PolicyViolation("Read extractionPattern must be a valid regular expression.");
          }
        }
        break;
      case "navigate": {
        if (decision.value === undefined) throw new PolicyViolation("Navigate requires a URL or route in value.");
        break;
      }
      case "wait":
        if (decision.target !== undefined) this.validateTarget(decision.target);
        break;
      case "finish":
      case "business_outcome":
      case "fail":
        break;
    }

    if (decision.action === "business_outcome" && decision.businessOutcome === undefined) {
      throw new PolicyViolation("business_outcome requires a structured businessOutcome.");
    }
    if (decision.action !== "business_outcome" && decision.businessOutcome !== undefined) {
      throw new PolicyViolation("businessOutcome is only allowed with the business_outcome action.");
    }

    this.assertAllowed({
      action: decision.action,
      currentUrl,
      ...(decision.value === undefined || decision.action !== "navigate" ? {} : { destination: decision.value }),
      ...(decision.target === undefined ? {} : { target: decision.target }),
    });
  }

  evaluate(request: PolicyRequest): PolicyDecision {
    if (!ALLOWED_ACTIONS.has(request.action)) {
      return { allowed: false, risk: "BLOCKED", reason: `Unsupported action "${request.action}" is blocked.` };
    }

    if (request.currentUrl !== undefined) {
      const current = this.checkUrl(request.currentUrl, request.currentUrl);
      if (current !== undefined) return current;
    }

    if (request.action === "navigate") {
      if (request.destination === undefined) {
        return { allowed: false, risk: "BLOCKED", reason: "Navigate requires a destination." };
      }
      const destination = this.checkUrl(request.destination, request.currentUrl ?? this.primaryOrigin);
      if (destination !== undefined) return destination;
    }

    if (TARGET_ACTIONS.has(request.action) && request.target === undefined) {
      return { allowed: false, risk: "BLOCKED", reason: `${request.action} requires a semantic target.` };
    }

    const risk = request.requestedRisk ?? this.classify(request.action, request.target);
    if (risk === "BLOCKED") {
      return {
        allowed: false,
        risk,
        reason: `Action on potentially irreversible control "${targetDescription(request.target)}" is blocked.`,
      };
    }
    if (risk === "REQUIRES_HUMAN" && request.owner !== "HUMAN") {
      return {
        allowed: false,
        risk,
        reason: `Action on state-changing control "${targetDescription(request.target)}" requires a human operator.`,
      };
    }
    return { allowed: true, risk };
  }

  evaluateArtifactRisk(riskLevel: RiskLevel, owner: "AUTOMATION" | "HUMAN" = "AUTOMATION"): PolicyDecision {
    const risk = riskFromArtifact(riskLevel);
    if (risk === "BLOCKED") {
      return { allowed: false, risk, reason: "Replay policy blocks this capability artifact." };
    }
    if (risk === "REQUIRES_HUMAN" && owner !== "HUMAN") {
      return { allowed: false, risk, reason: "Replay policy requires human approval for this capability artifact." };
    }
    return { allowed: true, risk };
  }

  assertAllowed(request: PolicyRequest): PolicyDecision & { allowed: true } {
    const decision = this.evaluate(request);
    if (!decision.allowed) throw new PolicyViolation(decision.reason, decision.risk);
    return decision;
  }

  assertArtifactRisk(riskLevel: RiskLevel, owner: "AUTOMATION" | "HUMAN" = "AUTOMATION"): void {
    const decision = this.evaluateArtifactRisk(riskLevel, owner);
    if (!decision.allowed) throw new PolicyViolation(decision.reason, decision.risk);
  }

  assertUrlAllowed(url: string, base = this.primaryOrigin): void {
    const decision = this.checkUrl(url, base);
    if (decision !== undefined) throw new PolicyViolation(decision.reason, decision.risk);
  }

  assertOriginAllowed(url: string): void {
    let origin: string;
    try {
      origin = new URL(url).origin;
    } catch {
      throw new PolicyViolation(`Invalid application URL "${url}" is blocked.`);
    }
    if (!this.allowedOrigins.has(origin)) {
      throw new PolicyViolation(`Application origin ${origin} is outside the configured allowlist.`);
    }
  }

  private classify(action: PolicyAction, target: PolicyTarget | undefined): ActionRisk {
    if (action !== "click") return "SAFE";
    const description = targetDescription(target);
    if (BLOCKED_CONTROL.test(description)) return "BLOCKED";
    if (REVIEW_CONTROL.test(description)) return "REQUIRES_HUMAN";
    return "SAFE";
  }

  private checkUrl(value: string, base: string): Extract<PolicyDecision, { allowed: false }> | undefined {
    let url: URL;
    try {
      url = new URL(value, base);
    } catch {
      return { allowed: false, risk: "BLOCKED", reason: `Invalid application URL "${value}" is blocked.` };
    }
    if (!this.allowedOrigins.has(url.origin)) {
      return {
        allowed: false,
        risk: "BLOCKED",
        reason: `Navigation outside ${[...this.allowedOrigins].join(", ")} is blocked.`,
      };
    }
    const routeAllowed = this.allowedRoutePrefixes.some((prefix) =>
      prefix === "/" || url.pathname === prefix || url.pathname.startsWith(`${prefix}/`));
    if (!routeAllowed) {
      return {
        allowed: false,
        risk: "BLOCKED",
        reason: `Route "${url.pathname}" is outside the application allowlist.`,
      };
    }
    return undefined;
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
