import { join } from "node:path";
import { BrowserActions } from "../src/browser/BrowserActions.js";
import { BrowserSession } from "../src/browser/BrowserSession.js";
import { LocatorResolver } from "../src/browser/LocatorResolver.js";
import { SurfaceObserver } from "../src/browser/SurfaceObserver.js";
import type { ActionResult } from "../src/browser/types.js";
import { readConfig } from "../src/config.js";

function requireSuccess<T>(result: ActionResult<T>): T {
  if (!result.success) {
    throw new Error(`${result.action} failed: ${result.error?.type}: ${result.error?.message}`);
  }
  return result.data as T;
}

async function main(): Promise<void> {
  const config = readConfig();
  const session = new BrowserSession(config.headless);
  const actions = new BrowserActions(session, new LocatorResolver());
  const observer = new SurfaceObserver(session);
  let tracing = false;

  try {
    await session.start();
    await session.startTrace();
    tracing = true;

    requireSuccess(await actions.navigate(new URL("/login", config.bankAppUrl).toString()));
    const login = await observer.observe();
    console.log(`URL: ${login.url}\nTitle: ${login.title}\nVisible text:\n${login.visibleText}\nARIA:\n${login.ariaSnapshot}`);

    requireSuccess(await actions.fill({ strategy: "label", label: "Employee ID" }, "browser-smoke"));
    requireSuccess(await actions.fill({ strategy: "label", label: "Password" }, "browser-smoke"));
    requireSuccess(await actions.click({ strategy: "role", role: "button", name: "Sign In" }));
    requireSuccess(await actions.click({ strategy: "role", role: "link", name: "Members" }));
    requireSuccess(await actions.waitFor({ strategy: "role", role: "heading", name: "Member Search" }));

    const search = await observer.observe();
    console.log(`Search URL: ${search.url}\nSearch ARIA:\n${search.ariaSnapshot}`);
    requireSuccess(await actions.fill({ strategy: "label", label: "Member Number" }, "12345"));
    requireSuccess(await actions.click({ strategy: "role", role: "button", name: "Search" }));
    requireSuccess(await actions.waitFor({ strategy: "role", role: "row", name: "John Smith" }));
    requireSuccess(await actions.click({ strategy: "role", role: "button", name: "View" }));
    requireSuccess(await actions.waitFor({ strategy: "role", role: "heading", name: "Member Information" }));

    const savingsRow = requireSuccess(await actions.readText({ strategy: "role", role: "row", name: "Savings" }));
    const balance = savingsRow.match(/\$\s*[\d,]+\.\d{2}/)?.[0];
    if (!balance) throw new Error(`Could not read the savings balance from: ${savingsRow}`);
    const details = await observer.observe();
    console.log(`Details URL: ${details.url}\nSavings available balance: ${balance}\nDetails ARIA:\n${details.ariaSnapshot}`);

    const screenshot = join("evidence", "screenshots", "smoke-success.png");
    const trace = join("evidence", "traces", "smoke-success.zip");
    requireSuccess(await actions.screenshot(screenshot));
    await session.stopTrace(trace);
    tracing = false;
    console.log(`Screenshot: ${screenshot}\nTrace: ${trace}`);
  } catch (error) {
    console.error(error);
    if (tracing) {
      try {
        await session.stopTrace(join("evidence", "traces", "smoke-failure.zip"));
      } catch (traceError) {
        console.error("Could not save failure trace:", traceError);
      }
    }
    process.exitCode = 1;
  } finally {
    await session.close();
  }
}

await main();
