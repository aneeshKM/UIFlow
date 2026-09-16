import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { ArtifactValidator } from "../src/artifact/ArtifactValidator.js";
import type { CapabilityArtifact } from "../src/artifact/types.js";
import type { CapabilityStep } from "../src/artifact/types.js";
import { BrowserActions } from "../src/browser/BrowserActions.js";
import { BrowserSession } from "../src/browser/BrowserSession.js";
import { LocatorResolver } from "../src/browser/LocatorResolver.js";
import { SurfaceObserver } from "../src/browser/SurfaceObserver.js";
import type { ActionResult } from "../src/browser/types.js";
import { readConfig } from "../src/config.js";
import { InterventionManager } from "../src/escalation/InterventionManager.js";
import { OperatorConsole } from "../src/escalation/OperatorConsole.js";
import { SessionControl } from "../src/escalation/SessionControl.js";
import { evidenceWriter } from "../src/evidence/EvidenceWriter.js";
import { ActionPolicy } from "../src/policy/ActionPolicy.js";
import { CheckpointEvaluator } from "../src/replay/CheckpointEvaluator.js";
import { InputResolver } from "../src/replay/InputResolver.js";
import { OutcomeDetector } from "../src/replay/OutcomeDetector.js";
import { ReplayEngine } from "../src/replay/ReplayEngine.js";
import { StepExecutor } from "../src/replay/StepExecutor.js";
import type { ReplayResult, ReplayStepExecutor, RuntimeInputs, RuntimeOutputs } from "../src/replay/types.js";

interface ReplayArguments {
  artifactPath: string;
  inputs: RuntimeInputs;
  headed: boolean;
  demoFailureStepId?: string;
}

function parseArguments(argv: string[]): ReplayArguments {
  const [artifactPath, ...argumentsAfterPath] = argv;
  if (!artifactPath || artifactPath.startsWith("--")) {
    throw new Error("Usage: npm run replay -- <artifact.json> [--headed] [--demo-failure step-id] --key value");
  }

  const inputs: RuntimeInputs = {};
  let headed = false;
  let demoFailureStepId: string | undefined;
  for (let index = 0; index < argumentsAfterPath.length; index += 1) {
    const argument = argumentsAfterPath[index]!;
    if (argument === "--headed") {
      headed = true;
      continue;
    }
    if (!argument.startsWith("--") || argument === "--") {
      throw new Error(`Expected a --key runtime input, received "${argument}".`);
    }

    const equalsIndex = argument.indexOf("=");
    const name = argument.slice(2, equalsIndex === -1 ? undefined : equalsIndex);
    const value = equalsIndex === -1 ? argumentsAfterPath[++index] : argument.slice(equalsIndex + 1);
    if (!name || value === undefined || value.startsWith("--")) {
      throw new Error(`Runtime input "${argument}" requires a value.`);
    }
    if (name === "demo-failure") {
      if (demoFailureStepId !== undefined) throw new Error("--demo-failure was provided more than once.");
      demoFailureStepId = String(value);
      continue;
    }
    if (Object.prototype.hasOwnProperty.call(inputs, name)) {
      throw new Error(`Runtime input "${name}" was provided more than once.`);
    }
    inputs[name] = value;
  }
  return {
    artifactPath: resolve(artifactPath),
    inputs,
    headed,
    ...(demoFailureStepId === undefined ? {} : { demoFailureStepId }),
  };
}

function requireSuccess<T>(result: ActionResult<T>): T {
  if (!result.success) {
    throw new Error(`${result.action} failed: ${result.error?.type}: ${result.error?.message}`);
  }
  return result.data as T;
}

async function loadArtifact(path: string): Promise<CapabilityArtifact> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error(`Artifact is not valid JSON: ${path}`, { cause: error });
    throw error;
  }
  return new ArtifactValidator().validate(parsed);
}

function evidenceRecord(
  artifact: CapabilityArtifact,
  inputs: RuntimeInputs,
  runId: string,
  result: ReplayResult,
  completedSteps: number,
  outputs: RuntimeOutputs,
  durationMs: number,
  evidence: { json: string; screenshot: string; trace: string },
): Record<string, unknown> {
  return {
    runId,
    artifact: { id: artifact.capability.id, version: artifact.capability.version },
    inputNames: Object.keys(inputs).sort(),
    status: result.status,
    completedSteps,
    outputs,
    durationMs,
    interventions: "interventions" in result ? result.interventions ?? 0 : 0,
    evidence,
    ...(result.status === "business_outcome"
      ? { businessOutcome: { code: result.code, stepId: result.stepId, details: result.details } }
      : {}),
    ...(result.status === "failure"
      ? {
          failure: {
            code: result.code,
            stepId: result.stepId,
            expected: result.expected,
            observed: result.observed,
            message: result.message,
          },
        }
      : {}),
  };
}

