import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { DiscoveryAgent, type DiscoveryBrowserActions, type DiscoverySurfaceObserver } from "../src/agent/DiscoveryAgent.js";
import { redactDiscoveryRun } from "../src/agent/DiscoveryAgent.js";
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
    { action: "click", target: { role: "button", name: "Search" }, reason: "Search for the member." },
    { action: "finish", reason: "The requested action is complete.", result: {} },
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
    { action: "navigate", value: "https://google.com", reason: "Leave the application." },
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
      reason: "Read the balance.",
    },
    { action: "finish", reason: "Verified.", result: { savingsBalance: "$4,281.50" } },
  ]);

  const run = await createAgent(model, actions).run("Read the balance");

  expect(run.status).toBe("success");
  expect(run.steps).toHaveLength(2);
  expect(run.outputs).toEqual({ savingsBalance: "$4,281.50" });
  expect(model.calls).toBe(2);
});

test("returns a business outcome before calling the model when the member has no accounts", async () => {
  const actions = new StubActions();
  const model = new SequenceModel([{ action: "finish", reason: "Should not be called.", result: {} }]);
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

test("waits once for a transient loading state without calling the model", async () => {
  const actions = new StubActions();
  const model = new SequenceModel([{ action: "finish", reason: "Settled.", result: {} }]);
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
  const model = new SequenceModel([{ action: "wait", reason: "Try waiting again." }]);
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
      reason: "Read the balance.",
    },
    { action: "finish", reason: "Verified.", result: { currentSavingsBalance: "$4,281.50" } },
  ]);

  const run = await createAgent(model, actions).run("Read the balance");

  expect(run).toMatchObject({ status: "success", outputs: { currentSavingsBalance: "$4,281.50" } });
});

test("stops after the configured maximum number of steps", async () => {
  const actions = new StubActions();
  const model = new SequenceModel([{ action: "wait", reason: "Wait for an update." }]);

  const run = await createAgent(model, actions, 3).run("Read the balance");

  expect(run.status).toBe("stopped");
  expect(run.stopReason).toBe("max_steps");
  expect(run.steps).toHaveLength(3);
  expect(actions.calls.filter(({ action }) => action === "wait")).toHaveLength(3);
});

test("resumes discovery with a fresh observation after human escalation", async () => {
  const actions = new StubActions();
  const model = new SequenceModel([
    { action: "wait", reason: "The surface is unclear." },
    { action: "finish", reason: "The operator resolved the obstruction.", result: {} },
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

test("redacts secrets before evidence is serialized", () => {
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
        value: "plain-text-password",
        reason: "Authenticate.",
      },
      result: { success: true, action: "type" },
    }],
  };

  const redacted = redactDiscoveryRun(run);
  expect(redacted.steps[0]?.decision?.value).toBe("[REDACTED]");
  expect(redacted.steps[0]?.decision).not.toHaveProperty("reason");
});

test("writes discovery evidence with full IDs and the existing evidence JSON shape", async () => {
  const evidenceRoot = await mkdtemp(join(tmpdir(), "discovery-evidence-test-"));
  const runId = "12345678-90ab-cdef-1234-567890abcdef";
  const startedAt = new Date("2026-09-16T02:04:05.987Z");
  const evidencePaths = createDiscoveryEvidencePaths(startedAt, runId, evidenceRoot);
  const model = new SequenceModel([{ action: "finish", reason: "Done.", result: {} }]);

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
    expect(persisted.evidence).not.toHaveProperty("directory");
  } finally {
    await rm(evidenceRoot, { recursive: true, force: true });
  }
});
