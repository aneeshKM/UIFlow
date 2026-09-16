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
  readValues = [this.readValue];
  visible = true;
  clickFailures = 0;
  clickFailureTargetName: string | undefined;

  async navigate(url: string): Promise<ActionResult> {
    this.calls.push({ action: "navigate", url });
    return { success: true, action: "navigate" };
  }

  async click(target: LocatorSpec): Promise<ActionResult> {
    this.calls.push({ action: "click", target });
    const targetName = target.strategy === "role" ? target.name : undefined;
    if (this.clickFailures > 0
      && (this.clickFailureTargetName === undefined || targetName === this.clickFailureTargetName)) {
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

  async readTexts(target: LocatorSpec): Promise<ActionResult<string[]>> {
    this.calls.push({ action: "readTexts", target });
    return { success: true, action: "readTexts", data: this.readValues };
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

  constructor(private readonly url = "http://localhost:5174/dashboard") {}

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
  return structuredClone({
    schemaVersion: "1.0.0",
    capability: {
      id: "get-member-savings-balance",
      name: "Get Member Savings Balance",
      description: "Look up member {{memberId}} and read their current savings balance.",
      version: 1,
    },
    target: { app: "bank-app", baseUrl: "http://localhost:5174" },
    inputs: [{
      name: "memberId",
      type: "string",
      required: true,
      description: "Value for textbox Member Number.",
    }],
    outputs: [{ name: "savingsBalance", type: "string" }],
    steps: [
      {
        id: "navigate-dashboard",
        action: "navigate",
        value: { literal: "/dashboard" },
        timeoutMs: 10_000,
        expected: { kind: "url_matches", value: "/dashboard" },
      },
      {
        id: "click-members",
        action: "click",
        target: { role: "link", name: "Members" },
        timeoutMs: 10_000,
        expected: { kind: "action_succeeds" },
      },
      {
        id: "type-member-number",
        action: "type",
        target: { role: "textbox", name: "Member Number" },
        value: { input: "memberId" },
        timeoutMs: 10_000,
        expected: { kind: "action_succeeds" },
      },
      {
        id: "click-search",
        action: "click",
        target: { role: "button", name: "Search" },
        timeoutMs: 10_000,
        expected: { kind: "action_succeeds" },
      },
      {
        id: "wait-for-view",
        action: "wait_for",
        target: { role: "link", name: "View" },
        timeoutMs: 10_000,
        expected: { kind: "visible", target: { role: "link", name: "View" } },
      },
      {
        id: "click-view",
        action: "click",
        target: { role: "link", name: "View" },
        timeoutMs: 10_000,
        expected: { kind: "action_succeeds" },
      },
      {
        id: "extract-savings-balance",
        action: "extract",
        target: { role: "row", name: "Savings" },
        output: "savingsBalance",
        pattern: "(\\$-?[\\d,]+\\.\\d{2})",
        timeoutMs: 10_000,
        expected: { kind: "output_present", output: "savingsBalance" },
      },
    ],
    checkpoint: {
      type: "all",
      conditions: [
        { kind: "visible", target: { role: "row", name: "Savings" } },
        { kind: "output_present", output: "savingsBalance" },
      ],
    },
    policy: {
      allowedActions: ["navigate", "click", "type", "wait_for", "extract"],
      riskLevel: "safe",
    },
    metadata: {
      createdAt: "2026-09-15T12:00:00.000Z",
      sourceRunId: "fixture-run",
    },
  } satisfies CapabilityArtifact);
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
    .toEqual(["navigate", "click", "fill", "click", "waitFor", "click", "readText"]);
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
    completedSteps: 7,
    durationMs: 0,
  });
});

