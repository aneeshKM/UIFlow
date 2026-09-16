import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { expect, test } from "@playwright/test";
import type { CapabilityArtifact, CapabilityStep } from "../src/artifact/types.js";
import { BrowserActions } from "../src/browser/BrowserActions.js";
import type { BrowserSession } from "../src/browser/BrowserSession.js";
import type { LocatorResolver } from "../src/browser/LocatorResolver.js";
import type { SurfaceObserver } from "../src/browser/SurfaceObserver.js";
import type { ActionResult, LocatorSpec, SurfaceObservation } from "../src/browser/types.js";
import { InterventionManager } from "../src/escalation/InterventionManager.js";
import { OperatorConsole, type OperatorConsoleIO } from "../src/escalation/OperatorConsole.js";
import { SessionControl } from "../src/escalation/SessionControl.js";
import type {
  InterventionDetails,
  InterventionHandler,
  InterventionOutcome,
  InterventionResolution,
} from "../src/escalation/types.js";
import { ReplayEngine } from "../src/replay/ReplayEngine.js";
import { ActionPolicy } from "../src/policy/ActionPolicy.js";
import type {
  ReplayCheckpointEvaluator,
  ReplayOutcomeDetector,
  ReplayStepExecutor,
} from "../src/replay/types.js";

const observation: SurfaceObservation = {
  url: "http://localhost:5174/members",
  title: "bank-app",
  visibleText: "Member Search Search",
  ariaSnapshot: '- heading "Member Search"\n- textbox "Member ID": "12345"\n- button "Search"',
  timestamp: "2026-09-15T12:00:00.000Z",
};

class ScriptedIO implements OperatorConsoleIO {
  readonly output: string[] = [];

  constructor(private readonly answers: string[]) {}

  async question(_prompt: string): Promise<string> {
    const answer = this.answers.shift();
    if (answer === undefined) throw new Error("Operator input was exhausted.");
    return answer;
  }

  write(message: string): void {
    this.output.push(message);
  }

  close(): void {}
}

function replayArtifact(): CapabilityArtifact {
  const step = (id: string): CapabilityStep => ({
    id,
    action: "click",
    target: { role: "button", name: id },
    timeoutMs: 10,
    expected: { kind: "action_succeeds" },
  });
  return {
    schemaVersion: "1.0.0",
    capability: { id: "test-capability", name: "Test", description: "Test handoff", version: 1 },
    target: { app: "bank-app", baseUrl: "http://localhost:5174" },
    inputs: [],
    outputs: [{ name: "result", type: "string" }],
    steps: [
      step("first"),
      step("failed"),
      {
        id: "last",
        action: "extract",
        target: { role: "row", name: "Result" },
        output: "result",
        timeoutMs: 10,
        expected: { kind: "output_present", output: "result" },
      },
    ],
    checkpoint: { type: "all", conditions: [{ kind: "output_present", output: "result" }] },
    policy: { allowedActions: ["click", "extract"], riskLevel: "safe" },
    metadata: { createdAt: "2026-09-15T12:00:00.000Z", sourceRunId: "source" },
  };
}

function interventionOutcome(
  details: InterventionDetails,
  resolution: InterventionResolution,
): InterventionOutcome {
  const request = {
    interventionId: "int-test",
    ...details,
    currentUrl: observation.url,
    observation: observation.ariaSnapshot,
    screenshotPath: "before.png",
    createdAt: observation.timestamp,
  };
  return {
    request,
    resolution,
    humanActions: [],
    evidence: { json: "evidence.json", beforeScreenshot: "before.png", afterScreenshot: "after.png" },
  };
}

class StubInterventionHandler implements InterventionHandler {
  readonly requests: InterventionDetails[] = [];

  constructor(private readonly resolution: InterventionResolution) {}

  async requestIntervention(details: InterventionDetails): Promise<InterventionOutcome> {
    this.requests.push(details);
    return interventionOutcome(details, this.resolution);
  }
}

function replayEngine(
  executor: ReplayStepExecutor,
  interventionManager: InterventionHandler,
): ReplayEngine {
  const checkpointEvaluator: ReplayCheckpointEvaluator = {
    async evaluate() { return { success: true }; },
    async evaluateCondition() { return { success: true }; },
  };
  const outcomeDetector: ReplayOutcomeDetector = {
    async detect() { return { status: "normal" }; },
  };
  return new ReplayEngine(
    {
      stepExecutor: executor,
      checkpointEvaluator,
      outcomeDetector,
      interventionManager,
      actionPolicy: new ActionPolicy("http://localhost:5174"),
    },
    { runId: "replay-escalation", now: () => 100 },
  );
}

