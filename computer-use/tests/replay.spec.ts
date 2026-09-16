import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import type { CapabilityArtifact } from "../src/artifact/types.js";
import type { ActionResult, LocatorSpec, SurfaceObservation } from "../src/browser/types.js";
import { ActionPolicy } from "../src/policy/ActionPolicy.js";
import { CheckpointEvaluator } from "../src/replay/CheckpointEvaluator.js";
import { InputResolver } from "../src/replay/InputResolver.js";
import { ReplayEngine } from "../src/replay/ReplayEngine.js";
import { StepExecutor } from "../src/replay/StepExecutor.js";
import type {
  ReplayBrowserActions,
  ReplayCheckpointEvaluator,
  ReplayOutcomeDetector,
  ReplayStepExecutor,
  ReplaySurfaceObserver,
  RuntimeOutputs,
} from "../src/replay/types.js";

class StubActions implements ReplayBrowserActions {
  readonly calls: Array<{ action: string; target?: LocatorSpec; value?: string; url?: string }> = [];
  readValue = "Savings ****4521 $4,281.50 Open View";
  visible = true;
  clickFailures = 0;

  async navigate(url: string): Promise<ActionResult> {
    this.calls.push({ action: "navigate", url });
    return { success: true, action: "navigate" };
  }

  async click(target: LocatorSpec): Promise<ActionResult> {
    this.calls.push({ action: "click", target });
    if (this.clickFailures > 0) {
      this.clickFailures -= 1;
      return {
        success: false,
        action: "click",
        error: { type: "ELEMENT_NOT_FOUND", message: "No matching control" },
      };
    }
    return { success: true, action: "click" };
  }

  async fill(target: LocatorSpec, value: string): Promise<ActionResult> {
    this.calls.push({ action: "fill", target, value });
    return { success: true, action: "fill" };
  }

  async readText(target: LocatorSpec): Promise<ActionResult<string>> {
    this.calls.push({ action: "readText", target });
    return { success: true, action: "readText", data: this.readValue };
  }

  async waitFor(target: LocatorSpec): Promise<ActionResult> {
    this.calls.push({ action: "waitFor", target });
    return { success: true, action: "waitFor" };
  }

  async isVisible(target: LocatorSpec): Promise<ActionResult<boolean>> {
    this.calls.push({ action: "isVisible", target });
    return { success: true, action: "isVisible", data: this.visible };
  }

  async wait(): Promise<ActionResult> {
    this.calls.push({ action: "wait" });
    return { success: true, action: "wait" };
  }
}

class StubObserver implements ReplaySurfaceObserver {
  observations = 0;

  constructor(private readonly url = "http://localhost:5174/members/12345") {}

  async observe(): Promise<SurfaceObservation> {
    this.observations += 1;
    return {
      url: this.url,
      title: "bank-app",
      visibleText: "Member Information Savings $4,281.50",
      ariaSnapshot: '- heading "Member Information"',
      timestamp: "2026-09-15T12:00:00.000Z",
    };
  }
}

const normalOutcome: ReplayOutcomeDetector = {
  async detect() {
    return { status: "normal" };
  },
};

async function artifact(): Promise<CapabilityArtifact> {
  return JSON.parse(await readFile(join(process.cwd(), "artifacts", "get-member-savings-balance.v1.json"), "utf8"));
}

function createEngine(
  capability: CapabilityArtifact,
  actions = new StubActions(),
  observer = new StubObserver(),
  overrides: Partial<{
    stepExecutor: ReplayStepExecutor;
    checkpointEvaluator: ReplayCheckpointEvaluator;
    outcomeDetector: ReplayOutcomeDetector;
  }> = {},
): { engine: ReplayEngine; actions: StubActions } {
  const inputs = new InputResolver();
  const policy = new ActionPolicy("http://localhost:5174", ["/login", "/dashboard", "/members"]);
  return {
    engine: new ReplayEngine({
      stepExecutor: overrides.stepExecutor ?? new StepExecutor(actions, observer, inputs, capability.inputs, policy),
      checkpointEvaluator: overrides.checkpointEvaluator ?? new CheckpointEvaluator(actions, observer),
      outcomeDetector: overrides.outcomeDetector ?? normalOutcome,
      inputResolver: inputs,
      actionPolicy: policy,
    }, { runId: "replay-test", now: () => 100 }),
    actions,
  };
}

test("executes artifact steps in order and injects the runtime memberId", async () => {
  const capability = await artifact();
  const { engine, actions } = createEngine(capability);

  const result = await engine.run(capability, { memberId: "12345" });

  expect(result.status).toBe("success");
  expect(actions.calls.filter(({ action }) =>
    ["navigate", "fill", "click", "waitFor", "readText"].includes(action)).map(({ action }) => action))
    .toEqual(["navigate", "fill", "click", "waitFor", "click", "readText"]);
  expect(actions.calls).toContainEqual(expect.objectContaining({
    action: "fill",
    value: "12345",
    target: { strategy: "role", role: "textbox", name: "Member Number" },
  }));
});

test("stores extracted output and returns success only after the checkpoint passes", async () => {
  const capability = await artifact();
  const { engine } = createEngine(capability);

  const result = await engine.run(capability, { memberId: "12345" });

  expect(result).toEqual({
    status: "success",
    capabilityId: "get-member-savings-balance",
    capabilityVersion: 1,
    runId: "replay-test",
    outputs: { savingsBalance: "$4,281.50" },
    completedSteps: 6,
    durationMs: 0,
  });
});

