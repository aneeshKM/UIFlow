import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { ArtifactValidator } from "../src/artifact/ArtifactValidator.js";
import type { CapabilityArtifact } from "../src/artifact/types.js";
import { BrowserActions } from "../src/browser/BrowserActions.js";
import { BrowserSession } from "../src/browser/BrowserSession.js";
import { LocatorResolver } from "../src/browser/LocatorResolver.js";
import { SurfaceObserver } from "../src/browser/SurfaceObserver.js";
import type { ActionResult } from "../src/browser/types.js";
import { readConfig } from "../src/config.js";
import { ActionPolicy } from "../src/policy/ActionPolicy.js";
import { CheckpointEvaluator } from "../src/replay/CheckpointEvaluator.js";
import { InputResolver } from "../src/replay/InputResolver.js";
import { OutcomeDetector } from "../src/replay/OutcomeDetector.js";
import { ReplayEngine } from "../src/replay/ReplayEngine.js";
import { StepExecutor } from "../src/replay/StepExecutor.js";
import type { ReplayResult } from "../src/replay/types.js";

type DemoScenario =
  | "NORMAL"
  | "SLOW_RESPONSE"
  | "PERMISSION_DENIED"
  | "SESSION_EXPIRED"
  | "APP_ERROR"
  | "SUPERVISOR_APPROVAL";

const config = readConfig();
const artifactPath = join(process.cwd(), "artifacts", "get-member-savings-accounts.v1.json");
let artifact: CapabilityArtifact;

function requireSuccess(result: ActionResult): void {
  if (!result.success) {
    throw new Error(`${result.action} failed: ${result.error?.type}: ${result.error?.message}`);
  }
}

async function setScenario(scenario: DemoScenario): Promise<void> {
  const response = await fetch(new URL("/api/admin/scenario", config.bankApiUrl), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ scenario }),
  });
  if (!response.ok) throw new Error(`Could not set demo scenario ${scenario}: HTTP ${response.status}`);
}

async function replay(memberId: string): Promise<ReplayResult> {
  const session = new BrowserSession(true);
  const resolver = new LocatorResolver();
  const policy = new ActionPolicy(config.allowedOrigins, config.allowedRoutes);
  const actions = new BrowserActions(session, resolver, policy);
  const observer = new SurfaceObserver(session, policy);
  const inputResolver = new InputResolver();
  const engine = new ReplayEngine({
    stepExecutor: new StepExecutor(actions, observer, inputResolver, artifact.inputs, policy),
    checkpointEvaluator: new CheckpointEvaluator(actions, observer),
    outcomeDetector: new OutcomeDetector(observer, actions),
    inputResolver,
    actionPolicy: policy,
  }, {
    prepare: async (validatedArtifact) => {
      await session.start();
      requireSuccess(await actions.navigate(new URL("/login", validatedArtifact.target.baseUrl).toString()));
      requireSuccess(await actions.fill({ strategy: "label", label: "Employee ID" }, "replay-live-test"));
      requireSuccess(await actions.fill({ strategy: "label", label: "Password" }, "replay-live-test"));
      requireSuccess(await actions.click({ strategy: "role", role: "button", name: "Sign In" }));
      requireSuccess(await actions.waitFor({ strategy: "role", role: "heading", name: "Operations Dashboard" }));
    },
  });

  try {
    return await engine.run(artifact, { memberId });
  } finally {
    await session.close();
  }
}

test.describe("live deterministic replay matrix", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeAll(async () => {
    for (const url of [config.bankAppUrl, new URL("/api/health", config.bankApiUrl).toString()]) {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Bank App service is unavailable at ${url}: HTTP ${response.status}`);
    }
    artifact = new ArtifactValidator().validate(JSON.parse(await readFile(artifactPath, "utf8")));
  });

  test.beforeEach(async () => {
    await setScenario("NORMAL");
  });

  test.afterEach(async () => {
    await setScenario("NORMAL");
  });

  test("reuses the discovered capability across normal member outcomes", async () => {
    await expect(replay("12345")).resolves.toMatchObject({
      status: "success",
      outputs: {
        savingsAccounts: [{ maskedAccountNumber: "****4521", availableBalance: "$4,281.50", status: "Open" }],
      },
      completedSteps: 9,
    });
    await expect(replay("23456")).resolves.toMatchObject({
      status: "success",
      outputs: {
        savingsAccounts: [{ maskedAccountNumber: "****7721", availableBalance: "$8,370.25", status: "Open" }],
      },
      completedSteps: 9,
    });
    await expect(replay("99999")).resolves.toMatchObject({
      status: "business_outcome",
      code: "MEMBER_NOT_FOUND",
    });
    await expect(replay("23458")).resolves.toMatchObject({
      status: "business_outcome",
      code: "NO_ACCOUNTS_FOUND",
    });
  });

  test("waits through the configured slow response", async () => {
    await setScenario("SLOW_RESPONSE");

    await expect(replay("12345")).resolves.toMatchObject({
      status: "success",
      outputs: {
        savingsAccounts: [{ maskedAccountNumber: "****4521", availableBalance: "$4,281.50", status: "Open" }],
      },
    });
  });

  test("returns typed failures for configured operational conditions", async () => {
    await setScenario("PERMISSION_DENIED");
    await expect(replay("12345")).resolves.toMatchObject({ status: "failure", code: "UNEXPECTED_STATE" });

    await setScenario("SESSION_EXPIRED");
    await expect(replay("12345")).resolves.toMatchObject({ status: "failure", code: "SESSION_EXPIRED" });

    await setScenario("APP_ERROR");
    await expect(replay("12345")).resolves.toMatchObject({ status: "failure", code: "UNEXPECTED_STATE" });
  });

  test("keeps the reserved supervisor scenario on its documented normal behavior", async () => {
    await setScenario("SUPERVISOR_APPROVAL");

    await expect(replay("12345")).resolves.toMatchObject({
      status: "success",
      outputs: {
        savingsAccounts: [{ maskedAccountNumber: "****4521", availableBalance: "$4,281.50", status: "Open" }],
      },
    });
  });

  test("returns every Savings account when multiple rows match", async () => {
    await expect(replay("23457")).resolves.toMatchObject({
      status: "success",
      outputs: {
        savingsAccounts: [
          { maskedAccountNumber: "****5005", availableBalance: "$0.00", status: "Open" },
          { maskedAccountNumber: "****5006", availableBalance: "$1,000.00", status: "Open" },
        ],
      },
      completedSteps: 9,
    });
  });
});
