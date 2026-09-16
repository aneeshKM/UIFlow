import { expect, test } from "@playwright/test";
import { readConfig } from "../src/config.js";

test("keeps model and discovery run timeouts independent", () => {
  const config = readConfig({
    MODEL_REQUEST_TIMEOUT_MS: "25000",
    AGENT_RUN_TIMEOUT_MS: "80000",
    AGENT_MAX_STEPS: "10",
    AGENT_STALL_LIMIT: "3",
  });

  expect(config).toMatchObject({
    modelRequestTimeoutMs: 25_000,
    agentRunTimeoutMs: 80_000,
    agentMaxSteps: 10,
    agentStallLimit: 3,
  });
});

test("rejects timeout and stall values outside their bounds", () => {
  expect(() => readConfig({ MODEL_REQUEST_TIMEOUT_MS: "0" })).toThrow();
  expect(() => readConfig({ AGENT_RUN_TIMEOUT_MS: "900001" })).toThrow();
  expect(() => readConfig({ AGENT_STALL_LIMIT: "0" })).toThrow();
});
