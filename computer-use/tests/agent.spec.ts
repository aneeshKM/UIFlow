import { expect, test } from "@playwright/test";
import { DiscoveryAgent, type DiscoveryBrowserActions, type DiscoverySurfaceObserver } from "../src/agent/DiscoveryAgent.js";
import { redactDiscoveryRun } from "../src/agent/DiscoveryAgent.js";
import type { AgentDecision, AgentDecisionContext, AgentModel, DiscoveryRun } from "../src/agent/types.js";
import type { ActionResult, LocatorSpec, SurfaceObservation } from "../src/browser/types.js";
import { ActionPolicy } from "../src/policy/ActionPolicy.js";

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

  constructor(private readonly decisions: AgentDecision[]) {}

  async decideNextAction(_context: AgentDecisionContext): Promise<AgentDecision> {
    const decision = this.decisions[Math.min(this.calls, this.decisions.length - 1)];
    this.calls += 1;
    if (decision === undefined) throw new Error("No model decision configured.");
    return decision;
  }
}

class StubObserver implements DiscoverySurfaceObserver {
  async observe(): Promise<SurfaceObservation> {
    return observation;
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
): DiscoveryAgent {
  return new DiscoveryAgent(
    model,
    new StubObserver(),
    actions,
    new ActionPolicy(bankUrl),
    { maxSteps, timeoutMs: 5_000 },
  );
}

test("executes a model click through the browser layer", async () => {
  const actions = new StubActions();
  const model = new SequenceModel([
    { action: "click", target: { role: "button", name: "Search" }, reason: "Search for the member." },
    { action: "finish", reason: "The requested result is visible.", result: { found: "true" } },
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
    { action: "finish", reason: "Verified.", result: { savingsBalance: "$4,281.50" } },
  ]);

  const run = await createAgent(model, actions).run("Read the balance");

  expect(run.status).toBe("success");
  expect(run.steps).toHaveLength(1);
  expect(run.outputs).toEqual({ savingsBalance: "$4,281.50" });
  expect(model.calls).toBe(1);
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

  expect(redactDiscoveryRun(run).steps[0]?.decision?.value).toBe("[REDACTED]");
});
