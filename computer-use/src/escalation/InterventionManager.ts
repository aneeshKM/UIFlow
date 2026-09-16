import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type { SurfaceObserver } from "../browser/SurfaceObserver.js";
import { evidenceWriter } from "../evidence/EvidenceWriter.js";
import { redactObservation } from "../evidence/Redactor.js";
import type { SessionControl } from "./SessionControl.js";
import type { OperatorConsole, OperatorConsoleResult } from "./OperatorConsole.js";
import type {
  InterventionDetails,
  InterventionEvidencePaths,
  InterventionHandler,
  InterventionOutcome,
  InterventionRequest,
} from "./types.js";

export interface InterventionManagerOptions {
  evidenceDirectory?: string;
  now?: () => Date;
  idFactory?: () => string;
}

export class InterventionManager implements InterventionHandler {
  private readonly evidenceDirectory: string;
  private readonly now: () => Date;
  private readonly idFactory: () => string;

  constructor(
    private readonly observer: SurfaceObserver,
    private readonly sessionControl: SessionControl,
    private readonly operatorConsole: OperatorConsole,
    options: InterventionManagerOptions = {},
  ) {
    this.evidenceDirectory = options.evidenceDirectory ?? join("evidence", "escalation");
    this.now = options.now ?? (() => new Date());
    this.idFactory = options.idFactory ?? (() => `int-${randomUUID()}`);
  }

  async requestIntervention(details: InterventionDetails): Promise<InterventionOutcome> {
    this.sessionControl.assertAutomationControl();
    const interventionId = this.idFactory();
    const paths = this.paths(interventionId);
    const observation = await this.observer.observe("AUTOMATION");
    const request: InterventionRequest = {
      interventionId,
      ...details,
      currentUrl: observation.url,
      observation: redactObservation(observation.ariaSnapshot || observation.visibleText),
      screenshotPath: paths.beforeScreenshot,
      createdAt: this.now().toISOString(),
    };
    return this.handleIntervention(request, paths);
  }

  async handleIntervention(
    request: InterventionRequest,
    paths: InterventionEvidencePaths = this.paths(request.interventionId),
  ): Promise<InterventionOutcome> {
    this.sessionControl.assertAutomationControl();
    await evidenceWriter.writeBinary(paths.beforeScreenshot, await this.observer.captureScreenshot("AUTOMATION"));

    const transferredAt = this.now().toISOString();
    this.sessionControl.giveToHuman();
    let consoleResult: OperatorConsoleResult;
    let returnedAt: string | undefined;
    let afterScreenshotError: string | undefined;
    try {
      consoleResult = await this.operatorConsole.run(request);
      if (paths.afterScreenshot !== undefined) {
        try {
          await evidenceWriter.writeBinary(paths.afterScreenshot, await this.observer.captureScreenshot("HUMAN"));
        } catch (error) {
          afterScreenshotError = error instanceof Error ? error.message : String(error);
        }
      }
    } finally {
      if (this.sessionControl.getOwner() === "HUMAN") {
        this.sessionControl.giveToAutomation();
        returnedAt = this.now().toISOString();
      }
    }
    const resolvedAt = returnedAt ?? this.now().toISOString();
    const evidence: InterventionEvidencePaths = afterScreenshotError === undefined
      ? paths
      : { json: paths.json, beforeScreenshot: paths.beforeScreenshot };

    const outcome: InterventionOutcome = {
      request,
      resolution: consoleResult.resolution,
      humanActions: consoleResult.humanActions,
      evidence,
      resolvedAt,
    };
    await evidenceWriter.writeJson(paths.json, {
      interventionId: request.interventionId,
      runId: request.runId,
      source: request.source,
      capabilityId: request.capabilityId,
      goal: request.goal,
      reason: request.reason,
      message: request.message,
      stepId: request.stepId,
      stepIndex: request.stepIndex,
      currentUrl: request.currentUrl,
      observation: request.observation,
      screenshotPath: request.screenshotPath,
      createdAt: request.createdAt,
      control: {
        from: "AUTOMATION",
        to: "HUMAN",
        transferredAt,
        returnedTo: "AUTOMATION",
        returnedAt: resolvedAt,
      },
      humanActions: consoleResult.humanActions,
      resolution: consoleResult.resolution.action,
      resolvedAt,
      ...(consoleResult.resolution.note === undefined ? {} : { note: consoleResult.resolution.note }),
      evidence,
      ...(afterScreenshotError === undefined ? {} : { afterScreenshotError }),
    });
    return outcome;
  }

  private paths(interventionId: string): InterventionEvidencePaths {
    return {
      json: join(this.evidenceDirectory, `intervention-${interventionId}.json`),
      beforeScreenshot: join(this.evidenceDirectory, `intervention-${interventionId}-before.png`),
      afterScreenshot: join(this.evidenceDirectory, `intervention-${interventionId}-after.png`),
    };
  }
}
