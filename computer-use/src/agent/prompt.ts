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
- For type, provide the text in value and a stable camelCase inputName describing that runtime value. Name entity identifiers <entity>Id (for example memberId), even if the UI label calls them a number.
- For read, provide a stable camelCase outputName. Target a stable labeled container such as an account row, never the displayed value itself. Use only the stable prefix of its accessible name (for example Savings rather than the entire row). When the target text contains extra content, provide an extractionPattern regular expression whose first capture group selects only the requested value. The first capture group, or the whole match when there is no group, will be returned on the next turn. Patterns must describe the value format and must not contain digits copied from the observed value.
- For navigate, provide the application URL or route in value.
- For wait, do not provide a duration; the application applies a short bounded wait.
- Do not choose wait unless the observation shows a transient loading state or a specific target is expected to appear.
- Never repeat a successful action when the URL, settled page content, and known extracted values are unchanged.
- Never request deletion, transfers, payments, account closure, record creation, uploads, or downloads.
- Use read for every value the goal asks you to return, even when the value is already visible in the page observation.
- Stop with finish only after every result value exists in Known extracted values.
- With finish, copy the verified Known extracted values into result as an array of {name, value} entries. Do not derive or rename values in finish.
- If you cannot continue safely from the observed interface, return fail.
- Every schema field is required. Use null for target, value, inputName, outputName, extractionPattern, or result when it does not apply.`;

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
