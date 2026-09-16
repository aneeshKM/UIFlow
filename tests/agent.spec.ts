import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { zodTextFormat } from "openai/helpers/zod";
import { DiscoveryAgent, type DiscoveryBrowserActions, type DiscoverySurfaceObserver } from "../src/agent/DiscoveryAgent.js";
import { redactDiscoveryRun } from "../src/agent/DiscoveryAgent.js";
import { AgentDecisionSchema, parseAgentDecision } from "../src/agent/actionSchema.js";
import type { AgentDecision, AgentDecisionContext, AgentModel, DiscoveryRun } from "../src/agent/types.js";
import type { ActionResult, LocatorSpec, SurfaceObservation } from "../src/browser/types.js";
import { ActionPolicy } from "../src/policy/ActionPolicy.js";
import type { InterventionDetails, InterventionHandler } from "../src/escalation/types.js";
import { createDiscoveryEvidencePaths } from "../src/evidence/paths.js";

const bankUrl = "http://localhost:5174";
const observation: SurfaceObservation = {
  url: `${bankUrl}/members`,
  title: "bank-app",
  visibleText: "Member Search Search",
  ariaSnapshot: '- heading "Member Search"\n- button "Search"',
  timestamp: "2026-09-15T12:00:00.000Z",
};

class SequenceModel implements AgentModel {
  calls = 0;
  readonly contexts: AgentDecisionContext[] = [];

  constructor(private readonly decisions: AgentDecision[]) {}

  async decideNextAction(context: AgentDecisionContext): Promise<AgentDecision> {
    this.contexts.push(context);
    const decision = this.decisions[Math.min(this.calls, this.decisions.length - 1)];
    this.calls += 1;
    if (decision === undefined) throw new Error("No model decision configured.");
    return decision;
  }
}

class StubObserver implements DiscoverySurfaceObserver {
  calls = 0;

  async observe(): Promise<SurfaceObservation> {
    this.calls += 1;
    return { ...observation, visibleText: `${observation.visibleText} observation-${this.calls}` };
  }

  async captureScreenshot(): Promise<Buffer> {
    return Buffer.from("screenshot");
  }
}

class SequenceObserver implements DiscoverySurfaceObserver {
  calls = 0;

  constructor(private readonly observations: SurfaceObservation[]) {}

  async observe(): Promise<SurfaceObservation> {
    const value = this.observations[Math.min(this.calls, this.observations.length - 1)];
    this.calls += 1;
    if (value === undefined) throw new Error("No observation configured.");
    return value;
  }

  async captureScreenshot(): Promise<Buffer> {
    return Buffer.from("screenshot");
  }
}

class StubActions implements DiscoveryBrowserActions {
  readonly calls: Array<{ action: string; target?: LocatorSpec; value?: string }> = [];

  async navigate(value: string): Promise<ActionResult> {
    this.calls.push({ action: "navigate", value });
    return { success: true, action: "navigate" };
  }

  async click(target: LocatorSpec): Promise<ActionResult> {
    this.calls.push({ action: "click", target });
    return { success: true, action: "click" };
  }

  async fill(target: LocatorSpec, value: string): Promise<ActionResult> {
    this.calls.push({ action: "fill", target, value });
    return { success: true, action: "fill" };
  }

  async readText(target: LocatorSpec): Promise<ActionResult<string>> {
    this.calls.push({ action: "read", target });
    return { success: true, action: "readText", data: "$4,281.50" };
  }

  async readTexts(target: LocatorSpec): Promise<ActionResult<string[]>> {
    this.calls.push({ action: "read_many", target });
    return { success: true, action: "readTexts", data: ["Savings ****4521 $4,281.50 Open View"] };
  }

  async waitFor(target: LocatorSpec): Promise<ActionResult> {
    this.calls.push({ action: "waitFor", target });
    return { success: true, action: "waitFor" };
  }

