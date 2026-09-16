import { expect, test } from "@playwright/test";
import type { ActionResult, SurfaceObservation } from "../src/browser/types.js";
import { OutcomeDetector } from "../src/replay/OutcomeDetector.js";
import type { ReplayBrowserActions, ReplaySurfaceObserver } from "../src/replay/types.js";

function observation(visibleText: string, url = "http://localhost:5174/members"): SurfaceObservation {
  return {
    url,
    title: "bank-app",
    visibleText,
    ariaSnapshot: visibleText,
    timestamp: "2026-09-15T12:00:00.000Z",
  };
}

class SequenceObserver implements ReplaySurfaceObserver {
  calls = 0;

  constructor(private readonly observations: SurfaceObservation[]) {}

  async observe(): Promise<SurfaceObservation> {
    const value = this.observations[Math.min(this.calls, this.observations.length - 1)];
    this.calls += 1;
    if (!value) throw new Error("No observation configured.");
    return value;
  }
}

function actions(): ReplayBrowserActions & { waits: number } {
  return {
    waits: 0,
    async navigate() { return { success: true, action: "navigate" }; },
    async click() { return { success: true, action: "click" }; },
    async fill() { return { success: true, action: "fill" }; },
    async readText() { return { success: true, action: "readText", data: "" }; },
    async waitFor() { return { success: true, action: "waitFor" }; },
    async isVisible() { return { success: true, action: "isVisible", data: true }; },
    async wait(): Promise<ActionResult> {
      this.waits += 1;
      return { success: true, action: "wait" };
    },
  };
}

test("maps member not found to a business outcome", async () => {
  const detector = new OutcomeDetector(
    new SequenceObserver([observation("No member found for ID 99999")]),
    actions(),
  );

  await expect(detector.detect()).resolves.toEqual({
    status: "business_outcome",
    code: "MEMBER_NOT_FOUND",
    details: { message: "No member found for ID 99999", memberId: "99999" },
  });
});

test("maps an empty account collection to a business outcome", async () => {
  const detector = new OutcomeDetector(
    new SequenceObserver([observation("Accounts No accounts found for member 23458.")]),
    actions(),
  );

  await expect(detector.detect()).resolves.toEqual({
    status: "business_outcome",
    code: "NO_ACCOUNTS_FOUND",
    details: {
      message: "No accounts found for member 23458",
      memberId: "23458",
    },
  });
});

test("maps a missing requested account type to a business outcome", async () => {
  const detector = new OutcomeDetector(
    new SequenceObserver([observation("No Savings account found for member 12345.")]),
    actions(),
  );

  await expect(detector.detect()).resolves.toMatchObject({
    status: "business_outcome",
    code: "ACCOUNT_TYPE_NOT_FOUND",
    details: { accountType: "Savings", memberId: "12345" },
  });
});

test("maps an expired session to SESSION_EXPIRED", async () => {
  const detector = new OutcomeDetector(
    new SequenceObserver([observation(
      "Your session has expired. Please sign in again.",
      "http://localhost:5174/login?reason=session-expired",
    )]),
    actions(),
  );

  await expect(detector.detect()).resolves.toMatchObject({
    status: "failure",
    code: "SESSION_EXPIRED",
  });
});

test("waits once for a temporary loading state and then continues", async () => {
  const browserActions = actions();
  const observer = new SequenceObserver([
    observation("Searching..."),
    observation("Search Results John Smith View"),
  ]);
  const detector = new OutcomeDetector(observer, browserActions, { retryDelayMs: 1 });

  await expect(detector.detect()).resolves.toEqual({ status: "normal" });
  expect(browserActions.waits).toBe(1);
  expect(observer.calls).toBe(2);
});

test("returns TIMEOUT when loading remains transient after the bounded retry", async () => {
  const detector = new OutcomeDetector(
    new SequenceObserver([observation("Searching...")]),
    actions(),
    { retryDelayMs: 1 },
  );

  await expect(detector.detect()).resolves.toMatchObject({ status: "failure", code: "TIMEOUT" });
});

test("maps an unknown application error to UNEXPECTED_STATE", async () => {
  const detector = new OutcomeDetector(
    new SequenceObserver([observation("Unknown error")]),
    actions(),
  );

  await expect(detector.detect()).resolves.toMatchObject({
    status: "failure",
    code: "UNEXPECTED_STATE",
  });
});
