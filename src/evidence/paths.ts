import { join } from "node:path";
import type { DiscoveryEvidencePaths } from "../agent/types.js";
import type { InterventionEvidencePaths } from "../escalation/types.js";

export interface RunEvidencePaths extends DiscoveryEvidencePaths {
  directory: string;
  trace: string;
}

const SAFE_SHORT_ID = /^[A-Za-z0-9_-]+$/;

export function shortId(id: string): string {
  const value = id.slice(0, 8);
  if (!value || !SAFE_SHORT_ID.test(value)) {
    throw new Error("Evidence IDs must begin with letters, numbers, underscores, or hyphens.");
  }
  return value;
}

export function formatRunDirectory(startedAt: Date | string, runId: string): string {
  const date = startedAt instanceof Date ? startedAt : new Date(startedAt);
  if (Number.isNaN(date.getTime())) throw new Error("Run start timestamp must be a valid date.");

  const part = (value: number): string => String(value).padStart(2, "0");
  const timestamp = [
    date.getUTCFullYear(),
    "-",
    part(date.getUTCMonth() + 1),
    "-",
    part(date.getUTCDate()),
    "_",
    part(date.getUTCHours()),
    "-",
    part(date.getUTCMinutes()),
    "-",
    part(date.getUTCSeconds()),
  ].join("");
  return `${timestamp}__${shortId(runId)}`;
}

function createRunEvidencePaths(
  kind: "discovery" | "replay",
  startedAt: Date | string,
  runId: string,
  evidenceRoot: string,
): RunEvidencePaths {
  const id = shortId(runId);
  const directory = join(evidenceRoot, kind, formatRunDirectory(startedAt, runId));
  return {
    directory,
    json: join(directory, `${kind}_${id}.json`),
    screenshot: join(directory, `${kind}_${id}.png`),
    trace: join(directory, `${kind}_${id}-trace.zip`),
  };
}

export function createDiscoveryEvidencePaths(
  startedAt: Date | string,
  runId: string,
  evidenceRoot = "evidence",
): RunEvidencePaths {
  return createRunEvidencePaths("discovery", startedAt, runId, evidenceRoot);
}

export function createReplayEvidencePaths(
  startedAt: Date | string,
  runId: string,
  evidenceRoot = "evidence",
): RunEvidencePaths {
  return createRunEvidencePaths("replay", startedAt, runId, evidenceRoot);
}

export function createInterventionEvidencePaths(
  runDirectory: string,
  interventionId: string,
): InterventionEvidencePaths {
  const directory = join(runDirectory, "interventions", shortId(interventionId));
  return {
    json: join(directory, "intervention.json"),
    beforeScreenshot: join(directory, "before.png"),
    afterScreenshot: join(directory, "after.png"),
  };
}
