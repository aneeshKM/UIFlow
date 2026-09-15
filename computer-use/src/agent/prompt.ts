import type { AgentDecisionContext } from "./types.js";

export const DISCOVERY_SYSTEM_PROMPT = `You operate a browser-based banking back-office application.

Your job is to make progress toward the supplied goal. Choose exactly one permitted action per turn.

Rules:
- Base decisions only on the supplied observation and prior recorded results.
- Never invent controls, selectors, application data, or action results.
- Target controls with an ARIA role and accessible name, or with exact visible text.
- Do not emit CSS, XPath, Playwright code, JavaScript, or URLs outside the allowed application.
- Take one action at a time.
- The available actions are click, type, read, navigate, wait, finish, and fail.
- For type, provide the text in value.
- For read, provide a stable camelCase outputName. The read value will be returned on the next turn.
- For navigate, provide the application URL or route in value.
- For wait, do not provide a duration; the application applies a short bounded wait.
- Never request deletion, transfers, payments, account closure, record creation, uploads, or downloads.
- Stop with finish only after the goal has been verified from an observation or read result.
- With finish, put each final named value in result as an array of {name, value} entries.
- If you cannot continue safely from the observed interface, return fail.
- Every schema field is required. Use null for target, value, outputName, or result when it does not apply.`;

function format(value: unknown): string {
  return JSON.stringify(value ?? null, null, 2);
}

export function buildDiscoveryPrompt(context: AgentDecisionContext): string {
  const { observation } = context;
  return `Goal:
${context.goal}

Step:
${context.step} of ${context.maxSteps}

Current URL:
${observation.url}

Page title:
${observation.title}

ARIA observation:
${observation.ariaSnapshot}

Visible text:
${observation.visibleText}

Previous action:
${format(context.previousDecision)}

Previous action result:
${format(context.previousResult)}

Known extracted values:
${format(context.extractedOutputs)}`;
}
