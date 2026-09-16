import { randomUUID } from "node:crypto";
import { DiscoveryAgent } from "../src/agent/DiscoveryAgent.js";
import type { AgentStep } from "../src/agent/types.js";
import { BrowserActions } from "../src/browser/BrowserActions.js";
import { BrowserSession } from "../src/browser/BrowserSession.js";
import { LocatorResolver } from "../src/browser/LocatorResolver.js";
import { SurfaceObserver } from "../src/browser/SurfaceObserver.js";
import type { ActionResult } from "../src/browser/types.js";
import { readDiscoveryConfig } from "../src/config.js";
import { InterventionManager } from "../src/escalation/InterventionManager.js";
import { OperatorConsole } from "../src/escalation/OperatorConsole.js";
import { SessionControl } from "../src/escalation/SessionControl.js";
import { createDiscoveryEvidencePaths } from "../src/evidence/paths.js";
import { OpenAIModel } from "../src/llm/OpenAIModel.js";
import { ActionPolicy } from "../src/policy/ActionPolicy.js";

function requireSuccess<T>(result: ActionResult<T>): T {
  if (!result.success) {
    throw new Error(`${result.action} failed: ${result.error?.type}: ${result.error?.message}`);
  }
  return result.data as T;
}

async function establishAuthenticatedSession(actions: BrowserActions, bankAppUrl: string): Promise<void> {
  requireSuccess(await actions.navigate(new URL("/login", bankAppUrl).toString()));
  requireSuccess(await actions.fill({ strategy: "label", label: "Employee ID" }, "discovery-session"));
  requireSuccess(await actions.fill({ strategy: "label", label: "Password" }, "discovery-session"));
  requireSuccess(await actions.click({ strategy: "role", role: "button", name: "Sign In" }));
  requireSuccess(await actions.click({ strategy: "role", role: "link", name: "Members" }));
  requireSuccess(await actions.waitFor({ strategy: "role", role: "heading", name: "Member Search" }));
}

function targetLabel(step: AgentStep): string {
  const target = step.decision?.target;
  return target?.name ?? target?.text ?? target?.role ?? "none";
}

function printStep(step: AgentStep): void {
  console.log(`\nStep ${step.step}`);
  console.log(`Action: ${step.decision?.action ?? "none"}`);
  console.log(`Target: ${targetLabel(step)}`);
  console.log(`Result: ${step.result?.success ? "success" : step.result?.error?.type ?? "not executed"}`);
  if (step.decision?.action === "read" && step.result?.value !== undefined) {
    console.log(`Value: ${step.result.value}`);
  }
}

async function main(): Promise<void> {
  const argumentsAfterCommand = process.argv.slice(2);
  const headed = argumentsAfterCommand.includes("--headed");
  const goal = argumentsAfterCommand.filter((argument) => argument !== "--headed").join(" ").trim();
  if (!goal) throw new Error("Usage: npm run discover -- [--headed] \"<goal>\"");

  const config = readDiscoveryConfig();
  const runId = randomUUID();
  const startedAt = new Date();
  const evidencePaths = createDiscoveryEvidencePaths(startedAt, runId);
  const sessionControl = new SessionControl();
  const session = new BrowserSession(headed ? false : config.headless);
  const resolver = new LocatorResolver();
  const policy = new ActionPolicy(config.allowedOrigins, config.allowedRoutes);
  const actions = new BrowserActions(session, resolver, policy, sessionControl);
  const observer = new SurfaceObserver(session, policy, sessionControl);
  const operatorConsole = new OperatorConsole({ session, actions, observer, resolver, sessionControl });
  const interventionManager = new InterventionManager(observer, sessionControl, operatorConsole, {
    runEvidenceDirectory: evidencePaths.directory,
  });
  let tracing = false;

  console.log("Discovery started");
  console.log(`\nGoal:\n${goal}`);

  try {
    await session.start();
    await establishAuthenticatedSession(actions, config.bankAppUrl);
    await session.startTrace();
    tracing = true;

    const agent = new DiscoveryAgent(
      new OpenAIModel({
        apiKey: config.openaiApiKey,
        model: config.openaiModel,
        requestTimeoutMs: config.agentTimeoutMs,
      }),
      observer,
      actions,
      policy,
      {
        maxSteps: config.agentMaxSteps,
        timeoutMs: config.agentTimeoutMs,
        runId,
        startedAt,
        evidencePaths,
        onStep: printStep,
        interventionManager,
      },
    );

    const run = await agent.run(goal);
    await session.stopTrace(evidencePaths.trace);
    tracing = false;

    console.log(`\nDiscovery ${run.status}.`);
    console.log(JSON.stringify({
      runId: run.runId,
      status: run.status,
      outputs: run.outputs ?? {},
      stopReason: run.stopReason ?? null,
      evidence: run.evidence ?? null,
    }, null, 2));
    if (run.status !== "success") process.exitCode = 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  } finally {
    if (tracing) {
      try {
        await session.stopTrace(evidencePaths.trace);
      } catch (error) {
        console.error("Could not save discovery trace:", error instanceof Error ? error.message : error);
      }
    }
    await session.close();
  }
}

await main();