test("SessionControl transfers exclusive ownership and restores automation", () => {
  const control = new SessionControl();
  expect(control.getOwner()).toBe("AUTOMATION");
  control.giveToHuman();
  expect(control.getOwner()).toBe("HUMAN");
  expect(() => control.assertAutomationControl()).toThrow(/control belongs to HUMAN/);
  control.giveToAutomation();
  expect(control.getOwner()).toBe("AUTOMATION");
});

test("BrowserActions blocks automation while the human owns the session", async () => {
  let pageAccessed = false;
  const session = {
    getPage() {
      pageAccessed = true;
      throw new Error("Browser access should have been blocked.");
    },
  } as unknown as BrowserSession;
  const resolver = {} as LocatorResolver;
  const control = new SessionControl();
  const actions = new BrowserActions(session, resolver, new ActionPolicy("http://localhost:5174"), control);
  control.giveToHuman();

  const result = await actions.click({ strategy: "role", role: "button", name: "Search" });

  expect(result).toMatchObject({ success: false, error: { type: "CONTROL_VIOLATION" } });
  expect(pageAccessed).toBe(false);
});

test("BrowserActions blocks a human command while automation owns the session", async () => {
  let pageAccessed = false;
  const session = {
    getPage() {
      pageAccessed = true;
      throw new Error("Browser access should have been blocked.");
    },
  } as unknown as BrowserSession;
  const actions = new BrowserActions(
    session,
    {} as LocatorResolver,
    new ActionPolicy("http://localhost:5174"),
    new SessionControl(),
  );

  const result = await actions.click(
    { strategy: "role", role: "button", name: "Search" },
    undefined,
    "HUMAN",
  );

  expect(result).toMatchObject({ success: false, error: { type: "CONTROL_VIOLATION" } });
  expect(pageAccessed).toBe(false);
});

test("OperatorConsole uses the exact live session and records redacted human actions in evidence", async () => {
  const evidenceDirectory = await mkdtemp(join(tmpdir(), "escalation-test-"));
  const control = new SessionControl();
  const session = {} as BrowserSession;
  const resolver = {} as LocatorResolver;
  const actionCalls: Array<{ action: string; owner?: string; value?: string }> = [];
  const actions = {
    async click(_target: LocatorSpec, _timeout?: number, owner?: string): Promise<ActionResult> {
      actionCalls.push({ action: "click", owner });
      return { success: true, action: "click" };
    },
    async fill(_target: LocatorSpec, value: string, _timeout?: number, owner?: string): Promise<ActionResult> {
      actionCalls.push({ action: "fill", owner, value });
      return { success: true, action: "fill" };
    },
    async readText(): Promise<ActionResult<string>> {
      return { success: true, action: "readText", data: "$4,281.50" };
    },
  } as unknown as BrowserActions;
  const observerCalls: string[] = [];
  const observer = {
    async observe(owner = "AUTOMATION") {
      control.assertOwner(owner as "AUTOMATION" | "HUMAN");
      observerCalls.push(`observe:${owner}`);
      return observation;
    },
    async captureScreenshot(owner = "AUTOMATION") {
      control.assertOwner(owner as "AUTOMATION" | "HUMAN");
      observerCalls.push(`screenshot:${owner}`);
      return Buffer.from(`png:${owner}`);
    },
  } as SurfaceObserver;
  const io = new ScriptedIO([
    "observe",
    "click", "button", "Search",
    "type", "textbox", "Member ID", "12345",
    "complete", "Search submitted manually",
  ]);
  const operator = new OperatorConsole({ session, actions, observer, resolver, sessionControl: control, io });
  const manager = new InterventionManager(observer, control, operator, {
    runEvidenceDirectory: evidenceDirectory,
    idFactory: () => "int-evidence",
    now: () => new Date("2026-09-15T12:00:00.000Z"),
  });

  try {
    expect(operator.session).toBe(session);
    const outcome = await manager.requestIntervention({
      runId: "replay-1",
      source: "replay",
      capabilityId: "get-member-savings-balance",
      stepId: "click-search",
      reason: "LOCATOR_NOT_FOUND",
      message: "Search locator was not found.",
    });

    expect(control.getOwner()).toBe("AUTOMATION");
    expect(outcome.resolution.action).toBe("STEP_COMPLETED");
    expect(outcome.humanActions.map(({ action }) => action)).toEqual(["observe", "click", "type"]);
    expect(outcome.humanActions[2]).toMatchObject({ value: "[REDACTED]", result: "success" });
    expect(actionCalls).toEqual([
      { action: "click", owner: "HUMAN" },
      { action: "fill", owner: "HUMAN", value: "12345" },
    ]);
    expect(observerCalls).toEqual([
      "observe:AUTOMATION",
      "screenshot:AUTOMATION",
      "observe:HUMAN",
      "screenshot:HUMAN",
    ]);
    const interventionDirectory = join(evidenceDirectory, "interventions", "int-evid");
    expect(outcome.evidence).toEqual({
      json: join(interventionDirectory, "intervention.json"),
      beforeScreenshot: join(interventionDirectory, "before.png"),
      afterScreenshot: join(interventionDirectory, "after.png"),
    });
    const evidence = await readFile(outcome.evidence.json, "utf8");
    expect(evidence).toContain('"action": "click"');
    expect(evidence).toContain('"value": "[REDACTED]"');
    expect(evidence).not.toContain("12345");
    expect(evidence).toContain('"transferredAt"');
    expect(evidence).toContain('"resolvedAt"');
  } finally {
    await rm(evidenceDirectory, { recursive: true, force: true });
  }
});