  async wait(): Promise<ActionResult> {
    this.calls.push({ action: "wait" });
    return { success: true, action: "wait" };
  }
}

function createAgent(
  model: AgentModel,
  actions: StubActions,
  maxSteps = 5,
  interventionManager?: InterventionHandler,
  observer: DiscoverySurfaceObserver = new StubObserver(),
  stallLimit = 10,
): DiscoveryAgent {
  return new DiscoveryAgent(
    model,
    observer,
    actions,
    new ActionPolicy(bankUrl),
    { maxSteps, runTimeoutMs: 5_000, stallLimit, interventionManager },
  );
}

test("executes a model click through the browser layer", async () => {
  const actions = new StubActions();
  const model = new SequenceModel([
    { action: "click", target: { role: "button", name: "Search" }, decisionSummary: "The visible Search button starts the requested member lookup." },
    { action: "finish", decisionSummary: "The requested action is complete.", result: {} },
  ]);

  const run = await createAgent(model, actions).run("Find the member");

  expect(run.status).toBe("success");
  expect(actions.calls).toContainEqual({
    action: "click",
    target: { strategy: "role", role: "button", name: "Search" },
  });
});

test("blocks external navigation without calling the browser", async () => {
  const actions = new StubActions();
  const model = new SequenceModel([
    { action: "navigate", value: "https://google.com", decisionSummary: "The selected navigation would leave the application." },
  ]);

  const run = await createAgent(model, actions).run("Find the member");

  expect(run.status).toBe("failure");
  expect(run.stopReason).toContain("policy_rejected");
  expect(actions.calls).toHaveLength(0);
});

test("finish ends the loop immediately", async () => {
  const actions = new StubActions();
  const model = new SequenceModel([
    {
      action: "read",
      target: { role: "row", name: "Savings" },
      outputName: "savingsBalance",
      extractionPattern: "\\$-?[0-9,]+\\.[0-9]{2}",
      decisionSummary: "The visible Savings row contains the balance requested by the goal.",
    },
    { action: "finish", decisionSummary: "The requested balance has been verified.", result: { savingsBalance: "$4,281.50" } },
  ]);

  const run = await createAgent(model, actions).run("Read the balance");

  expect(run.status).toBe("success");
  expect(run.steps).toHaveLength(2);
  expect(run.outputs).toEqual({ savingsBalance: "$4,281.50" });
  expect(model.calls).toBe(2);
});

test("returns a business outcome before calling the model when the member has no accounts", async () => {
  const actions = new StubActions();
  const model = new SequenceModel([{ action: "finish", decisionSummary: "No model action should be needed.", result: {} }]);
  const missingAccounts: SurfaceObservation = {
    ...observation,
    url: `${bankUrl}/members/23458`,
    visibleText: "Member Information No accounts found for member 23458.",
    ariaSnapshot: '- heading "Member Information"\n- status: No accounts found for member 23458.',
  };

  const run = await createAgent(
    model,
    actions,
    5,
    undefined,
    new SequenceObserver([missingAccounts]),
  ).run("Read the savings balance for 23458");

  expect(run).toMatchObject({
    status: "business_outcome",
    businessOutcome: {
      code: "NO_ACCOUNTS_FOUND",
      details: { memberId: "23458" },
    },
  });
  expect(model.calls).toBe(0);
  expect(actions.calls).toHaveLength(0);
});

