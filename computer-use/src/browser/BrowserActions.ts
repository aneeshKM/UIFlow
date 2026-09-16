import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { errors, type Locator } from "playwright";
import type { BrowserSession } from "./BrowserSession.js";
import type { LocatorResolver } from "./LocatorResolver.js";
import type { SessionControl } from "../escalation/SessionControl.js";
import { SessionControlError } from "../escalation/SessionControl.js";
import type { ControlOwner } from "../escalation/types.js";
import type { ActionResult, LocatorSpec } from "./types.js";

type WaitState = "visible" | "hidden" | "attached";

export class BrowserActions {
  constructor(
    private readonly session: BrowserSession,
    private readonly resolver: LocatorResolver,
    private readonly sessionControl?: SessionControl,
  ) {}

  private locator(spec: LocatorSpec): Locator {
    return this.resolver.resolve(this.session.getPage(), spec);
  }

  private async run<T>(
    action: string,
    operation: () => Promise<T>,
    target?: LocatorSpec,
    owner: ControlOwner = "AUTOMATION",
  ): Promise<ActionResult<T>> {
    try {
      this.sessionControl?.assertOwner(owner);
      const data = await operation();
      return { success: true, action, data };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      let type: NonNullable<ActionResult["error"]>["type"] = "ACTION_FAILED";
      if (message === "Browser session has not started.") {
        type = "BROWSER_NOT_STARTED";
      } else if (error instanceof SessionControlError) {
        type = "CONTROL_VIOLATION";
      } else if (error instanceof errors.TimeoutError) {
        type = "ACTION_TIMEOUT";
        if (target) {
          try {
            if (await this.locator(target).count() === 0) type = "ELEMENT_NOT_FOUND";
          } catch {
            // Keep the original action error.
          }
        }
      }

      const screenshotPath = error instanceof SessionControlError ? undefined : await this.captureFailure(action);
      return { success: false, action, error: { type, message, screenshotPath } };
    }
  }

  private async captureFailure(action: string): Promise<string | undefined> {
    try {
      const path = join(
        "evidence",
        "screenshots",
        `${action}-failure-${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}.png`,
      );
      await mkdir(dirname(path), { recursive: true });
      await this.session.getPage().screenshot({ path });
      return path;
    } catch {
      return undefined;
    }
  }

  navigate(url: string, timeoutMs?: number, owner: ControlOwner = "AUTOMATION"): Promise<ActionResult> {
    return this.run("navigate", async () => {
      await this.session.navigate(url, timeoutMs);
      return undefined;
    }, undefined, owner);
  }

  click(target: LocatorSpec, timeoutMs?: number, owner: ControlOwner = "AUTOMATION"): Promise<ActionResult> {
    return this.run("click", async () => {
      await this.locator(target).click({ timeout: timeoutMs });
      return undefined;
    }, target, owner);
  }

  fill(target: LocatorSpec, value: string, timeoutMs?: number, owner: ControlOwner = "AUTOMATION"): Promise<ActionResult> {
    return this.run("fill", async () => {
      await this.locator(target).fill(value, { timeout: timeoutMs });
      return undefined;
    }, target, owner);
  }

  readText(target: LocatorSpec, timeoutMs?: number, owner: ControlOwner = "AUTOMATION"): Promise<ActionResult<string>> {
    return this.run("readText", () => this.locator(target).innerText({ timeout: timeoutMs }), target, owner);
  }

  getValue(target: LocatorSpec, owner: ControlOwner = "AUTOMATION"): Promise<ActionResult<string>> {
    return this.run("getValue", () => this.locator(target).inputValue(), target, owner);
  }

  selectOption(target: LocatorSpec, value: string, owner: ControlOwner = "AUTOMATION"): Promise<ActionResult<string[]>> {
    return this.run("selectOption", () => this.locator(target).selectOption(value), target, owner);
  }

  press(target: LocatorSpec, key: string, owner: ControlOwner = "AUTOMATION"): Promise<ActionResult> {
    return this.run("press", async () => {
      await this.locator(target).press(key);
      return undefined;
    }, target, owner);
  }

  isVisible(target: LocatorSpec, timeoutMs?: number, owner: ControlOwner = "AUTOMATION"): Promise<ActionResult<boolean>> {
    return this.run("isVisible", () => this.locator(target).isVisible({ timeout: timeoutMs }), target, owner);
  }

  waitFor(target: LocatorSpec, state: WaitState = "visible", timeoutMs?: number, owner: ControlOwner = "AUTOMATION"): Promise<ActionResult> {
    return this.run("waitFor", async () => {
      await this.locator(target).waitFor({ state, timeout: timeoutMs });
      return undefined;
    }, target, owner);
  }

  wait(durationMs = 500, owner: ControlOwner = "AUTOMATION"): Promise<ActionResult> {
    const boundedDuration = Math.min(Math.max(durationMs, 0), 2_000);
    return this.run("wait", async () => {
      await this.session.getPage().waitForTimeout(boundedDuration);
      return undefined;
    }, undefined, owner);
  }

  screenshot(path: string, owner: ControlOwner = "AUTOMATION"): Promise<ActionResult<string>> {
    return this.run("screenshot", async () => {
      await mkdir(dirname(path), { recursive: true });
      await this.session.getPage().screenshot({ path });
      return path;
    }, undefined, owner);
  }
}
