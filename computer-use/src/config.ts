import "dotenv/config";
import { z } from "zod";

const environmentSchema = z.object({
  BANK_APP_URL: z.url().default("http://localhost:5174"),
  BANK_API_URL: z.url().default("http://localhost:8001"),
  HEADLESS: z.enum(["true", "false"]).default("false"),
});

export interface AppConfig {
  bankAppUrl: string;
  bankApiUrl: string;
  headless: boolean;
}

export function readConfig(environment: NodeJS.ProcessEnv = process.env): AppConfig {
  const values = environmentSchema.parse(environment);
  return {
    bankAppUrl: values.BANK_APP_URL,
    bankApiUrl: values.BANK_API_URL,
    headless: values.HEADLESS === "true",
  };
}