test("accepts a schema- and policy-valid model-proposed business outcome", async () => {
  const actions = new StubActions();
  const accountResults: SurfaceObservation = {
    ...observation,
    url: `${bankUrl}/members/23457`,
    visibleText: [
      "Member Information",
      "Member ID 23457",
      "Accounts",
      "Account Type Account Number Available Balance Current Balance Status",
      "Savings ****5005 $0.00 $0.00 Open",
      "Savings ****5006 $1,000.00 $1,000.00 Open",
    ].join("\n"),
    ariaSnapshot: '- heading "Member Information"\n- text: "Member ID 23457"\n- row "Savings ****5005 $0.00 $0.00 Open"\n- row "Savings ****5006 $1,000.00 $1,000.00 Open"',
  };
  const model = new SequenceModel([{
    action: "business_outcome",
    businessOutcome: {
      code: "REQUESTED_ACCOUNT_NOT_FOUND",
      details: { accountEnding: "5007" },
    },
    decisionSummary: "The completed account list does not contain the requested account ending 5007.",
  }]);

  const run = await createAgent(
    model,
    actions,
    5,
    undefined,
    new SequenceObserver([accountResults]),
  ).run("Check the savings balance for member 23457 with account ending from 5007");

  expect(run).toMatchObject({
    status: "business_outcome",
    businessOutcome: {
      code: "REQUESTED_ACCOUNT_NOT_FOUND",
      details: { accountEnding: "5007" },
    },
    steps: [{
      result: { success: true, action: "business_outcome" },
    }],
  });
  expect(run.interventions).toBeUndefined();
  expect(actions.calls).toHaveLength(0);
});

test("rejects a business-outcome action without its structured payload", async () => {
  const actions = new StubActions();
  const model = new SequenceModel([{
    action: "business_outcome",
    decisionSummary: "The settled UI indicates an expected business outcome.",
  }]);

  const run = await createAgent(model, actions).run("Check the requested account");

  expect(run).toMatchObject({ status: "failure" });
  expect(run.stopReason).toContain("business_outcome requires a structured businessOutcome");
  expect(actions.calls).toHaveLength(0);
});

test("rejects a business-outcome payload attached to another action", async () => {
  const actions = new StubActions();
  const model = new SequenceModel([{
    action: "finish",
    businessOutcome: {
      code: "REQUESTED_ACCOUNT_NOT_FOUND",
      details: { accountEnding: "5007" },
    },
    decisionSummary: "The requested workflow is complete.",
    result: {},
  }]);

  const run = await createAgent(model, actions).run("Check the requested account");

  expect(run).toMatchObject({ status: "failure" });
  expect(run.stopReason).toContain("businessOutcome is only allowed with the business_outcome action");
  expect(actions.calls).toHaveLength(0);
});

test("waits once for a transient loading state without calling the model", async () => {
  const actions = new StubActions();
  const model = new SequenceModel([{ action: "finish", decisionSummary: "The observable page has settled.", result: {} }]);
  const observer = new SequenceObserver([
    { ...observation, visibleText: "Member Search Searching...", ariaSnapshot: '- button "Searching..." [disabled]' },
    observation,
  ]);

  const run = await createAgent(model, actions, 5, undefined, observer).run("Find the member");

  expect(run.status).toBe("success");
  expect(actions.calls.filter(({ action }) => action === "wait")).toHaveLength(1);
  expect(model.calls).toBe(1);
});

test("stops early when the same settled state repeats without progress", async () => {
  const actions = new StubActions();
  const model = new SequenceModel([{ action: "wait", decisionSummary: "The unchanged observable state warrants one bounded wait." }]);
  const observer = new SequenceObserver([observation]);

  const run = await createAgent(model, actions, 10, undefined, observer, 2).run("Read the balance");

  expect(run).toMatchObject({ status: "stopped", stopReason: "repeated_state" });
  expect(model.calls).toBe(2);
  expect(actions.calls.filter(({ action }) => action === "wait")).toHaveLength(2);
});

