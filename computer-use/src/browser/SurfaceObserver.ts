import type { BrowserSession } from "./BrowserSession.js";
import type { SurfaceObservation } from "./types.js";
import type { SessionControl } from "../escalation/SessionControl.js";
import type { ControlOwner } from "../escalation/types.js";
import type { ActionPolicy } from "../policy/ActionPolicy.js";

export class SurfaceObserver {
  constructor(
    private readonly session: BrowserSession,
    private readonly policy: ActionPolicy,
    private readonly sessionControl?: SessionControl,
  ) {}

  async observe(owner: ControlOwner = "AUTOMATION"): Promise<SurfaceObservation> {
    this.sessionControl?.assertOwner(owner);
    const page = this.session.getPage();
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const urlBefore = page.url();
      this.policy.assertAllowed({ action: "observe", owner, currentUrl: urlBefore });
      const body = page.locator("body");
      const [title, visibleText, ariaSnapshot] = await Promise.all([
        page.title(),
        body.innerText(),
        body.ariaSnapshot(),
      ]);
      const urlAfter = page.url();
      if (urlBefore === urlAfter) {
        return {
          url: urlAfter,
          title,
          visibleText,
          ariaSnapshot,
          timestamp: new Date().toISOString(),
        };
      }
      await page.waitForTimeout(50);
    }
    throw new Error("The application URL changed repeatedly while capturing the observable UI.");
  }

  async captureScreenshot(owner: ControlOwner = "AUTOMATION"): Promise<Buffer> {
    this.sessionControl?.assertOwner(owner);
    const page = this.session.getPage();
    this.policy.assertAllowed({ action: "observe", owner, currentUrl: page.url() });
    return page.screenshot();
  }
}
