import { access } from "node:fs/promises";
import { test, expect } from "@playwright/test";
import { BrowserActions } from "../src/browser/BrowserActions.js";
import { BrowserSession } from "../src/browser/BrowserSession.js";
import { LocatorResolver } from "../src/browser/LocatorResolver.js";
import { SurfaceObserver } from "../src/browser/SurfaceObserver.js";
import { readConfig } from "../src/config.js";

const config = readConfig();
let session: BrowserSession;
let actions: BrowserActions;
let observer: SurfaceObserver;

test.beforeAll(async () => {
  for (const url of [config.bankAppUrl, new URL("/api/health", config.bankApiUrl).toString()]) {
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
    } catch (error) {
      throw new Error(`Bank App service is unavailable at ${url}. Start the frontend and backend first.`, { cause: error });
    }
  }
});

test.beforeEach(async () => {
  session = new BrowserSession(true);
  await session.start();
  actions = new BrowserActions(session, new LocatorResolver());
  observer = new SurfaceObserver(session);
});

test.afterEach(async () => {
  await session?.close();
});

async function openSearch(): Promise<void> {
  expect((await actions.navigate(new URL("/login", config.bankAppUrl).toString())).success).toBe(true);
  expect((await actions.fill({ strategy: "label", label: "Employee ID" }, "browser-test")).success).toBe(true);
  expect((await actions.fill({ strategy: "label", label: "Password" }, "browser-test")).success).toBe(true);
  expect((await actions.click({ strategy: "role", role: "button", name: "Sign In" })).success).toBe(true);
  expect((await actions.click({ strategy: "role", role: "link", name: "Members" })).success).toBe(true);
  expect((await actions.waitFor({ strategy: "role", role: "heading", name: "Member Search" })).success).toBe(true);
}

test("keeps a live session and observes the search surface", async () => {
  await openSearch();
  const observation = await observer.observe();
  expect(observation.url).toContain("/members");
  expect(observation.title).toBe("bank-app");
  expect(observation.visibleText).toContain("Member Search");
  expect(observation.ariaSnapshot).toContain("Member Number");
  expect(observation.timestamp).toBeTruthy();
  expect((await observer.captureScreenshot()).length).toBeGreaterThan(0);
});

test("uses semantic locators to find member 12345 and read savings balance", async () => {
  await openSearch();
  const memberNumber = { strategy: "label", label: "Member Number" } as const;
  expect((await actions.fill(memberNumber, "12345")).success).toBe(true);
  expect((await actions.getValue(memberNumber)).data).toBe("12345");
  expect((await actions.click({ strategy: "role", role: "button", name: "Search" })).success).toBe(true);
  expect((await actions.waitFor({ strategy: "role", role: "row", name: "John Smith" })).success).toBe(true);
  expect((await actions.click({ strategy: "role", role: "button", name: "View" })).success).toBe(true);
  expect((await actions.waitFor({ strategy: "role", role: "heading", name: "Member Information" })).success).toBe(true);
  const savings = await actions.readText({ strategy: "role", role: "row", name: "Savings" });
  expect(savings.success).toBe(true);
  expect(savings.data).toContain("$4,281.50");
});

test("sees the member-not-found state for an unknown ID", async () => {
  await openSearch();
  expect((await actions.fill({ strategy: "label", label: "Member Number" }, "99999")).success).toBe(true);
  expect((await actions.press({ strategy: "label", label: "Member Number" }, "Enter")).success).toBe(true);
  const missing = { strategy: "text", text: "No member found for ID 99999" } as const;
  expect((await actions.waitFor(missing)).success).toBe(true);
  expect((await actions.isVisible(missing)).data).toBe(true);
  expect((await actions.isVisible({ strategy: "text", text: "No member found for ID 12345" })).data).toBe(false);
});

test("returns typed failure evidence when a control is missing", async () => {
  await openSearch();
  session.getPage().setDefaultTimeout(1_000);
  const result = await actions.click({ strategy: "role", role: "button", name: "No such control" });
  expect(result.success).toBe(false);
  expect(result.error?.type).toBe("ELEMENT_NOT_FOUND");
  expect(result.error?.screenshotPath).toBeTruthy();
  await access(result.error!.screenshotPath!);
});