test("read returns the first extraction capture group", async () => {
  const actions = new StubActions();
  actions.readText = async (target: LocatorSpec): Promise<ActionResult<string>> => {
    actions.calls.push({ action: "read", target });
    return { success: true, action: "readText", data: "Savings ****4521 $4,281.50 Open View" };
  };
  const model = new SequenceModel([
    {
      action: "read",
      target: { role: "row", name: "Savings" },
      outputName: "currentSavingsBalance",
      extractionPattern: "Savings.*?(\\$[0-9,]+\\.[0-9]{2})",
      decisionSummary: "The visible Savings row contains the requested balance.",
    },
    { action: "finish", decisionSummary: "The requested balance has been verified.", result: { currentSavingsBalance: "$4,281.50" } },
  ]);

  const run = await createAgent(model, actions).run("Read the balance");

  expect(run).toMatchObject({ status: "success", outputs: { currentSavingsBalance: "$4,281.50" } });
});

test("read_many returns one structured record for every matching row", async () => {
  const actions = new StubActions();
  actions.readTexts = async (target: LocatorSpec): Promise<ActionResult<string[]>> => {
    actions.calls.push({ action: "read_many", target });
    return {
      success: true,
      action: "readTexts",
      data: [
        "Savings ****5005 $0.00 Open View",
        "Savings ****5006 $1,000.00 Open View",
      ],
    };
  };
  const records = [
    { accountNumber: "****5005", availableBalance: "$0.00", status: "Open" },
    { accountNumber: "****5006", availableBalance: "$1,000.00", status: "Open" },
  ];
  const model = new SequenceModel([
    {
      action: "read_many",
      target: { role: "row", name: "Savings" },
      outputName: "savingsAccounts",
      outputFields: ["accountNumber", "availableBalance", "status"],
      extractionPattern: "Savings\\s+(\\*{4}\\d{4})\\s+(\\$-?[\\d,]+\\.\\d{2})\\s+(\\S+)",
      decisionSummary: "Every visible Savings row is required by the goal.",
    },
    {
      action: "finish",
      decisionSummary: "All Savings account records have been extracted and verified.",
      result: { savingsAccounts: records },
    },
  ]);

  const run = await createAgent(model, actions).run("Return every Savings account");

  expect(run).toMatchObject({ status: "success", outputs: { savingsAccounts: records } });
  expect(actions.calls).toContainEqual({
    action: "read_many",
    target: { strategy: "role", role: "row", name: "Savings" },
  });
});

test("treats a successful extraction as progress when the UI stays unchanged", async () => {
  const actions = new StubActions();
  const model = new SequenceModel([
    {
      action: "read",
      target: { role: "row", name: "Savings" },
      outputName: "currentSavingsBalance",
      decisionSummary: "The visible Savings row contains the requested balance.",
    },
    {
      action: "finish",
      decisionSummary: "The requested balance has been verified.",
      result: { currentSavingsBalance: "$4,281.50" },
    },
  ]);

  const run = await createAgent(
    model,
    actions,
    5,
    undefined,
    new SequenceObserver([observation]),
    1,
  ).run("Read the balance");

  expect(run).toMatchObject({ status: "success", outputs: { currentSavingsBalance: "$4,281.50" } });
  expect(model.calls).toBe(2);
});

test("refreshes a stale route-transition snapshot before asking the model", async () => {
  const actions = new StubActions();
  const dashboard: SurfaceObservation = {
    ...observation,
    url: `${bankUrl}/dashboard`,
    visibleText: "Operations Dashboard Member Lookup",
    ariaSnapshot: '- heading "Operations Dashboard"\n- link "Members"\n- link "Member Lookup"',
  };
  const staleMembers = { ...dashboard, url: `${bankUrl}/members` };
  const memberSearch: SurfaceObservation = {
    ...observation,
    visibleText: "Member Search Member Number Search",
    ariaSnapshot: '- heading "Member Search"\n- textbox "Member Number"\n- button "Search"',
  };
  const model = new SequenceModel([
    {
      action: "click",
      target: { role: "link", name: "Members" },
      decisionSummary: "The Members link opens the observable member lookup workflow.",
    },
    {
      action: "finish",
      decisionSummary: "The member search UI is now observable.",
      result: {},
    },
  ]);

  const run = await createAgent(
    model,
    actions,
    5,
    undefined,
    new SequenceObserver([dashboard, staleMembers, memberSearch]),
  ).run("Open member search");

  expect(run.status).toBe("success");
  expect(run.steps).toHaveLength(2);
  expect(actions.calls.filter(({ action }) => action === "wait")).toHaveLength(1);
  expect(model.contexts[1]?.observation.ariaSnapshot).toContain('heading "Member Search"');
});

