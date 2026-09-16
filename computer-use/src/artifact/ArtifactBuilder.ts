import type { AgentDecision, AgentTarget, DiscoveryRun } from "../agent/types.js";
import { ArtifactValidator } from "./ArtifactValidator.js";
import {
  CAPABILITY_SCHEMA_VERSION,
  type ArtifactTarget,
  type CapabilityArtifact,
  type CapabilityStep,
  type CheckpointCondition,
  type InputDefinition,
  type OutputDefinition,
  type StepValue,
} from "./types.js";

const DEFAULT_TIMEOUT_MS = 10_000;
const SENSITIVE_TARGET = /password|passcode|secret|api[_ -]?key|authorization|cookie|session[_ -]?id|token/i;

export interface ArtifactBuilderOptions {
  capabilityId?: string;
  capabilityName?: string;
  capabilityVersion?: number;
  timeoutMs?: number;
  now?: () => Date;
}

interface InputBinding {
  definition: InputDefinition;
  concreteValue: string;
}

function words(value: string): string[] {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .match(/[a-z0-9]+/g) ?? [];
}

function toKebabCase(value: string): string {
  return words(value).join("-").slice(0, 64).replace(/-+$/g, "");
}

function titleCase(value: string): string {
  return words(value).map((part) => `${part[0]?.toUpperCase()}${part.slice(1)}`).join(" ");
}

function targetDescription(target: AgentTarget | undefined): string {
  return [target?.role, target?.name, target?.text].filter(Boolean).join(" ");
}

function stableLocatorText(value: string, dynamicValues: string[]): string {
  const positions = dynamicValues
    .filter((dynamicValue) => dynamicValue.length > 0)
    .map((dynamicValue) => value.indexOf(dynamicValue))
    .filter((position) => position >= 0);
  const maskedIdentifier = value.search(/\*{2,}\d+/);
  if (maskedIdentifier >= 0) positions.push(maskedIdentifier);
  if (positions.length === 0) return value;
  const stablePrefix = value.slice(0, Math.min(...positions)).trim().replace(/[-:–—]+$/g, "").trim();
  if (stablePrefix.length === 0) {
    throw new Error("A semantic target is the discovery-time runtime value instead of a stable label.");
  }
  return stablePrefix;
}

function toArtifactTarget(target: AgentTarget, dynamicValues: string[] = []): ArtifactTarget {
  if (target.role !== undefined && target.name !== undefined) {
    return { role: target.role, name: stableLocatorText(target.name, dynamicValues) };
  }
  if (target.text !== undefined) return { text: stableLocatorText(target.text, dynamicValues) };
  throw new Error("A successful discovery action has no reusable semantic target.");
}

function replaceConcreteInputs(value: string, bindings: InputBinding[]): string {
  return [...bindings]
    .sort((a, b) => b.concreteValue.length - a.concreteValue.length)
    .reduce(
      (result, binding) => result.split(binding.concreteValue).join(`{{${binding.definition.name}}}`),
      value,
    );
}

function resolveStepValue(value: string, bindings: InputBinding[]): StepValue {
  const exact = bindings.find(({ concreteValue }) => concreteValue === value);
  if (exact !== undefined) return { input: exact.definition.name };
  const parameterized = replaceConcreteInputs(value, bindings);
  return parameterized === value ? { literal: value } : { template: parameterized };
}

function targetSlug(target: ArtifactTarget): string {
  if ("role" in target) return toKebabCase(target.name || target.role);
  if ("label" in target) return toKebabCase(target.label);
  if ("text" in target) return toKebabCase(target.text);
  if ("placeholder" in target) return toKebabCase(target.placeholder);
  return toKebabCase(target.testId);
}

function uniqueStepId(base: string, used: Set<string>): string {
  const safeBase = toKebabCase(base) || "step";
  let id = safeBase;
  let suffix = 2;
  while (used.has(id)) id = `${safeBase}-${suffix++}`;
  used.add(id);
  return id;
}

function semanticNameParts(name: string, kind: "input" | "output"): string[] {
  const parts = words(name);
  if (kind === "input" && ["id", "number", "code", "key"].includes(parts.at(-1) ?? "")) parts.pop();
  if (kind === "output" && parts[0] === "current") parts.shift();
  return parts;
}

function deriveCapabilityIdentity(
  inputs: InputDefinition[],
  outputs: OutputDefinition[],
  options: ArtifactBuilderOptions,
): { id: string; name: string } {
  const parts = [
    "get",
    ...inputs.flatMap(({ name }) => semanticNameParts(name, "input")),
    ...outputs.flatMap(({ name }) => semanticNameParts(name, "output")),
  ].filter((part, index, all) => index === 0 || part !== all[index - 1]);
  const id = options.capabilityId ?? toKebabCase(parts.join(" "));
  return { id, name: options.capabilityName ?? titleCase(parts.join(" ")) };
}