test("rejects missing and unknown runtime inputs before browser execution", async () => {
  const capability = await artifact();
  const missing = createEngine(capability);
  const unknown = createEngine(capability);

  await expect(missing.engine.run(capability, {})).resolves.toMatchObject({
    status: "failure",
    code: "INVALID_INPUT",
  });
  await expect(unknown.engine.run(capability, { memberId: "12345", extra: "value" })).resolves.toMatchObject({
    status: "failure",
    code: "INVALID_INPUT",
  });
  expect(missing.actions.calls).toHaveLength(0);
  expect(unknown.actions.calls).toHaveLength(0);
});

test("rejects a runtime input with the wrong type before browser execution", async () => {
  const capability = await artifact();
  const replay = createEngine(capability);

  await expect(replay.engine.run(capability, { memberId: 12345 })).resolves.toMatchObject({
    status: "failure",
    code: "INVALID_INPUT",
  });
  expect(replay.actions.calls).toHaveLength(0);
});

test("blocks artifact navigation to an external origin", async () => {
  const capability = await artifact();
  const external = structuredClone(capability);
  const navigate = external.steps.find((step) => step.action === "navigate");
  if (navigate?.action !== "navigate") throw new Error("Expected navigate step");
  navigate.value = { literal: "https://example.com/collect" };
  const replay = createEngine(external);

  await expect(replay.engine.run(external, { memberId: "12345" })).resolves.toMatchObject({
    status: "failure",
    code: "POLICY_BLOCKED",
    stepId: "navigate-members",
    message: /outside http:\/\/localhost:5174 is blocked/,
  });
  expect(replay.actions.calls).toHaveLength(0);
});

test("stops replay when an allowed navigation redirects outside the origin", async () => {
  const capability = await artifact();
  const observer = new StubObserver("https://example.com/redirected");
  const replay = createEngine(capability, new StubActions(), observer);

  await expect(replay.engine.run(capability, { memberId: "12345" })).resolves.toMatchObject({
    status: "failure",
    code: "POLICY_BLOCKED",
    stepId: "navigate-members",
  });
  expect(replay.actions.calls).toEqual([
    { action: "navigate", url: "http://localhost:5174/members" },
  ]);
});

test("a risky step requests human intervention before the browser action", async () => {
  const capability = await artifact();
  const risky = structuredClone(capability);
  const click = risky.steps.find((step) => step.action === "click");
  if (click?.action !== "click") throw new Error("Expected click step");
  click.target = { role: "button", name: "Create account" };
  const replay = createEngine(risky);

  await expect(replay.engine.run(risky, { memberId: "12345" })).resolves.toMatchObject({
    status: "failure",
    code: "POLICY_REQUIRES_HUMAN",
    stepId: click.id,
  });
  expect(replay.actions.calls.some(({ action }) => action === "click")).toBe(false);
});

test("returns typed policy decisions for review and blocked artifacts before browser execution", async () => {
  const capability = await artifact();
  for (const riskLevel of ["review", "blocked"] as const) {
    const risky = structuredClone(capability);
    risky.policy.riskLevel = riskLevel;
    const replay = createEngine(risky);

    await expect(replay.engine.run(risky, { memberId: "12345" })).resolves.toMatchObject({
      status: "failure",
      code: riskLevel === "review" ? "POLICY_REQUIRES_HUMAN" : "POLICY_BLOCKED",
    });
    expect(replay.actions.calls).toHaveLength(0);
  }
});

test("returns CHECKPOINT_FAILED when execution does not produce the declared output", async () => {
  const capability = await artifact();
  const actions = new StubActions();
  const stepExecutor: ReplayStepExecutor = {
    async execute(): Promise<{ status: "success" }> {
      return { status: "success" };
    },
  };
  const { engine } = createEngine(capability, actions, new StubObserver(), { stepExecutor });

  await expect(engine.run(capability, { memberId: "12345" })).resolves.toMatchObject({
    status: "failure",
    code: "CHECKPOINT_FAILED",
  });
});

test("refreshes once and returns LOCATOR_NOT_FOUND for a deterministic hard failure", async () => {
  const capability = await artifact();
  const actions = new StubActions();
  actions.clickFailures = 2;
  const observer = new StubObserver();
  const { engine } = createEngine(capability, actions, observer);

  const result = await engine.run(capability, { memberId: "12345" });

  expect(result).toMatchObject({
    status: "failure",
    code: "LOCATOR_NOT_FOUND",
    stepId: "click-search",
    expected: { role: "button", name: "Search" },
  });
  expect(actions.calls.filter(({ action }) => action === "click")).toHaveLength(2);
  expect(observer.observations).toBeGreaterThan(0);
});

test("replay source has no discovery or model dependency", async () => {
  const sourceFiles = [
    "types.ts",
    "InputResolver.ts",
    "StepExecutor.ts",
    "CheckpointEvaluator.ts",
    "OutcomeDetector.ts",
    "ReplayEngine.ts",
  ];
  const source = (await Promise.all(sourceFiles.map((filename) =>
    readFile(join(process.cwd(), "src", "replay", filename), "utf8")))).join("\n");

  expect(source).not.toMatch(/OpenAIModel|DiscoveryAgent|prompt\.js|\/llm\//);
});