test("stops after the configured maximum number of steps", async () => {
  const actions = new StubActions();
  const model = new SequenceModel([{ action: "wait", decisionSummary: "The observable page requires a short bounded wait." }]);

  const run = await createAgent(model, actions, 3).run("Read the balance");

  expect(run.status).toBe("stopped");
  expect(run.stopReason).toBe("max_steps");
  expect(run.steps).toHaveLength(3);
  expect(actions.calls.filter(({ action }) => action === "wait")).toHaveLength(3);
});

test("resumes discovery with a fresh observation after human escalation", async () => {
  const actions = new StubActions();
  const model = new SequenceModel([
    { action: "wait", decisionSummary: "The observable UI is not yet ready for the next action." },
    { action: "finish", decisionSummary: "The observable obstruction has been resolved.", result: {} },
  ]);
  const requests: InterventionDetails[] = [];
  const observer = new StubObserver();
  const interventionManager: InterventionHandler = {
    async requestIntervention(details) {
      requests.push(details);
      return {
        request: {
          interventionId: "int-discovery",
          ...details,
          currentUrl: observation.url,
          observation: observation.ariaSnapshot,
          screenshotPath: "before.png",
          createdAt: observation.timestamp,
        },
        resolution: { action: "RETRY_STEP" },
        humanActions: [],
        evidence: { json: "evidence.json", beforeScreenshot: "before.png", afterScreenshot: "after.png" },
      };
    },
  };

  const run = await createAgent(model, actions, 1, interventionManager, observer).run("Find the member");

  expect(run).toMatchObject({ status: "success", interventions: 1 });
  expect(run.steps).toHaveLength(2);
  expect(requests).toEqual([expect.objectContaining({ source: "discovery", reason: "AGENT_STUCK" })]);
  expect(observer.calls).toBe(2);
  expect(model.contexts[1]?.observation.visibleText).toContain("observation-2");
});

test("returns a structured failure when the model throws", async () => {
  const actions = new StubActions();
  const model: AgentModel = {
    async decideNextAction(): Promise<AgentDecision> {
      throw new Error("API unavailable");
    },
  };

  const run = await createAgent(model, actions).run("Read the balance");

  expect(run.status).toBe("failure");
  expect(run.stopReason).toBe("llm_error: API unavailable");
  expect(run.steps).toHaveLength(1);
});

test("maps a model request timeout to a bounded discovery timeout", async () => {
  const actions = new StubActions();
  const model: AgentModel = {
    async decideNextAction(): Promise<AgentDecision> {
      throw Object.assign(new Error("OpenAI request timed out."), { code: "timeout" });
    },
  };

  const run = await createAgent(model, actions).run("Read the balance");

  expect(run).toMatchObject({ status: "stopped", stopReason: "timeout" });
});

test("keeps bounded, redacted decision summaries in discovery evidence", () => {
  const sensitiveValue = "plain-text-password";
  const run: DiscoveryRun = {
    runId: "run-1",
    goal: "Sign in and inspect the member",
    startedAt: "2026-09-15T12:00:00.000Z",
    status: "success",
    steps: [{
      step: 1,
      url: `${bankUrl}/login`,
      observation,
      decision: {
        action: "type",
        target: { role: "textbox", name: "Password" },
        value: sensitiveValue,
        decisionSummary: `The visible sign-in form requires password: ${sensitiveValue} before continuing ${"x".repeat(250)}.`,
      },
      result: { success: true, action: "type" },
    }],
  };

  const redacted = redactDiscoveryRun(run);
  expect(redacted.steps[0]?.decision?.value).toBe("[REDACTED]");
  expect(redacted.steps[0]?.decision?.decisionSummary).toContain("password: [REDACTED]");
  expect(redacted.steps[0]?.decision?.decisionSummary).not.toContain(sensitiveValue);
  expect(redacted.steps[0]?.decision?.decisionSummary.length).toBeLessThanOrEqual(200);
});

