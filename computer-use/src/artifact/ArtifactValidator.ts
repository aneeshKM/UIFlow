import { z } from "zod";
import { CapabilityArtifactSchema } from "./schema.js";
import type { CapabilityArtifact, CheckpointCondition, StepExpectation } from "./types.js";

const TEMPLATE_REFERENCE = /\{\{([A-Za-z][A-Za-z0-9_]*)\}\}/g;
const SENSITIVE_KEY = /password|passcode|secret|api[_-]?key|authorization|cookie|session[_-]?id|access[_-]?token|refresh[_-]?token/i;
const SENSITIVE_VALUE = /\bsk-[A-Za-z0-9_-]{12,}\b|\bBearer\s+[A-Za-z0-9._~+\/-]+=*|\[REDACTED\]/i;

export class ArtifactValidationError extends Error {
  readonly issues: string[];

  constructor(issues: string[]) {
    super(`Capability artifact is invalid:\n- ${issues.join("\n- ")}`);
    this.name = "ArtifactValidationError";
    this.issues = issues;
  }
}

function formatZodIssue(issue: z.core.$ZodIssue): string {
  const path = issue.path.length === 0 ? "artifact" : issue.path.join(".");
  return `${path}: ${issue.message}`;
}

function collectConditionOutput(condition: CheckpointCondition | StepExpectation): string | undefined {
  return condition.kind === "output_present" ? condition.output : undefined;
}

function collectSensitiveValues(value: unknown, path: string, issues: string[]): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectSensitiveValues(item, `${path}.${index}`, issues));
    return;
  }
  if (value === null || typeof value !== "object") {
    if (typeof value === "string" && SENSITIVE_VALUE.test(value)) {
      issues.push(`${path}: contains a secret or redacted secret value`);
    }
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    if (SENSITIVE_KEY.test(key)) issues.push(`${path}.${key}: sensitive fields are not allowed`);
    collectSensitiveValues(child, `${path}.${key}`, issues);
  }
}

function duplicateNames(values: string[]): string[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    if (seen.has(value)) return true;
    seen.add(value);
    return false;
  });
}

export class ArtifactValidator {
  validate(input: unknown): CapabilityArtifact {
    const parsed = CapabilityArtifactSchema.safeParse(input);
    if (!parsed.success) {
      throw new ArtifactValidationError(parsed.error.issues.map(formatZodIssue));
    }

    const artifact = parsed.data as CapabilityArtifact;
    const issues: string[] = [];
    const inputNames = new Set(artifact.inputs.map(({ name }) => name));
    const outputNames = new Set(artifact.outputs.map(({ name }) => name));
    const outputsByName = new Map(artifact.outputs.map((output) => [output.name, output]));
    const allowedActions = new Set(artifact.policy.allowedActions);

    for (const name of duplicateNames(artifact.inputs.map(({ name }) => name))) {
      issues.push(`inputs: duplicate input "${name}"`);
    }
    for (const name of duplicateNames(artifact.outputs.map(({ name }) => name))) {
      issues.push(`outputs: duplicate output "${name}"`);
    }
    for (const id of duplicateNames(artifact.steps.map(({ id }) => id))) {
      issues.push(`steps: duplicate step id "${id}"`);
    }

    artifact.steps.forEach((step, index) => {
      if (!allowedActions.has(step.action)) {
        issues.push(`steps.${index}.action: "${step.action}" is not permitted by policy.allowedActions`);
      }
      if ("value" in step) {
        if ("input" in step.value && !inputNames.has(step.value.input)) {
          issues.push(`steps.${index}.value.input: unknown input "${step.value.input}"`);
        }
        if ("template" in step.value) {
          const references = [...step.value.template.matchAll(TEMPLATE_REFERENCE)].map((match) => match[1]!);
          if (references.length === 0) {
            issues.push(`steps.${index}.value.template: must contain at least one {{input}} reference`);
          }
          for (const reference of references) {
            if (!inputNames.has(reference)) {
              issues.push(`steps.${index}.value.template: unknown input "${reference}"`);
            }
          }
        }
      }
      if ((step.action === "extract" || step.action === "extract_many") && !outputNames.has(step.output)) {
        issues.push(`steps.${index}.output: unknown output "${step.output}"`);
      }
      if ((step.action === "extract" || step.action === "extract_many") && step.pattern !== undefined) {
        try {
          new RegExp(step.pattern);
        } catch {
          issues.push(`steps.${index}.pattern: must be a valid regular expression`);
        }
      }
      if (step.action === "extract") {
        const output = outputsByName.get(step.output);
        if (output !== undefined && output.type !== "string") {
          issues.push(`steps.${index}.output: extract requires a string output`);
        }
      }
      if (step.action === "extract_many") {
        const output = outputsByName.get(step.output);
        if (output !== undefined && output.type !== "record_list") {
          issues.push(`steps.${index}.output: extract_many requires a record_list output`);
        }
        if (output?.type === "record_list") {
          const declaredFields = output.fields?.map(({ name }) => name) ?? [];
          if (JSON.stringify(step.fields) !== JSON.stringify(declaredFields)) {
            issues.push(`steps.${index}.fields: must match the output record fields in order`);
          }
        }
        for (const field of duplicateNames(step.fields)) {
          issues.push(`steps.${index}.fields: duplicate field "${field}"`);
        }
      }
      const expectedOutput = collectConditionOutput(step.expected);
      if (expectedOutput !== undefined && !outputNames.has(expectedOutput)) {
        issues.push(`steps.${index}.expected.output: unknown output "${expectedOutput}"`);
      }
      if (step.action === "assert") {
        const assertedOutput = collectConditionOutput(step.condition);
        if (assertedOutput !== undefined && !outputNames.has(assertedOutput)) {
          issues.push(`steps.${index}.condition.output: unknown output "${assertedOutput}"`);
        }
      }
    });

    artifact.checkpoint.conditions.forEach((condition, index) => {
      const output = collectConditionOutput(condition);
      if (output !== undefined && !outputNames.has(output)) {
        issues.push(`checkpoint.conditions.${index}.output: unknown output "${output}"`);
      }
    });

    for (const output of outputNames) {
      if (!artifact.steps.some((step) =>
        (step.action === "extract" || step.action === "extract_many") && step.output === output)) {
        issues.push(`outputs: "${output}" has no extraction step`);
      }
    }

    collectSensitiveValues(artifact, "artifact", issues);
    if (issues.length > 0) throw new ArtifactValidationError([...new Set(issues)]);
    return artifact;
  }
}