test("extract_many returns every matching row as an ordered record list", async () => {
  const capability = await artifact();
  capability.outputs = [{
    name: "savingsAccounts",
    type: "record_list",
    fields: [
      { name: "accountNumber", type: "string" },
      { name: "availableBalance", type: "string" },
      { name: "status", type: "string" },
    ],
  }];
  const extractionIndex = capability.steps.findIndex((step) => step.action === "extract");
  capability.steps[extractionIndex] = {
    id: "extract-savings-accounts",
    action: "extract_many",
    target: { role: "row", name: "Savings" },
    output: "savingsAccounts",
    fields: ["accountNumber", "availableBalance", "status"],
    pattern: "Savings\\s+(\\*{4}\\d{4})\\s+(\\$-?[\\d,]+\\.\\d{2})\\s+(\\S+)",
    timeoutMs: 10_000,
    expected: { kind: "output_present", output: "savingsAccounts" },
  };
  capability.checkpoint.conditions = [
    { kind: "visible", target: { role: "row", name: "Savings" } },
    { kind: "output_present", output: "savingsAccounts" },
  ];
  capability.policy.allowedActions = ["navigate", "click", "type", "wait_for", "extract_many"];
  const actions = new StubActions();
  actions.readValues = [
    "Savings ****5005 $0.00 Open View",
    "Savings ****5006 $1,000.00 Open View",
  ];
  const { engine } = createEngine(capability, actions);

  const result = await engine.run(capability, { memberId: "23457" });

  expect(result).toMatchObject({
    status: "success",
    outputs: {
      savingsAccounts: [
        { accountNumber: "****5005", availableBalance: "$0.00", status: "Open" },
        { accountNumber: "****5006", availableBalance: "$1,000.00", status: "Open" },
      ],
    },
  });
});

test("stops replay with NO_ACCOUNTS_FOUND after opening member details and before extraction", async () => {
  const capability = await artifact();
  let detections = 0;
  const noAccounts: ReplayOutcomeDetector = {
    async detect() {
      detections += 1;
      if (detections < 6) return { status: "normal" };
      return {
        status: "business_outcome",
        code: "NO_ACCOUNTS_FOUND",
        details: { memberId: "23458" },
      };
    },
  };
  const replay = createEngine(capability, new StubActions(), new StubObserver(), {
    outcomeDetector: noAccounts,
  });

  const result = await replay.engine.run(capability, { memberId: "23458" });

  expect(result).toMatchObject({
    status: "business_outcome",
    code: "NO_ACCOUNTS_FOUND",
    stepId: "click-view",
  });
  expect(replay.actions.calls.map(({ action }) => action)).toEqual([
    "navigate",
    "click",
    "fill",
    "click",
    "waitFor",
    "isVisible",
    "click",
  ]);
});

test("reconciles a missing extraction target with a settled business outcome", async () => {
  const capability = await artifact();
  let detections = 0;
  const stepExecutor: ReplayStepExecutor = {
    async execute(step) {
      if (step.action !== "extract") return { status: "success" };
      return {
        status: "failure",
        code: "LOCATOR_NOT_FOUND",
        stepId: step.id,
        message: "Savings row was not found.",
      };
    },
  };
  const outcomeDetector: ReplayOutcomeDetector = {
    async detect() {
      detections += 1;
      if (detections < 7) return { status: "normal" };
      return {
        status: "business_outcome",
        code: "NO_ACCOUNTS_FOUND",
        details: { memberId: "23458" },
      };
    },
  };
  const { engine } = createEngine(capability, new StubActions(), new StubObserver(), {
    stepExecutor,
    outcomeDetector,
  });

  await expect(engine.run(capability, { memberId: "23458" })).resolves.toMatchObject({
    status: "business_outcome",
    code: "NO_ACCOUNTS_FOUND",
    stepId: "extract-savings-balance",
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
    stepId: "navigate-dashboard",
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
    stepId: "navigate-dashboard",
  });
  expect(replay.actions.calls).toEqual([
    { action: "navigate", url: "http://localhost:5174/dashboard" },
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
  actions.clickFailureTargetName = "Search";
  const observer = new StubObserver();
  const { engine } = createEngine(capability, actions, observer);

  const result = await engine.run(capability, { memberId: "12345" });

  expect(result).toMatchObject({
    status: "failure",
    code: "LOCATOR_NOT_FOUND",
    stepId: "click-search",
    expected: { role: "button", name: "Search" },
  });
  expect(actions.calls.filter(({ action, target }) =>
    action === "click" && target?.strategy === "role" && target.name === "Search")).toHaveLength(2);
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
