import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import type { DiscoveryRun } from "../src/agent/types.js";
import { ArtifactBuilder } from "../src/artifact/ArtifactBuilder.js";
import { ArtifactStore } from "../src/artifact/ArtifactStore.js";
import { ArtifactValidationError, ArtifactValidator } from "../src/artifact/ArtifactValidator.js";
import type { CapabilityArtifact } from "../src/artifact/types.js";
import type { SurfaceObservation } from "../src/browser/types.js";

const timestamp = "2026-09-15T12:00:00.000Z";

function observation(url: string, ariaSnapshot: string): SurfaceObservation {
  return { url, title: "bank-app", visibleText: ariaSnapshot, ariaSnapshot, timestamp };
}

function successfulRun(): DiscoveryRun {
  const search = observation(
    "http://localhost:5174/members",
    '- heading "Member Search"\n- textbox "Member Number"\n- button "Search"',
  );
  const results = observation(
    "http://localhost:5174/members",
    '- table:\n  - row "12345 John Smith Active View"\n    - link "View"',
  );
  const member = observation(
    "http://localhost:5174/members/12345",
    '- heading "Member Information"\n- table:\n  - row "Savings ****4521 $4,281.50 Open View"',
  );
  return {
    runId: "run-1",
    goal: "Look up member 12345 and read their current savings balance.",
    startedAt: timestamp,
    completedAt: timestamp,
    status: "success",
    steps: [
      {
        step: 1,
        url: search.url,
        observation: search,
        decision: {
          action: "type",
          target: { role: "textbox", name: "Member Number" },
          value: "12345",
          inputName: "memberId",
          decisionSummary: "The member must be located using the visible Member Number field.",
        },
        result: { success: true, action: "type" },
      },
      {
        step: 2,
        url: search.url,
        observation: search,
        decision: {
          action: "click",
          target: { role: "button", name: "Search" },
          decisionSummary: "The visible Search button starts the requested member lookup.",
        },
        result: { success: true, action: "click" },
      },
      {
        step: 3,
        url: search.url,
        observation: search,
        decision: { action: "wait", decisionSummary: "The observable search is still loading." },
        result: { success: true, action: "wait" },
      },
      {
        step: 4,
        url: results.url,
        observation: results,
        decision: {
          action: "click",
          target: { role: "link", name: "View" },
          decisionSummary: "The matching result has a visible View link.",
        },
        result: { success: true, action: "click" },
      },
      {
        step: 5,
        url: member.url,
        observation: member,
        decision: {
          action: "read",
          target: { role: "row", name: "Savings" },
          outputName: "currentSavingsBalance",
          extractionPattern: "\\$-?[0-9,]+\\.[0-9]{2}",
          decisionSummary: "The visible Savings row contains the requested balance.",
        },
        result: { success: true, action: "read", value: "$4,281.50" },
      },
      {
        step: 6,
        url: member.url,
        observation: member,
        decision: {
          action: "finish",
          decisionSummary: "The requested balance has been extracted and verified.",
          result: { currentSavingsBalance: "$4,281.50" },
        },
        result: { success: true, action: "finish" },
      },
    ],
    outputs: { currentSavingsBalance: "$4,281.50" },
  };
}

test("builds a validated, parameterized artifact from a successful discovery", () => {
  const artifact = new ArtifactBuilder({ now: () => new Date(timestamp) }).build(successfulRun());

  expect(artifact.inputs).toEqual([{
    name: "memberId",
    type: "string",
    required: true,
    description: "Value for textbox Member Number.",
  }]);
  expect(artifact.outputs).toEqual([{ name: "currentSavingsBalance", type: "string" }]);
  expect(artifact.steps).toContainEqual(expect.objectContaining({
    action: "type",
    target: { role: "textbox", name: "Member Number" },
    value: { input: "memberId" },
  }));
  expect(artifact.steps).toContainEqual(expect.objectContaining({
    action: "wait_for",
    target: { role: "link", name: "View" },
  }));
  expect(artifact.steps).toContainEqual(expect.objectContaining({
    action: "extract",
    target: { role: "row", name: "Savings" },
    output: "currentSavingsBalance",
    pattern: "\\$-?[0-9,]+\\.[0-9]{2}",
  }));
  expect(artifact.checkpoint.conditions).toContainEqual({
    kind: "output_present",
    output: "currentSavingsBalance",
  });
  expect(() => new ArtifactValidator().validate(artifact)).not.toThrow();
});

test("excludes concrete inputs, observed outputs, and decision summaries", () => {
  const artifact = new ArtifactBuilder({ now: () => new Date(timestamp) }).build(successfulRun());
  const serialized = JSON.stringify(artifact);

  expect(serialized).not.toContain("12345");
  expect(serialized).not.toContain("$4,281.50");
  expect(serialized).not.toContain("decisionSummary");
  expect(serialized).not.toContain("The member must be located");
  expect(serialized).not.toContain("The requested balance has been extracted");
  expect(artifact.capability.description).toContain("{{memberId}}");
});