test("rejects model decision summaries longer than 200 characters", () => {
  const parsed = AgentDecisionSchema.safeParse({
    action: "finish",
    target: null,
    value: null,
    inputName: null,
    outputName: null,
    outputFields: [],
    extractionPattern: null,
    decisionSummary: "x".repeat(201),
    businessOutcome: null,
    result: [],
  });

  expect(parsed.success).toBe(false);
});

test("generates a strict Structured Outputs schema without unsupported composition", () => {
  const format = zodTextFormat(AgentDecisionSchema, "agent_decision");
  const schema = format.schema as {
    properties?: { decisionSummary?: Record<string, unknown> };
  };
  const decisionSummary = schema.properties?.decisionSummary;

  expect(decisionSummary).toMatchObject({
    type: "string",
    maxLength: 200,
    pattern: "^[^\\r\\n]*\\S[^\\r\\n]*$",
  });
  expect(decisionSummary).not.toHaveProperty("allOf");
});

test("parses a structured model-proposed business outcome", () => {
  expect(parseAgentDecision({
    action: "business_outcome",
    target: null,
    value: null,
    inputName: null,
    outputName: null,
    outputFields: [],
    extractionPattern: null,
    decisionSummary: "The completed account list does not contain the requested account ending.",
    businessOutcome: {
      code: "REQUESTED_ACCOUNT_NOT_FOUND",
      details: [{ name: "accountEnding", value: "5007" }],
    },
    result: null,
  })).toMatchObject({
    action: "business_outcome",
    businessOutcome: {
      code: "REQUESTED_ACCOUNT_NOT_FOUND",
      details: { accountEnding: "5007" },
    },
  });
});

test("writes discovery evidence with full IDs and the existing evidence JSON shape", async () => {
  const evidenceRoot = await mkdtemp(join(tmpdir(), "discovery-evidence-test-"));
  const runId = "12345678-90ab-cdef-1234-567890abcdef";
  const startedAt = new Date("2026-09-16T02:04:05.987Z");
  const evidencePaths = createDiscoveryEvidencePaths(startedAt, runId, evidenceRoot);
  const model = new SequenceModel([{
    action: "finish",
    decisionSummary: "The requested evidence state is observable and complete.",
    result: {},
  }]);

  try {
    const run = await new DiscoveryAgent(
      model,
      new StubObserver(),
      new StubActions(),
      new ActionPolicy(bankUrl),
      { maxSteps: 1, runTimeoutMs: 5_000, runId, startedAt, evidencePaths },
    ).run("Confirm the evidence layout");

    const expectedEvidence = {
      json: evidencePaths.json,
      screenshot: evidencePaths.screenshot,
      trace: evidencePaths.trace,
    };
    expect(run).toMatchObject({ runId, startedAt: startedAt.toISOString(), evidence: expectedEvidence });
    expect(run.evidence).not.toHaveProperty("directory");

    const persisted = JSON.parse(await readFile(evidencePaths.json, "utf8"));
    expect(persisted).toMatchObject({ runId, startedAt: startedAt.toISOString(), evidence: expectedEvidence });
    expect(persisted.steps[0].decision.decisionSummary).toBe(
      "The requested evidence state is observable and complete.",
    );
    expect(persisted.evidence).not.toHaveProperty("directory");
  } finally {
    await rm(evidenceRoot, { recursive: true, force: true });
  }
});
