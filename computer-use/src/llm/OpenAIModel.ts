import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";
import { AgentDecisionSchema, parseAgentDecision } from "../agent/actionSchema.js";
import { buildDiscoveryPrompt, DISCOVERY_SYSTEM_PROMPT } from "../agent/prompt.js";
import type { AgentDecision, AgentDecisionContext, AgentModel } from "../agent/types.js";

export type OpenAIModelErrorCode = "api_error" | "invalid_response";

export class OpenAIModelError extends Error {
  constructor(
    public readonly code: OpenAIModelErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "OpenAIModelError";
  }
}

export interface OpenAIModelOptions {
  apiKey: string;
  model: string;
  requestTimeoutMs?: number;
  client?: OpenAI;
}

export class OpenAIModel implements AgentModel {
  private readonly client: OpenAI;
  private readonly model: string;

  constructor(options: OpenAIModelOptions) {
    this.client = options.client ?? new OpenAI({
      apiKey: options.apiKey,
      timeout: options.requestTimeoutMs,
      maxRetries: 2,
    });
    this.model = options.model;
  }

  async decideNextAction(context: AgentDecisionContext): Promise<AgentDecision> {
    try {
      const response = await this.client.responses.parse({
        model: this.model,
        store: false,
        reasoning: { effort: "low" },
        input: [
          { role: "system", content: DISCOVERY_SYSTEM_PROMPT },
          { role: "user", content: buildDiscoveryPrompt(context) },
        ],
        text: {
          format: zodTextFormat(AgentDecisionSchema, "agent_decision"),
        },
      }, context.signal === undefined ? undefined : { signal: context.signal });

      if (response.output_parsed === null) {
        throw new OpenAIModelError(
          "invalid_response",
          `The model returned no parsed decision (response ${response.id}).`,
        );
      }

      return parseAgentDecision(response.output_parsed);
    } catch (error) {
      if (error instanceof OpenAIModelError) throw error;
      if (error instanceof z.ZodError) {
        throw new OpenAIModelError("invalid_response", "The model returned an invalid decision.", { cause: error });
      }
      const message = error instanceof Error ? error.message : String(error);
      throw new OpenAIModelError("api_error", `OpenAI request failed: ${message}`, { cause: error });
    }
  }
}