test("human abort stays structured when the after screenshot cannot be captured", async () => {
  const evidenceDirectory = await mkdtemp(join(tmpdir(), "escalation-test-"));
  const control = new SessionControl();
  const session = {} as BrowserSession;
  const observer = {
    async observe() { return observation; },
    async captureScreenshot(owner = "AUTOMATION") {
      if (owner === "HUMAN") throw new Error("Browser page has closed.");
      return Buffer.from("before");
    },
  } as SurfaceObserver;
  const operator = new OperatorConsole({
    session,
    actions: {} as BrowserActions,
    observer,
    resolver: {} as LocatorResolver,
    sessionControl: control,
    io: new ScriptedIO(["abort", "Operator chose to stop"]),
  });
  const manager = new InterventionManager(observer, control, operator, {
    runEvidenceDirectory: evidenceDirectory,
    idFactory: () => "int-abort",
  });

  try {
    const outcome = await manager.requestIntervention({
      runId: "replay-abort",
      source: "replay",
      stepId: "click-search",
      reason: "LOCATOR_NOT_FOUND",
      message: "Locator failed.",
    });

    expect(outcome.resolution.action).toBe("ABORT");
    expect(outcome.evidence.afterScreenshot).toBeUndefined();
    expect(control.getOwner()).toBe("AUTOMATION");
    const evidence = JSON.parse(await readFile(outcome.evidence.json, "utf8"));
    expect(evidence.resolution).toBe("ABORT");
    expect(evidence.afterScreenshotError).toBe("Browser page has closed.");
    expect(evidence.evidence.afterScreenshot).toBeUndefined();
  } finally {
    await rm(evidenceDirectory, { recursive: true, force: true });
  }
});

test("operator handoff expires with a structured abort", async () => {
  const control = new SessionControl();
  control.giveToHuman();
  const operator = new OperatorConsole({
    session: {} as BrowserSession,
    actions: {} as BrowserActions,
    observer: {} as SurfaceObserver,
    resolver: {} as LocatorResolver,
    sessionControl: control,
    maxDurationMs: 5,
    io: {
      async question() { return new Promise<string>(() => {}); },
      write() {},
      close() {},
    },
  });

  await expect(operator.run({
    interventionId: "int-timeout",
    runId: "replay-timeout",
    source: "replay",
    reason: "LOCATOR_NOT_FOUND",
    message: "Locator failed.",
    currentUrl: observation.url,
    observation: observation.ariaSnapshot,
    screenshotPath: "before.png",
    createdAt: observation.timestamp,
  })).resolves.toMatchObject({
    resolution: { action: "ABORT", note: "Operator intervention timed out." },
  });
});