test("refuses to build from an unsuccessful discovery", () => {
  const run = successfulRun();
  run.status = "failure";
  expect(() => new ArtifactBuilder().build(run)).toThrow("Cannot build an artifact from a failure discovery run");
});

test("fails instead of guessing an extraction for an undeclared finish output", () => {
  const run = successfulRun();
  run.outputs = { currentSavingsBalance: "$4,281.50", guessedValue: "unverified" };

  expect(() => new ArtifactBuilder().build(run)).toThrow(
    'Output "guessedValue" has no successful structured read extraction',
  );
});

test("rejects a locator that persists the discovery-time output value", () => {
  const run = successfulRun();
  const read = run.steps.find((step) => step.decision?.action === "read")!;
  read.decision!.target = { role: "cell", name: "$4,281.50", text: "$4,281.50" };

  expect(() => new ArtifactBuilder().build(run)).toThrow(
    "discovery-time runtime value instead of a stable label",
  );
});

test("reduces a value-bearing row name to its stable semantic prefix", () => {
  const run = successfulRun();
  const read = run.steps.find((step) => step.decision?.action === "read")!;
  read.decision!.target = { role: "row", name: "Savings ****4521 $4,281.50 Open View" };

  const artifact = new ArtifactBuilder({ now: () => new Date(timestamp) }).build(run);

  expect(artifact.steps).toContainEqual(expect.objectContaining({
    action: "extract",
    target: { role: "row", name: "Savings" },
  }));
});

test("rejects extraction patterns copied from discovery-time numeric values", () => {
  const run = successfulRun();
  const read = run.steps.find((step) => step.decision?.action === "read")!;
  read.decision!.extractionPattern = "(\\$4,281\\.50)";

  expect(() => new ArtifactBuilder().build(run)).toThrow("contains a copied literal value");
});

test("builds the same executable flow from the same discovery run", () => {
  const first = new ArtifactBuilder({ now: () => new Date("2026-09-15T12:00:00.000Z") }).build(successfulRun());
  const second = new ArtifactBuilder({ now: () => new Date("2026-09-16T12:00:00.000Z") }).build(successfulRun());

  expect({ ...first, metadata: undefined }).toEqual({ ...second, metadata: undefined });
  expect(first.metadata.sourceRunId).toBe(second.metadata.sourceRunId);
});

test("rejects invalid references and undeclared actions before storage", () => {
  const artifact = new ArtifactBuilder({ now: () => new Date(timestamp) }).build(successfulRun());
  const invalid = structuredClone(artifact) as CapabilityArtifact;
  const typeStep = invalid.steps.find((step) => step.action === "type")!;
  if (typeStep.action === "type") typeStep.value = { input: "unknownInput" };
  invalid.policy.allowedActions = invalid.policy.allowedActions.filter((action) => action !== "type");

  expect(() => new ArtifactValidator().validate(invalid)).toThrow(ArtifactValidationError);
  expect(() => new ArtifactValidator().validate(invalid)).toThrow("unknown input");
});

test("saves, lists, loads, and validates JSON artifacts", async () => {
  const directory = await mkdtemp(join(tmpdir(), "capability-artifacts-"));
  try {
    const artifact = new ArtifactBuilder({ now: () => new Date(timestamp) }).build(successfulRun());
    const store = new ArtifactStore(directory);
    const path = await store.save(artifact);

    expect(await store.list()).toEqual(["get-member-savings-balance.v1.json"]);
    expect(await store.load("get-member-savings-balance.v1.json")).toEqual(artifact);
    expect(JSON.parse(await readFile(path, "utf8"))).toEqual(artifact);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("does not replace a valid artifact when a later save fails validation", async () => {
  const directory = await mkdtemp(join(tmpdir(), "capability-artifacts-"));
  try {
    const artifact = new ArtifactBuilder({ now: () => new Date(timestamp) }).build(successfulRun());
    const store = new ArtifactStore(directory);
    const path = await store.save(artifact);
    const before = await readFile(path, "utf8");
    const invalid = structuredClone(artifact) as CapabilityArtifact;
    invalid.steps[0]!.timeoutMs = 0;

    await expect(store.save(invalid)).rejects.toThrow(ArtifactValidationError);
    expect(await readFile(path, "utf8")).toBe(before);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("rejects sensitive values in an artifact", () => {
  const artifact = new ArtifactBuilder({ now: () => new Date(timestamp) }).build(successfulRun());
  const invalid = structuredClone(artifact) as CapabilityArtifact;
  invalid.capability.description = "Use Bearer abc.def.ghi to read the balance";

  expect(() => new ArtifactValidator().validate(invalid)).toThrow("secret or redacted secret value");
});
