import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import type { BrowserActions } from "../browser/BrowserActions.js";
import type { BrowserSession } from "../browser/BrowserSession.js";
import type { LocatorResolver } from "../browser/LocatorResolver.js";
import type { SurfaceObserver } from "../browser/SurfaceObserver.js";
import type { AgentRole } from "../agent/types.js";
import type { SessionControl } from "./SessionControl.js";
import type {
  HumanActionRecord,
  InterventionRequest,
  InterventionResolution,
} from "./types.js";

export interface OperatorConsoleIO {
  question(prompt: string): Promise<string>;
  write(message: string): void;
  close(): void;
}

export interface OperatorConsoleDependencies {
  session: BrowserSession;
  actions: BrowserActions;
  observer: SurfaceObserver;
  resolver: LocatorResolver;
  sessionControl: SessionControl;
  io?: OperatorConsoleIO;
  now?: () => Date;
  maxDurationMs?: number;
}

export interface OperatorConsoleResult {
  resolution: InterventionResolution;
  humanActions: HumanActionRecord[];
}

function target(role: string, name: string): { strategy: "role"; role: AgentRole; name: string } {
  return { strategy: "role", role: role as AgentRole, name };
}

function printRequest(io: OperatorConsoleIO, request: InterventionRequest): void {
  io.write([
    "",
    "=====================================",
    "HUMAN INTERVENTION REQUIRED",
    "",
    `Source: ${request.source}`,
    ...(request.capabilityId === undefined ? [] : [`Capability: ${request.capabilityId}`]),
    ...(request.goal === undefined ? [] : [`Goal: ${request.goal}`]),
    ...(request.stepId === undefined ? [] : [`Step: ${request.stepId}`]),
    `Reason: ${request.reason}`,
    `Message: ${request.message}`,
    `Current URL: ${request.currentUrl}`,
    "",
    "Automation is paused.",
    "Control owner: HUMAN",
    "Commands: observe, click, type, read, retry, complete, abort",
    "=====================================",
    "",
  ].join("\n"));
}

export class OperatorConsole {
  readonly session: BrowserSession;
  readonly actions: BrowserActions;
  readonly observer: SurfaceObserver;
  readonly resolver: LocatorResolver;
  readonly sessionControl: SessionControl;
  private readonly suppliedIO?: OperatorConsoleIO;
  private readonly now: () => Date;
  private readonly maxDurationMs: number;

  constructor(dependencies: OperatorConsoleDependencies) {
    this.session = dependencies.session;
    this.actions = dependencies.actions;
    this.observer = dependencies.observer;
    this.resolver = dependencies.resolver;
    this.sessionControl = dependencies.sessionControl;
    this.suppliedIO = dependencies.io;
    this.now = dependencies.now ?? (() => new Date());
    this.maxDurationMs = dependencies.maxDurationMs ?? 15 * 60_000;
    if (!Number.isInteger(this.maxDurationMs) || this.maxDurationMs < 1) {
      throw new Error("maxDurationMs must be a positive integer.");
    }
  }

  async run(request: InterventionRequest): Promise<OperatorConsoleResult> {
    this.sessionControl.assertHumanControl();
    const readline = this.suppliedIO ?? createInterface({ input, output });
    const humanActions: HumanActionRecord[] = [];
    printRequest(readline, request);
    const deadline = new AbortController();
    const timer = setTimeout(() => deadline.abort(), this.maxDurationMs);
    timer.unref();
    const ask = async (prompt: string): Promise<string> => {
      if (deadline.signal.aborted) throw new Error("Operator intervention timed out.");
      return new Promise<string>((resolve, reject) => {
        const onAbort = (): void => reject(new Error("Operator intervention timed out."));
        deadline.signal.addEventListener("abort", onAbort, { once: true });
        readline.question(prompt).then(
          (answer) => {
            deadline.signal.removeEventListener("abort", onAbort);
            resolve(answer);
          },
          (error: unknown) => {
            deadline.signal.removeEventListener("abort", onAbort);
            reject(error);
          },
        );
      });
    };

    try {
      for (;;) {
        const command = (await ask("operator> ")).trim().toLowerCase();
        switch (command) {
          case "observe": {
            const record = this.record("observe");
            try {
              const observation = await this.observer.observe("HUMAN");
              readline.write(`${observation.ariaSnapshot || observation.visibleText}\n`);
              humanActions.push({ ...record, result: "success" });
            } catch (error) {
              readline.write(`Observe failed: ${error instanceof Error ? error.message : String(error)}\n`);
              humanActions.push({ ...record, result: "failure" });
            }
            break;
          }
          case "click": {
            const role = await ask("Role: ");
            const name = await ask("Name: ");
            const actionTarget = { role: role.trim() as AgentRole, name: name.trim() };
            const result = await this.actions.click(target(role.trim(), name.trim()), undefined, "HUMAN");
            humanActions.push({ ...this.record("click"), target: actionTarget, result: result.success ? "success" : "failure" });
            readline.write(result.success ? "Click succeeded.\n" : `Click failed: ${result.error?.message}\n`);
            break;
          }
          case "type": {
            const role = await ask("Role: ");
            const name = await ask("Name: ");
            const value = await ask("Value: ");
            const actionTarget = { role: role.trim() as AgentRole, name: name.trim() };
            const result = await this.actions.fill(target(role.trim(), name.trim()), value, undefined, "HUMAN");
            humanActions.push({
              ...this.record("type"),
              target: actionTarget,
              value: "[REDACTED]",
              result: result.success ? "success" : "failure",
            });
            readline.write(result.success ? "Type succeeded.\n" : `Type failed: ${result.error?.message}\n`);
            break;
          }
          case "read": {
            const role = await ask("Role: ");
            const name = await ask("Name: ");
            const actionTarget = { role: role.trim() as AgentRole, name: name.trim() };
            const result = await this.actions.readText(target(role.trim(), name.trim()), undefined, "HUMAN");
            humanActions.push({ ...this.record("read"), target: actionTarget, result: result.success ? "success" : "failure" });
            readline.write(result.success ? `${result.data ?? ""}\n` : `Read failed: ${result.error?.message}\n`);
            break;
          }
          case "retry":
            return { resolution: await this.resolution(ask, "RETRY_STEP"), humanActions };
          case "complete":
            return { resolution: await this.resolution(ask, "STEP_COMPLETED"), humanActions };
          case "abort":
            return { resolution: await this.resolution(ask, "ABORT"), humanActions };
          default:
            readline.write("Unknown command. Use observe, click, type, read, retry, complete, or abort.\n");
        }
      }
    } catch (error) {
      if (deadline.signal.aborted) {
        return { resolution: { action: "ABORT", note: "Operator intervention timed out." }, humanActions };
      }
      throw error;
    } finally {
      clearTimeout(timer);
      if (this.suppliedIO === undefined) readline.close();
    }
  }

  private record(action: HumanActionRecord["action"]): Omit<HumanActionRecord, "result"> {
    return { timestamp: this.now().toISOString(), action };
  }

  private async resolution(
    ask: (prompt: string) => Promise<string>,
    action: InterventionResolution["action"],
  ): Promise<InterventionResolution> {
    const note = (await ask("Note (optional): ")).trim();
    return { action, ...(note === "" ? {} : { note }) };
  }
}
