import { z } from "zod";
import { DECISION_SUMMARY_MAX_LENGTH, sanitizeDecisionSummary } from "../evidence/Redactor.js";
import type { AgentDecision, AgentRole } from "./types.js";

export const AgentRoles = [
  "button",
  "cell",
  "checkbox",
  "combobox",
  "dialog",
  "form",
  "grid",
  "gridcell",
  "heading",
  "img",
  "link",
  "list",
  "listbox",
  "listitem",
  "menu",
  "menuitem",
  "navigation",
  "option",
  "radio",
  "region",
  "row",
  "search",
  "slider",
  "spinbutton",
  "switch",
  "tab",
  "table",
  "tabpanel",
  "textbox",
] as const satisfies readonly AgentRole[];

const AgentTargetSchema = z.object({
  role: z.enum(AgentRoles).nullable(),
  name: z.string().nullable(),
  text: z.string().nullable(),
}).strict();

const AgentOutputSchema = z.object({
  name: z.string(),
  value: z.string(),
}).strict();

// Structured Outputs requires every property to be required. Nullable fields
// represent optional domain fields and are removed by parseAgentDecision().
export const AgentDecisionSchema = z.object({
  action: z.enum(["click", "type", "read", "navigate", "wait", "finish", "fail"]),
  target: AgentTargetSchema.nullable(),
  value: z.string().nullable(),
  inputName: z.string().nullable(),
  outputName: z.string().nullable(),
  extractionPattern: z.string().nullable(),
  decisionSummary: z.string()
    .min(1)
    .max(DECISION_SUMMARY_MAX_LENGTH)
    .regex(/^[^\r\n]*\S[^\r\n]*$/, "decisionSummary must be a nonblank, single-line sentence.")
    .describe("One short operational sentence based only on the goal and observable UI that explains why the selected action is appropriate. Never include private chain-of-thought, speculation, credentials, secrets, tokens, or unnecessary PII."),
  result: z.array(AgentOutputSchema).nullable(),
}).strict();

export type StructuredAgentDecision = z.infer<typeof AgentDecisionSchema>;

export function parseAgentDecision(input: unknown): AgentDecision {
  const parsed = AgentDecisionSchema.parse(input);
  const target = parsed.target === null
    ? undefined
    : {
        ...(parsed.target.role === null ? {} : { role: parsed.target.role }),
        ...(parsed.target.name === null ? {} : { name: parsed.target.name }),
        ...(parsed.target.text === null ? {} : { text: parsed.target.text }),
      };
  const result = parsed.result === null
    ? undefined
    : Object.fromEntries(parsed.result.map(({ name, value }) => [name, value]));

  return {
    action: parsed.action,
    ...(target === undefined ? {} : { target }),
    ...(parsed.value === null ? {} : { value: parsed.value }),
    ...(parsed.inputName === null ? {} : { inputName: parsed.inputName }),
    ...(parsed.outputName === null ? {} : { outputName: parsed.outputName }),
    ...(parsed.extractionPattern === null ? {} : { extractionPattern: parsed.extractionPattern }),
    decisionSummary: sanitizeDecisionSummary(parsed.decisionSummary),
    ...(result === undefined ? {} : { result }),
  };
}