function assertSuccessfulRun(run: DiscoveryRun): void {
  if (run === null || typeof run !== "object") throw new Error("Discovery evidence must be an object.");
  if (run.status !== "success") throw new Error(`Cannot build an artifact from a ${String(run.status)} discovery run.`);
  if (!run.runId || !run.goal || !Array.isArray(run.steps) || run.steps.length === 0) {
    throw new Error("Discovery evidence is missing runId, goal, or steps.");
  }
}

export class ArtifactBuilder {
  private readonly validator: ArtifactValidator;
  private readonly now: () => Date;
  private readonly timeoutMs: number;

  constructor(
    private readonly options: ArtifactBuilderOptions = {},
    validator: ArtifactValidator = new ArtifactValidator(),
  ) {
    this.validator = validator;
    this.now = options.now ?? (() => new Date());
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    if (!Number.isInteger(this.timeoutMs) || this.timeoutMs < 1 || this.timeoutMs > 120_000) {
      throw new Error("Artifact step timeout must be an integer between 1 and 120000 milliseconds.");
    }
  }

  build(run: DiscoveryRun): CapabilityArtifact {
    assertSuccessfulRun(run);
    const successfulDecisions = run.steps
      .filter((step) => step.decision !== undefined && step.result?.success === true)
      .map((step) => step.decision!);
    const bindings = this.deriveInputs(successfulDecisions);
    const outputs = this.deriveOutputs(run, bindings);
    const dynamicValues = [
      ...bindings.map(({ concreteValue }) => concreteValue),
      ...Object.values(run.outputs ?? {}),
    ];
    const firstUrl = new URL(run.steps[0]!.url);
    const usedIds = new Set<string>();
    const steps: CapabilityStep[] = [];

    const entryPath = `${firstUrl.pathname}${firstUrl.search}${firstUrl.hash}`;
    steps.push({
      id: uniqueStepId(`navigate-${firstUrl.pathname.split("/").filter(Boolean).at(-1) ?? "home"}`, usedIds),
      action: "navigate",
      value: resolveStepValue(entryPath || "/", bindings),
      timeoutMs: this.timeoutMs,
      expected: { kind: "url_matches", value: replaceConcreteInputs(entryPath || "/", bindings) },
    });

    for (let index = 0; index < successfulDecisions.length; index += 1) {
      const decision = successfulDecisions[index]!;
      if (decision.action === "finish" || decision.action === "fail") continue;
      if (decision.action === "wait" && decision.target === undefined) {
        const nextTarget = successfulDecisions.slice(index + 1).find((candidate) => candidate.target !== undefined)?.target;
        if (nextTarget === undefined) continue;
        const target = toArtifactTarget(nextTarget, dynamicValues);
        steps.push({
          id: uniqueStepId(`wait-for-${targetSlug(target)}`, usedIds),
          action: "wait_for",
          target,
          timeoutMs: this.timeoutMs,
          expected: { kind: "visible", target },
        });
        continue;
      }
      const mapped = this.mapDecision(decision, bindings, dynamicValues, usedIds);
      if (mapped !== undefined) steps.push(mapped);
    }

    const extractionSteps = steps.filter(
      (step): step is Extract<CapabilityStep, { action: "extract" }> => step.action === "extract",
    );
    const checkpointConditions: CheckpointCondition[] = [];
    for (const step of extractionSteps) {
      checkpointConditions.push({ kind: "visible", target: step.target });
      checkpointConditions.push({ kind: "output_present", output: step.output });
    }

    const identity = deriveCapabilityIdentity(bindings.map(({ definition }) => definition), outputs, this.options);
    const artifact: CapabilityArtifact = {
      schemaVersion: CAPABILITY_SCHEMA_VERSION,
      capability: {
        id: identity.id,
        name: identity.name,
        description: replaceConcreteInputs(run.goal, bindings),
        version: this.options.capabilityVersion ?? 1,
      },
      target: {
        app: run.steps[0]!.observation.title || "Web application",
        baseUrl: firstUrl.origin,
      },
      inputs: bindings.map(({ definition }) => definition),
      outputs,
      steps,
      checkpoint: { type: "all", conditions: checkpointConditions },
      policy: {
        allowedActions: [...new Set(steps.map(({ action }) => action))],
        riskLevel: "safe",
      },
      metadata: {
        createdAt: this.now().toISOString(),
        sourceRunId: run.runId,
      },
    };
    const executable = JSON.stringify({ ...artifact, metadata: undefined });
    for (const [name, value] of Object.entries(run.outputs ?? {})) {
      if (value.length >= 4 && executable.includes(value)) {
        throw new Error(`Discovery-time output value for "${name}" would be persisted in the artifact.`);
      }
    }
    return this.validator.validate(artifact);
  }