async function main(): Promise<void> {
  const { artifactPath, inputs, headed, demoFailureStepId } = parseArguments(process.argv.slice(2));
  const artifact = await loadArtifact(artifactPath);
  if (demoFailureStepId !== undefined) {
    const demoStep = artifact.steps.find((step) => step.id === demoFailureStepId);
    if (demoStep === undefined) throw new Error(`Demo failure step "${demoFailureStepId}" does not exist.`);
    if (!("target" in demoStep)) throw new Error(`Demo failure step "${demoFailureStepId}" has no locator target.`);
  }
  const config = readConfig();
  const runId = randomUUID();
  const evidenceDirectory = join("evidence", "replay");
  const jsonPath = join(evidenceDirectory, `replay-${runId}.json`);
  const screenshotPath = join(evidenceDirectory, `replay-${runId}.png`);
  const tracePath = join(evidenceDirectory, `replay-${runId}-trace.zip`);
  const sessionControl = new SessionControl();
  const session = new BrowserSession(headed ? false : config.headless);
  const resolver = new LocatorResolver();
  const policy = new ActionPolicy(config.allowedOrigins, config.allowedRoutes);
  const actions = new BrowserActions(session, resolver, policy, sessionControl);
  const observer = new SurfaceObserver(session, policy, sessionControl);
  const operatorConsole = new OperatorConsole({ session, actions, observer, resolver, sessionControl });
  const interventionManager = new InterventionManager(observer, sessionControl, operatorConsole);
  const inputResolver = new InputResolver();
  let sessionStarted = false;
  let tracing = false;
  let completedSteps = 0;
  let outputs: RuntimeOutputs = {};
  const startedAt = performance.now();

  const browserStepExecutor = new StepExecutor(actions, observer, inputResolver, artifact.inputs, policy);
  let demoFailureInjected = false;
  const stepExecutor: ReplayStepExecutor = {
    async execute(step, runtimeInputs, runtimeOutputs, baseUrl) {
      if (demoFailureStepId === step.id && !demoFailureInjected && "target" in step) {
        demoFailureInjected = true;
        const forcedMissingStep = {
          ...step,
          target: { role: "button", name: `__demo_missing_${step.id}__` },
        } as CapabilityStep;
        return browserStepExecutor.execute(forcedMissingStep, runtimeInputs, runtimeOutputs, baseUrl);
      }
      return browserStepExecutor.execute(step, runtimeInputs, runtimeOutputs, baseUrl);
    },
  };

  const engine = new ReplayEngine(
    {
      stepExecutor,
      checkpointEvaluator: new CheckpointEvaluator(actions, observer),
      outcomeDetector: new OutcomeDetector(observer, actions),
      inputResolver,
      actionPolicy: policy,
      ...(headed ? { interventionManager } : {}),
    },
    {
      runId,
      prepare: async (validatedArtifact) => {
        await session.start();
        sessionStarted = true;
        requireSuccess(await actions.navigate(new URL("/login", validatedArtifact.target.baseUrl).toString()));
        requireSuccess(await actions.fill({ strategy: "label", label: "Employee ID" }, "replay-session"));
        requireSuccess(await actions.fill({ strategy: "label", label: "Password" }, "replay-session"));
        requireSuccess(await actions.click({ strategy: "role", role: "button", name: "Sign In" }));
        requireSuccess(await actions.waitFor({ strategy: "role", role: "heading", name: "Operations Dashboard" }));
        await session.startTrace();
        tracing = true;
      },
      onStepCompleted: (count, _stepId, currentOutputs) => {
        completedSteps = count;
        outputs = currentOutputs;
      },
    },
  );

  let result: ReplayResult;
  try {
    result = await engine.run(artifact, inputs);

    if (sessionStarted) {
      const screenshot = await actions.screenshot(screenshotPath);
      if (!screenshot.success) console.error(`Could not save replay screenshot: ${screenshot.error?.message}`);
    }
    if (tracing) {
      await session.stopTrace(tracePath);
      tracing = false;
    }

    if (result.status === "success") {
      completedSteps = result.completedSteps;
      outputs = result.outputs;
    }
    const durationMs = Math.max(0, Math.round(performance.now() - startedAt));
    await evidenceWriter.writeJson(
      jsonPath,
      evidenceRecord(
        artifact,
        inputs,
        runId,
        result,
        completedSteps,
        outputs,
        durationMs,
        { json: jsonPath, screenshot: screenshotPath, trace: tracePath },
      ),
    );

    console.log(JSON.stringify(result, null, 2));
    console.log(`Evidence: ${jsonPath}, ${screenshotPath}, ${tracePath}`);
    if (result.status === "failure") process.exitCode = 1;
  } finally {
    if (tracing) {
      try {
        await session.stopTrace(tracePath);
      } catch (error) {
        console.error(`Could not save replay trace: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    await session.close();
  }
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
