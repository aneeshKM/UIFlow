import "dotenv/config";
import { z } from "zod";

const environmentSchema = z.object({
  BANK_APP_URL: z.url().default("http://localhost:5174"),
  BANK_API_URL: z.url().default("http://localhost:8001"),
  HEADLESS: z.enum(["true", "false"]).default("false"),
  OPENAI_API_KEY: z.string().trim().default(""),
  OPENAI_MODEL: z.string().trim().min(1).default("gpt-5.6-terra"),
  AGENT_MAX_STEPS: z.coerce.number().int().positive().max(100).default(20),
  AGENT_TIMEOUT_MS: z.coerce.number().int().positive().max(900_000).default(120_000),
});

export interface AppConfig {
  bankAppUrl: string;
  bankApiUrl: string;
  headless: boolean;
  openaiApiKey: string;
  openaiModel: string;
  agentMaxSteps: number;
  agentTimeoutMs: number;
}

export interface DiscoveryConfig extends AppConfig {
  openaiApiKey: string;
}

export function readConfig(environment: NodeJS.ProcessEnv = process.env): AppConfig {
  const values = environmentSchema.parse(environment);
  return {
    bankAppUrl: values.BANK_APP_URL,
    bankApiUrl: values.BANK_API_URL,
    headless: values.HEADLESS === "true",
    openaiApiKey: values.OPENAI_API_KEY,
    openaiModel: values.OPENAI_MODEL,
    agentMaxSteps: values.AGENT_MAX_STEPS,
    agentTimeoutMs: values.AGENT_TIMEOUT_MS,
  };
}

export function readDiscoveryConfig(environment: NodeJS.ProcessEnv = process.env): DiscoveryConfig {
  const config = readConfig(environment);
  if (!config.openaiApiKey) {
    throw new Error("OPENAI_API_KEY is required to run discovery. Add it to computer-use/.env.");
  }
  return config;
}
