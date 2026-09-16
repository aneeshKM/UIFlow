import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { BrowserActions } from "../src/browser/BrowserActions.js";
import type { BrowserSession } from "../src/browser/BrowserSession.js";
import type { LocatorResolver } from "../src/browser/LocatorResolver.js";
import { EvidenceWriter } from "../src/evidence/EvidenceWriter.js";
import { redactObservation, redactValue } from "../src/evidence/Redactor.js";
import { SessionControl } from "../src/escalation/SessionControl.js";
import { ActionPolicy } from "../src/policy/ActionPolicy.js";
import type { PolicyRequest } from "../src/policy/types.js";

interface BrowserHarness {
  actions: BrowserActions;
  control: SessionControl;
  clicks: () => number;
  navigations: () => number;
}

function browserHarness(redirectTo?: string): BrowserHarness {
  let url = "http://localhost:5174/members";
  let clicks = 0;
  let navigations = 0;
  const page = {
    url: () => url,
    screenshot: async () => Buffer.from("png"),
  };
  const session = {
    getPage: () => page,
    async navigate(destination: string) {
      navigations += 1;
      url = redirectTo ?? destination;
    },
  } as unknown as BrowserSession;
  const resolver = {
    resolve() {
      return {
        async click() { clicks += 1; },
      };
    },
  } as unknown as LocatorResolver;
  const control = new SessionControl();
  const policy = new ActionPolicy("http://localhost:5174", ["/login", "/members"]);
  return {
    actions: new BrowserActions(session, resolver, policy, control),
    control,
    clicks: () => clicks,
    navigations: () => navigations,
  };
}

test("central policy allowlists actions, origins, and routes", () => {
  const policy = new ActionPolicy("http://localhost:5174", ["/login", "/members"]);

  expect(policy.evaluate({
    action: "click",
    currentUrl: "http://localhost:5174/members",
    target: { role: "button", name: "Search" },
  })).toEqual({ allowed: true, risk: "SAFE" });
  expect(policy.evaluate({
    action: "navigate",
    currentUrl: "http://localhost:5174/members",
    destination: "https://example.com/collect",
  })).toMatchObject({ allowed: false, risk: "BLOCKED" });
  expect(policy.evaluate({
    action: "navigate",
    currentUrl: "http://localhost:5174/members",
    destination: "http://localhost:5174/admin",
  })).toMatchObject({ allowed: false, risk: "BLOCKED", reason: /route/i });
  expect(policy.evaluate({
    action: "execute_javascript",
  } as unknown as PolicyRequest)).toMatchObject({ allowed: false, risk: "BLOCKED", reason: /unsupported/i });
});

test("automation escalates review actions while blocked actions never execute", async () => {
  const harness = browserHarness();

  const review = await harness.actions.click({ strategy: "role", role: "button", name: "Create account" });
  const blocked = await harness.actions.click({ strategy: "role", role: "button", name: "Transfer funds" });

  expect(review).toMatchObject({ success: false, error: { type: "POLICY_REQUIRES_HUMAN" } });
  expect(blocked).toMatchObject({ success: false, error: { type: "POLICY_BLOCKED" } });
  expect(harness.clicks()).toBe(0);
});

test("a human can perform review actions but remains unable to perform blocked actions", async () => {
  const harness = browserHarness();
  harness.control.giveToHuman();

  const review = await harness.actions.click(
    { strategy: "role", role: "button", name: "Create account" },
    undefined,
    "HUMAN",
  );
  const blocked = await harness.actions.click(
    { strategy: "role", role: "button", name: "Transfer funds" },
    undefined,
    "HUMAN",
  );

  expect(review.success).toBe(true);
  expect(blocked).toMatchObject({ success: false, error: { type: "POLICY_BLOCKED" } });
  expect(harness.clicks()).toBe(1);
});

test("navigation checks the requested URL and the URL after redirects", async () => {
  const requestBlocked = browserHarness();
  const external = await requestBlocked.actions.navigate("https://example.com/collect");
  expect(external).toMatchObject({ success: false, error: { type: "POLICY_BLOCKED" } });
  expect(requestBlocked.navigations()).toBe(0);

  const redirected = browserHarness("https://example.com/redirected");
  const result = await redirected.actions.navigate("http://localhost:5174/members");
  expect(result).toMatchObject({ success: false, error: { type: "POLICY_BLOCKED" } });
  expect(redirected.navigations()).toBe(1);
});

test("redactor removes nested credentials, tokens, cookies, and common PII", () => {
  const fakeApiKey = `s${"k"}-${"abcdefghijklmnop"}`;
  const redacted = redactValue({
    password: "bank-password",
    nested: {
      accessToken: "token-value",
      authorization: "Bearer abc.def.ghi",
      cookie: "session=secret",
      message: `key ${fakeApiKey} for person@example.com and SSN 123-45-6789`,
    },
  });
  const serialized = JSON.stringify(redacted);

  for (const secret of [
    "bank-password",
    "token-value",
    "abc.def.ghi",
    "session=secret",
    fakeApiKey,
    "person@example.com",
    "123-45-6789",
  ]) {
    expect(serialized).not.toContain(secret);
  }
  expect(redactObservation('- textbox "Member Number": "12345"')).toContain('"[REDACTED]"');
});

test("EvidenceWriter sanitizes before JSON reaches disk", async () => {
  const directory = await mkdtemp(join(tmpdir(), "evidence-writer-test-"));
  const path = join(directory, "nested", "evidence.json");
  const fakeApiKey = `s${"k"}-${"abcdefghijklmnop"}`;
  try {
    await new EvidenceWriter().writeJson(path, {
      apiKey: fakeApiKey,
      nested: { clientSecret: "raw-client-secret", cookie: "session=raw-cookie" },
    });
    const persisted = await readFile(path, "utf8");
    expect(persisted).not.toContain(fakeApiKey);
    expect(persisted).not.toContain("raw-client-secret");
    expect(persisted).not.toContain("raw-cookie");
    expect(persisted).toContain("[REDACTED]");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
