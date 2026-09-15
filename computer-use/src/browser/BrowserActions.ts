import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { errors, type Locator } from "playwright";
import type { BrowserSession } from "./BrowserSession.js";
import type { LocatorResolver } from "./LocatorResolver.js";
import type { ActionResult, LocatorSpec } from "./types.js";

type WaitState = "visible" | "hidden" | "attached";

export class BrowserActions {
  constructor(
    private readonly session: BrowserSession,
    private readonly resolver: LocatorResolver,
  ) {}

  private locator(spec: LocatorSpec): Locator {
    return this.resolver.resolve(this.session.getPage(), spec);
  }

  private async run<T>(
    action: string,
    operation: () => Promise<T>,
    target?: LocatorSpec,
  ): Promise<ActionResult<T>> {
    try {
      const data = await operation();
      return { success: true, action, data };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      let type: NonNullable<ActionResult["error"]>["type"] = "ACTION_FAILED";
      if (message === "Browser session has not started.") {
        type = "BROWSER_NOT_STARTED";
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

      const screenshotPath = await this.captureFailure(action);
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

  navigate(url: string, timeoutMs?: number): Promise<ActionResult> {
    return this.run("navigate", async () => {
      await this.session.navigate(url, timeoutMs);
      return undefined;
    });
  }

  click(target: LocatorSpec, timeoutMs?: number): Promise<ActionResult> {
    return this.run("click", async () => {
      await this.locator(target).click({ timeout: timeoutMs });
      return undefined;
    }, target);
  }

  fill(target: LocatorSpec, value: string, timeoutMs?: number): Promise<ActionResult> {
    return this.run("fill", async () => {
      await this.locator(target).fill(value, { timeout: timeoutMs });
      return undefined;
    }, target);
  }

  readText(target: LocatorSpec, timeoutMs?: number): Promise<ActionResult<string>> {
    return this.run("readText", () => this.locator(target).innerText({ timeout: timeoutMs }), target);
  }

  getValue(target: LocatorSpec): Promise<ActionResult<string>> {
    return this.run("getValue", () => this.locator(target).inputValue(), target);
  }

  selectOption(target: LocatorSpec, value: string): Promise<ActionResult<string[]>> {
    return this.run("selectOption", () => this.locator(target).selectOption(value), target);
  }

  press(target: LocatorSpec, key: string): Promise<ActionResult> {
    return this.run("press", async () => {
      await this.locator(target).press(key);
      return undefined;
    }, target);
  }

  isVisible(target: LocatorSpec, timeoutMs?: number): Promise<ActionResult<boolean>> {
    return this.run("isVisible", () => this.locator(target).isVisible({ timeout: timeoutMs }), target);
  }

  waitFor(target: LocatorSpec, state: WaitState = "visible", timeoutMs?: number): Promise<ActionResult> {
    return this.run("waitFor", async () => {
      await this.locator(target).waitFor({ state, timeout: timeoutMs });
      return undefined;
    }, target);
  }

  wait(durationMs = 500): Promise<ActionResult> {
    const boundedDuration = Math.min(Math.max(durationMs, 0), 2_000);
    return this.run("wait", async () => {
      await this.session.getPage().waitForTimeout(boundedDuration);
      return undefined;
    });
  }

  screenshot(path: string): Promise<ActionResult<string>> {
    return this.run("screenshot", async () => {
      await mkdir(dirname(path), { recursive: true });
      await this.session.getPage().screenshot({ path });
      return path;
    });
  }
}
