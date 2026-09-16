import "dotenv/config";
import { z } from "zod";

const environmentSchema = z.object({
  BANK_APP_URL: z.url().default("http://localhost:5174"),
  BANK_API_URL: z.url().default("http://localhost:8001"),
  ALLOWED_ORIGINS: z.string().trim().default(""),
  ALLOWED_ROUTES: z.string().trim().default("/login,/dashboard,/members,/accounts"),
  HEADLESS: z.enum(["true", "false"]).default("false"),
  OPENAI_API_KEY: z.string().trim().default(""),
  OPENAI_MODEL: z.string().trim().min(1).default("gpt-5.6-terra"),
  MODEL_REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().max(120_000).default(30_000),
  AGENT_RUN_TIMEOUT_MS: z.coerce.number().int().positive().max(900_000).default(90_000),
  AGENT_MAX_STEPS: z.coerce.number().int().positive().max(100).default(12),
  AGENT_STALL_LIMIT: z.coerce.number().int().positive().max(10).default(2),
});

export interface AppConfig {
  bankAppUrl: string;
  bankApiUrl: string;
  allowedOrigins: string[];
  allowedRoutes: string[];
  headless: boolean;
  openaiApiKey: string;
  openaiModel: string;
  modelRequestTimeoutMs: number;
  agentMaxSteps: number;
  agentRunTimeoutMs: number;
  agentStallLimit: number;
}

export interface DiscoveryConfig extends AppConfig {
  openaiApiKey: string;
}

export function readConfig(environment: NodeJS.ProcessEnv = process.env): AppConfig {
  const values = environmentSchema.parse(environment);
  const allowedOrigins = (values.ALLOWED_ORIGINS || values.BANK_APP_URL)
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const allowedRoutes = values.ALLOWED_ROUTES
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  return {
    bankAppUrl: values.BANK_APP_URL,
    bankApiUrl: values.BANK_API_URL,
    allowedOrigins,
    allowedRoutes,
    headless: values.HEADLESS === "true",
    openaiApiKey: values.OPENAI_API_KEY,
    openaiModel: values.OPENAI_MODEL,
    modelRequestTimeoutMs: values.MODEL_REQUEST_TIMEOUT_MS,
    agentMaxSteps: values.AGENT_MAX_STEPS,
    agentRunTimeoutMs: values.AGENT_RUN_TIMEOUT_MS,
    agentStallLimit: values.AGENT_STALL_LIMIT,
  };
}

export function readDiscoveryConfig(environment: NodeJS.ProcessEnv = process.env): DiscoveryConfig {
  const config = readConfig(environment);
  if (!config.openaiApiKey) {
    throw new Error("OPENAI_API_KEY is required to run discovery. Add it to computer-use/.env.");
  }
  return config;
}
