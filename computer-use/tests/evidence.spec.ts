import { join } from "node:path";
import { expect, test } from "@playwright/test";
import {
  createDiscoveryEvidencePaths,
  createInterventionEvidencePaths,
  createReplayEvidencePaths,
  formatRunDirectory,
  shortId,
} from "../src/evidence/paths.js";

const runId = "12345678-90ab-cdef-1234-567890abcdef";

test("formats run directories in UTC with the first eight run ID characters", () => {
  expect(formatRunDirectory("2026-09-15T22:04:05-04:00", runId))
    .toBe("2026-09-16_02-04-05__12345678");
  expect(shortId(runId)).toBe("12345678");
});

test("creates discovery and replay paths inside separate timestamped run directories", () => {
  const root = join("tmp", "evidence");
  const startedAt = "2026-09-16T02:04:05.987Z";

  expect(createDiscoveryEvidencePaths(startedAt, runId, root)).toEqual({
    directory: join(root, "discovery", "2026-09-16_02-04-05__12345678"),
    json: join(root, "discovery", "2026-09-16_02-04-05__12345678", "discovery_12345678.json"),
    screenshot: join(root, "discovery", "2026-09-16_02-04-05__12345678", "discovery_12345678.png"),
    trace: join(root, "discovery", "2026-09-16_02-04-05__12345678", "discovery_12345678-trace.zip"),
  });
  expect(createReplayEvidencePaths(startedAt, runId, root)).toEqual({
    directory: join(root, "replay", "2026-09-16_02-04-05__12345678"),
    json: join(root, "replay", "2026-09-16_02-04-05__12345678", "replay_12345678.json"),
    screenshot: join(root, "replay", "2026-09-16_02-04-05__12345678", "replay_12345678.png"),
    trace: join(root, "replay", "2026-09-16_02-04-05__12345678", "replay_12345678-trace.zip"),
  });
});

test("nests intervention evidence under its parent run", () => {
  const runDirectory = join("evidence", "replay", "2026-09-16_02-04-05__12345678");
  const directory = join(runDirectory, "interventions", "int-7951");

  expect(createInterventionEvidencePaths(
    runDirectory,
    "int-7951b959-ae2f-476d-ac47-81215bae328b",
  )).toEqual({
    json: join(directory, "intervention.json"),
    beforeScreenshot: join(directory, "before.png"),
    afterScreenshot: join(directory, "after.png"),
  });
});

test("rejects invalid timestamps and unsafe short IDs", () => {
  expect(() => formatRunDirectory("not-a-date", runId)).toThrow(/valid date/);
  expect(() => shortId("../escape")).toThrow(/Evidence IDs/);
});
