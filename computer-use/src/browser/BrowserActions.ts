import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { errors, type Locator } from "playwright";
import type { BrowserSession } from "./BrowserSession.js";
import type { LocatorResolver } from "./LocatorResolver.js";
import type { SessionControl } from "../escalation/SessionControl.js";
import { SessionControlError } from "../escalation/SessionControl.js";
import type { ControlOwner } from "../escalation/types.js";
import { evidenceWriter } from "../evidence/EvidenceWriter.js";
import type { ActionPolicy } from "../policy/ActionPolicy.js";
import { PolicyViolation } from "../policy/ActionPolicy.js";
import type { PolicyAction, PolicyTarget } from "../policy/types.js";
import type { ActionResult, LocatorSpec } from "./types.js";

type WaitState = "visible" | "hidden" | "attached";

export class BrowserActions {
  constructor(
    private readonly session: BrowserSession,
    private readonly resolver: LocatorResolver,
    private readonly policy: ActionPolicy,
    private readonly sessionControl?: SessionControl,
  ) {}

  private locator(spec: LocatorSpec): Locator {
    return this.resolver.resolve(this.session.getPage(), spec);
  }

  private async run<T>(
    action: string,
    policyAction: PolicyAction,
    operation: () => Promise<T>,
    target?: LocatorSpec,
    owner: ControlOwner = "AUTOMATION",
    destination?: string,
  ): Promise<ActionResult<T>> {
    try {
      this.sessionControl?.assertOwner(owner);
      const page = this.session.getPage();
      const currentUrl = page.url();
      this.policy.assertAllowed({
        action: policyAction,
        owner,
        ...(currentUrl === "about:blank" ? {} : { currentUrl }),
        ...(destination === undefined ? {} : { destination }),
        ...(target === undefined ? {} : { target: this.policyTarget(target) }),
      });
      const data = await operation();
      const resultingUrl = page.url();
      if (resultingUrl !== "about:blank") this.policy.assertUrlAllowed(resultingUrl);
      return { success: true, action, data };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      let type: NonNullable<ActionResult["error"]>["type"] = "ACTION_FAILED";
      if (message === "Browser session has not started.") {
        type = "BROWSER_NOT_STARTED";
      } else if (error instanceof SessionControlError) {
        type = "CONTROL_VIOLATION";
      } else if (error instanceof PolicyViolation) {
        type = error.risk === "REQUIRES_HUMAN" ? "POLICY_REQUIRES_HUMAN" : "POLICY_BLOCKED";
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

      const screenshotPath = error instanceof SessionControlError || error instanceof PolicyViolation
        ? undefined
        : await this.captureFailure(action, owner);
      return { success: false, action, error: { type, message, screenshotPath } };
    }
  }

  private async captureFailure(action: string, owner: ControlOwner): Promise<string | undefined> {
    try {
      this.sessionControl?.assertOwner(owner);
      this.policy.assertAllowed({ action: "observe", owner, currentUrl: this.session.getPage().url() });
      const path = join(
        "evidence",
        "screenshots",
        `${action}-failure-${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}.png`,
      );
      await evidenceWriter.writeBinary(path, await this.session.getPage().screenshot());
      return path;
    } catch {
      return undefined;
    }
  }

  navigate(url: string, timeoutMs?: number, owner: ControlOwner = "AUTOMATION"): Promise<ActionResult> {
    return this.run("navigate", "navigate", async () => {
      await this.session.navigate(url, timeoutMs);
      return undefined;
    }, undefined, owner, url);
  }

  click(target: LocatorSpec, timeoutMs?: number, owner: ControlOwner = "AUTOMATION"): Promise<ActionResult> {
    return this.run("click", "click", async () => {
      await this.locator(target).click({ timeout: timeoutMs });
      return undefined;
    }, target, owner);
  }

  fill(target: LocatorSpec, value: string, timeoutMs?: number, owner: ControlOwner = "AUTOMATION"): Promise<ActionResult> {
    return this.run("fill", "type", async () => {
      await this.locator(target).fill(value, { timeout: timeoutMs });
      return undefined;
    }, target, owner);
  }

  readText(target: LocatorSpec, timeoutMs?: number, owner: ControlOwner = "AUTOMATION"): Promise<ActionResult<string>> {
    return this.run("readText", "read", () => this.locator(target).innerText({ timeout: timeoutMs }), target, owner);
  }

  readTexts(target: LocatorSpec, timeoutMs?: number, owner: ControlOwner = "AUTOMATION"): Promise<ActionResult<string[]>> {
    return this.run("readTexts", "read", async () => {
      const locator = this.locator(target);
      await locator.first().waitFor({ state: "visible", timeout: timeoutMs });
      return locator.allInnerTexts();
    }, target, owner);
  }

  getValue(target: LocatorSpec, owner: ControlOwner = "AUTOMATION"): Promise<ActionResult<string>> {
    return this.run("getValue", "read", () => this.locator(target).inputValue(), target, owner);
  }

  selectOption(target: LocatorSpec, value: string, owner: ControlOwner = "AUTOMATION"): Promise<ActionResult<string[]>> {
    return this.run("selectOption", "type", () => this.locator(target).selectOption(value), target, owner);
  }

  press(target: LocatorSpec, key: string, owner: ControlOwner = "AUTOMATION"): Promise<ActionResult> {
    return this.run("press", "click", async () => {
      await this.locator(target).press(key);
      return undefined;
    }, target, owner);
  }

  isVisible(target: LocatorSpec, timeoutMs?: number, owner: ControlOwner = "AUTOMATION"): Promise<ActionResult<boolean>> {
    return this.run("isVisible", "read", () => this.locator(target).first().isVisible({ timeout: timeoutMs }), target, owner);
  }

  waitFor(target: LocatorSpec, state: WaitState = "visible", timeoutMs?: number, owner: ControlOwner = "AUTOMATION"): Promise<ActionResult> {
    return this.run("waitFor", "wait", async () => {
      await this.locator(target).waitFor({ state, timeout: timeoutMs });
      return undefined;
    }, target, owner);
  }

  wait(durationMs = 500, owner: ControlOwner = "AUTOMATION"): Promise<ActionResult> {
    const boundedDuration = Math.min(Math.max(durationMs, 0), 2_000);
    return this.run("wait", "wait", async () => {
      await this.session.getPage().waitForTimeout(boundedDuration);
      return undefined;
    }, undefined, owner);
  }

  screenshot(path: string, owner: ControlOwner = "AUTOMATION"): Promise<ActionResult<string>> {
    return this.run("screenshot", "observe", async () => {
      await evidenceWriter.writeBinary(path, await this.session.getPage().screenshot());
      return path;
    }, undefined, owner);
  }

  private policyTarget(target: LocatorSpec): PolicyTarget {
    switch (target.strategy) {
      case "role":
        return { role: target.role, ...(target.name === undefined ? {} : { name: target.name }) };
      case "label":
        return { label: target.label };
      case "placeholder":
        return { placeholder: target.placeholder };
      case "text":
        return { text: target.text };
      case "testId":
        return { testId: target.testId };
      case "css":
        throw new PolicyViolation("Raw CSS selectors are blocked by the action policy.");
    }
  }
}