test("RETRY_STEP executes the same failed replay step again", async () => {
  const calls: string[] = [];
  let failedAttempts = 0;
  const executor: ReplayStepExecutor = {
    async execute(step) {
      calls.push(step.id);
      if (step.id === "failed" && failedAttempts++ === 0) {
        return { status: "failure", code: "LOCATOR_NOT_FOUND", stepId: step.id, message: "missing" };
      }
      return { status: "success" };
    },
  };
  const handler = new StubInterventionHandler({ action: "RETRY_STEP" });

  const result = await replayEngine(executor, handler).run(replayArtifact(), {});

  expect(result).toMatchObject({ status: "success", interventions: 1 });
  expect(calls).toEqual(["first", "failed", "failed", "last"]);
});

test("STEP_COMPLETED advances replay to the next artifact step", async () => {
  const calls: string[] = [];
  const executor: ReplayStepExecutor = {
    async execute(step) {
      calls.push(step.id);
      return step.id === "failed"
        ? { status: "failure", code: "LOCATOR_NOT_FOUND", stepId: step.id, message: "missing" }
        : { status: "success" };
    },
  };

  const result = await replayEngine(
    executor,
    new StubInterventionHandler({ action: "STEP_COMPLETED" }),
  ).run(replayArtifact(), {});

  expect(result).toMatchObject({ status: "success", completedSteps: 3, interventions: 1 });
  expect(calls).toEqual(["first", "failed", "last"]);
});

test("ABORT stops replay with HUMAN_ABORTED", async () => {
  const executor: ReplayStepExecutor = {
    async execute(step) {
      return step.id === "failed"
        ? { status: "failure", code: "LOCATOR_NOT_FOUND", stepId: step.id, message: "missing" }
        : { status: "success" };
    },
  };

  const result = await replayEngine(
    executor,
    new StubInterventionHandler({ action: "ABORT", note: "Cannot safely continue" }),
  ).run(replayArtifact(), {});

  expect(result).toMatchObject({
    status: "failure",
    code: "HUMAN_ABORTED",
    stepId: "failed",
    interventions: 1,
    message: /Cannot safely continue/,
  });
});

test("replay bounds repeated human retries", async () => {
  let failedAttempts = 0;
  const executor: ReplayStepExecutor = {
    async execute(step) {
      if (step.id === "failed") {
        failedAttempts += 1;
        return { status: "failure", code: "LOCATOR_NOT_FOUND", stepId: step.id, message: "missing" };
      }
      return { status: "success" };
    },
  };
  const handler = new StubInterventionHandler({ action: "RETRY_STEP" });

  const result = await replayEngine(executor, handler).run(replayArtifact(), {});

  expect(result).toMatchObject({ status: "failure", code: "LOCATOR_NOT_FOUND", stepId: "failed" });
  expect(handler.requests).toHaveLength(3);
  expect(failedAttempts).toBe(4);
});

test("review-risk replay requires a human decision before executing steps", async () => {
  const artifact = replayArtifact();
  artifact.policy.riskLevel = "review";
  const calls: string[] = [];
  const executor: ReplayStepExecutor = {
    async execute(step) {
      calls.push(step.id);
      return { status: "success" };
    },
  };
  const handler = new StubInterventionHandler({ action: "STEP_COMPLETED", note: "Approved" });

  const result = await replayEngine(executor, handler).run(artifact, {});

  expect(result).toMatchObject({ status: "success", interventions: 1 });
  expect(handler.requests).toHaveLength(1);
  expect(handler.requests[0]).toMatchObject({ reason: "POLICY_BLOCKED" });
  expect(calls).toEqual(["first", "failed", "last"]);
});

test("blocked-risk replay cannot be approved and never executes", async () => {
  const artifact = replayArtifact();
  artifact.policy.riskLevel = "blocked";
  const calls: string[] = [];
  const executor: ReplayStepExecutor = {
    async execute(step) {
      calls.push(step.id);
      return { status: "success" };
    },
  };
  const handler = new StubInterventionHandler({ action: "STEP_COMPLETED" });

  const result = await replayEngine(executor, handler).run(artifact, {});

  expect(result).toMatchObject({ status: "failure", code: "POLICY_BLOCKED" });
  expect(handler.requests).toHaveLength(0);
  expect(calls).toHaveLength(0);
});
