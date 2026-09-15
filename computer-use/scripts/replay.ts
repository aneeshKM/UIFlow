import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { ArtifactValidator } from "../src/artifact/ArtifactValidator.js";
import type { CapabilityArtifact } from "../src/artifact/types.js";
import { BrowserActions } from "../src/browser/BrowserActions.js";
import { BrowserSession } from "../src/browser/BrowserSession.js";
import { LocatorResolver } from "../src/browser/LocatorResolver.js";
import { SurfaceObserver } from "../src/browser/SurfaceObserver.js";
import type { ActionResult } from "../src/browser/types.js";
import { readConfig } from "../src/config.js";
import { CheckpointEvaluator } from "../src/replay/CheckpointEvaluator.js";
import { InputResolver } from "../src/replay/InputResolver.js";
import { OutcomeDetector } from "../src/replay/OutcomeDetector.js";
import { ReplayEngine } from "../src/replay/ReplayEngine.js";
import { StepExecutor } from "../src/replay/StepExecutor.js";
import type { ReplayResult, RuntimeInputs, RuntimeOutputs } from "../src/replay/types.js";

function parseArguments(argv: string[]): { artifactPath: string; inputs: RuntimeInputs } {
  const [artifactPath, ...argumentsAfterPath] = argv;
  if (!artifactPath || artifactPath.startsWith("--")) {
    throw new Error("Usage: npm run replay -- <artifact.json> --key value [--key value ...]");
  }

  const inputs: RuntimeInputs = {};
  for (let index = 0; index < argumentsAfterPath.length; index += 1) {
    const argument = argumentsAfterPath[index]!;
    if (!argument.startsWith("--") || argument === "--") {
      throw new Error(`Expected a --key runtime input, received "${argument}".`);
    }

    const equalsIndex = argument.indexOf("=");
    const name = argument.slice(2, equalsIndex === -1 ? undefined : equalsIndex);
    const value = equalsIndex === -1 ? argumentsAfterPath[++index] : argument.slice(equalsIndex + 1);
    if (!name || value === undefined || value.startsWith("--")) {
      throw new Error(`Runtime input "${argument}" requires a value.`);
    }
    if (Object.prototype.hasOwnProperty.call(inputs, name)) {
      throw new Error(`Runtime input "${name}" was provided more than once.`);
    }
    inputs[name] = value;
  }
  return { artifactPath: resolve(artifactPath), inputs };
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
): Record<string, unknown> {
  return {
    runId,
    artifact: { id: artifact.capability.id, version: artifact.capability.version },
    inputNames: Object.keys(inputs).sort(),
    status: result.status,
    completedSteps,
    outputs,
    durationMs,
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
  const { artifactPath, inputs } = parseArguments(process.argv.slice(2));
  const artifact = await loadArtifact(artifactPath);
  const config = readConfig();
  const runId = randomUUID();
  const evidenceDirectory = join("evidence", "replay");
  const jsonPath = join(evidenceDirectory, `replay-${runId}.json`);
  const screenshotPath = join(evidenceDirectory, `replay-${runId}.png`);
  const tracePath = join(evidenceDirectory, `replay-${runId}-trace.zip`);
  const session = new BrowserSession(config.headless);
  const actions = new BrowserActions(session, new LocatorResolver());
  const observer = new SurfaceObserver(session);
  const inputResolver = new InputResolver();
  let sessionStarted = false;
  let tracing = false;
  let completedSteps = 0;
  let outputs: RuntimeOutputs = {};
  const startedAt = performance.now();

  const engine = new ReplayEngine(
    {
      stepExecutor: new StepExecutor(actions, observer, inputResolver, artifact.inputs),
      checkpointEvaluator: new CheckpointEvaluator(actions, observer),
      outcomeDetector: new OutcomeDetector(observer, actions),
      inputResolver,
    },
    {
      runId,
      prepare: async (validatedArtifact) => {
        await session.start();
        sessionStarted = true;
        await session.startTrace();
        tracing = true;

        requireSuccess(await actions.navigate(new URL("/login", validatedArtifact.target.baseUrl).toString()));
        requireSuccess(await actions.fill({ strategy: "label", label: "Employee ID" }, "replay-session"));
        requireSuccess(await actions.fill({ strategy: "label", label: "Password" }, "replay-session"));
        requireSuccess(await actions.click({ strategy: "role", role: "button", name: "Sign In" }));
        requireSuccess(await actions.waitFor({ strategy: "role", role: "heading", name: "Operations Dashboard" }));
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
    await mkdir(evidenceDirectory, { recursive: true });
    const durationMs = Math.max(0, Math.round(performance.now() - startedAt));
    await writeFile(
      jsonPath,
      `${JSON.stringify(evidenceRecord(
        artifact,
        inputs,
        runId,
        result,
        completedSteps,
        outputs,
        durationMs,
      ), null, 2)}\n`,
      { encoding: "utf8", mode: 0o600 },
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

