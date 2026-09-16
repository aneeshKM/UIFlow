import { z } from "zod";
import { AgentRoles } from "../agent/actionSchema.js";
import { CAPABILITY_SCHEMA_VERSION } from "./types.js";

const IdentifierSchema = z.string().regex(
  /^[A-Za-z][A-Za-z0-9_]{0,63}$/,
  "must start with a letter and contain only letters, digits, or underscores",
);

const LocatorHintSchema = z.union([
  z.object({ role: z.enum(AgentRoles), name: z.string().trim().min(1) }).strict(),
  z.object({ label: z.string().trim().min(1) }).strict(),
  z.object({ text: z.string().trim().min(1) }).strict(),
  z.object({ placeholder: z.string().trim().min(1) }).strict(),
  z.object({ testId: z.string().trim().min(1) }).strict(),
]);

export const ArtifactTargetSchema = z.union([
  z.object({
    role: z.enum(AgentRoles),
    name: z.string().trim().min(1),
    fallbacks: z.array(LocatorHintSchema).min(1).optional(),
  }).strict(),
  z.object({ label: z.string().trim().min(1), fallbacks: z.array(LocatorHintSchema).min(1).optional() }).strict(),
  z.object({ text: z.string().trim().min(1), fallbacks: z.array(LocatorHintSchema).min(1).optional() }).strict(),
  z.object({
    placeholder: z.string().trim().min(1),
    fallbacks: z.array(LocatorHintSchema).min(1).optional(),
  }).strict(),
  z.object({ testId: z.string().trim().min(1), fallbacks: z.array(LocatorHintSchema).min(1).optional() }).strict(),
]);

export const StepValueSchema = z.union([
  z.object({ input: IdentifierSchema }).strict(),
  z.object({ literal: z.string() }).strict(),
  z.object({ template: z.string().min(1) }).strict(),
]);

export const CheckpointConditionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("visible"), target: ArtifactTargetSchema }).strict(),
  z.object({ kind: z.literal("output_present"), output: IdentifierSchema }).strict(),
  z.object({ kind: z.literal("url_matches"), value: z.string().trim().min(1) }).strict(),
]);

export const StepExpectationSchema = z.union([
  z.object({ kind: z.literal("action_succeeds") }).strict(),
  CheckpointConditionSchema,
]);

const StepBaseShape = {
  id: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/),
  timeoutMs: z.number().int().positive().max(120_000),
  expected: StepExpectationSchema,
};

export const CapabilityStepSchema = z.discriminatedUnion("action", [
  z.object({ ...StepBaseShape, action: z.literal("navigate"), value: StepValueSchema }).strict(),
  z.object({ ...StepBaseShape, action: z.literal("click"), target: ArtifactTargetSchema }).strict(),
  z.object({
    ...StepBaseShape,
    action: z.literal("type"),
    target: ArtifactTargetSchema,
    value: StepValueSchema,
  }).strict(),
  z.object({
    ...StepBaseShape,
    action: z.literal("extract"),
    target: ArtifactTargetSchema,
    output: IdentifierSchema,
    pattern: z.string().min(1).max(200).optional(),
  }).strict(),
  z.object({ ...StepBaseShape, action: z.literal("wait_for"), target: ArtifactTargetSchema }).strict(),
  z.object({
    ...StepBaseShape,
    action: z.literal("assert"),
    condition: CheckpointConditionSchema,
  }).strict(),
]);

export const CapabilityArtifactSchema = z.object({
  schemaVersion: z.literal(CAPABILITY_SCHEMA_VERSION),
  capability: z.object({
    id: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/),
    name: z.string().trim().min(1).max(120),
    description: z.string().trim().min(1).max(500),
    version: z.number().int().positive(),
  }).strict(),
  target: z.object({
    app: z.string().trim().min(1).max(120),
    baseUrl: z.url(),
  }).strict(),
  inputs: z.array(z.object({
    name: IdentifierSchema,
    type: z.literal("string"),
    required: z.boolean(),
    description: z.string().trim().min(1).max(200).optional(),
  }).strict()),
  outputs: z.array(z.object({
    name: IdentifierSchema,
    type: z.literal("string"),
    description: z.string().trim().min(1).max(200).optional(),
  }).strict()).min(1),
  steps: z.array(CapabilityStepSchema).min(1),
  checkpoint: z.object({
    type: z.enum(["all", "any"]),
    conditions: z.array(CheckpointConditionSchema).min(1),
  }).strict(),
  policy: z.object({
    allowedActions: z.array(z.enum(["navigate", "click", "type", "extract", "wait_for", "assert"])).min(1),
    riskLevel: z.enum(["safe", "review", "blocked"]),
  }).strict(),
  metadata: z.object({
    createdAt: z.iso.datetime({ offset: true }),
    sourceRunId: z.string().trim().min(1),
  }).strict(),
}).strict();