  private deriveInputs(decisions: AgentDecision[]): InputBinding[] {
    const bindings = new Map<string, InputBinding>();
    for (const decision of decisions) {
      if (decision.action !== "type" || decision.target === undefined || decision.value === undefined) continue;
      if (SENSITIVE_TARGET.test(targetDescription(decision.target))) {
        throw new Error("Discovery contains a sensitive typed value that cannot be stored in a capability artifact.");
      }
      if (decision.inputName === undefined) {
        throw new Error(`Successful type decision for "${targetDescription(decision.target)}" has no inputName.`);
      }
      const name = decision.inputName;
      const existing = bindings.get(name);
      if (existing !== undefined && existing.concreteValue !== decision.value) {
        throw new Error(`Discovery assigned multiple values to input "${name}".`);
      }
      bindings.set(name, {
        definition: {
          name,
          type: "string",
          required: true,
          description: `Value for ${targetDescription(decision.target)}.`,
        },
        concreteValue: decision.value,
      });
    }
    return [...bindings.values()];
  }

  private deriveOutputs(run: DiscoveryRun, bindings: InputBinding[]): OutputDefinition[] {
    const inputValues = new Set(bindings.map(({ concreteValue }) => concreteValue));
    const names = new Set<string>();
    for (const step of run.steps) {
      if (step.decision?.action === "read" && step.result?.success && step.decision.outputName !== undefined) {
        names.add(step.decision.outputName);
      }
    }
    for (const [name, value] of Object.entries(run.outputs ?? {})) {
      if (!inputValues.has(value) && !names.has(name)) {
        throw new Error(`Output "${name}" has no successful structured read extraction.`);
      }
    }
    if (names.size === 0) throw new Error("Successful discovery did not produce a reusable output.");
    return [...names].map((name) => ({ name, type: "string" as const }));
  }

  private mapDecision(
    decision: AgentDecision,
    bindings: InputBinding[],
    dynamicValues: string[],
    usedIds: Set<string>,
  ): CapabilityStep | undefined {
    switch (decision.action) {
      case "navigate": {
        if (decision.value === undefined) throw new Error("Successful navigate decision has no value.");
        return {
          id: uniqueStepId("navigate", usedIds),
          action: "navigate",
          value: resolveStepValue(decision.value, bindings),
          timeoutMs: this.timeoutMs,
          expected: { kind: "action_succeeds" },
        };
      }
      case "click": {
        const target = toArtifactTarget(decision.target!, dynamicValues);
        return {
          id: uniqueStepId(`click-${targetSlug(target)}`, usedIds),
          action: "click",
          target,
          timeoutMs: this.timeoutMs,
          expected: { kind: "action_succeeds" },
        };
      }
      case "type": {
        if (decision.value === undefined) throw new Error("Successful type decision has no value.");
        const target = toArtifactTarget(decision.target!, dynamicValues);
        return {
          id: uniqueStepId(`type-${targetSlug(target)}`, usedIds),
          action: "type",
          target,
          value: resolveStepValue(decision.value, bindings),
          timeoutMs: this.timeoutMs,
          expected: { kind: "action_succeeds" },
        };
      }
      case "read": {
        if (decision.outputName === undefined) throw new Error("Successful read decision has no outputName.");
        const target = toArtifactTarget(decision.target!, dynamicValues);
        if (decision.extractionPattern !== undefined && /\d{3,}/.test(decision.extractionPattern)) {
          throw new Error(`Extraction pattern for output "${decision.outputName}" contains a copied literal value.`);
        }
        return {
          id: uniqueStepId(`extract-${decision.outputName}`, usedIds),
          action: "extract",
          target,
          output: decision.outputName,
          ...(decision.extractionPattern === undefined ? {} : { pattern: decision.extractionPattern }),
          timeoutMs: this.timeoutMs,
          expected: { kind: "output_present", output: decision.outputName },
        };
      }
      case "wait": {
        const target = toArtifactTarget(decision.target!, dynamicValues);
        return {
          id: uniqueStepId(`wait-for-${targetSlug(target)}`, usedIds),
          action: "wait_for",
          target,
          timeoutMs: this.timeoutMs,
          expected: { kind: "visible", target },
        };
      }
      case "finish":
      case "fail":
        return undefined;
    }
  }
}
