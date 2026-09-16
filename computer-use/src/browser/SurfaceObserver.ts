import type { BrowserSession } from "./BrowserSession.js";
import type { SurfaceObservation } from "./types.js";
import type { SessionControl } from "../escalation/SessionControl.js";
import type { ControlOwner } from "../escalation/types.js";

export class SurfaceObserver {
  constructor(
    private readonly session: BrowserSession,
    private readonly sessionControl?: SessionControl,
  ) {}

  async observe(owner: ControlOwner = "AUTOMATION"): Promise<SurfaceObservation> {
    this.sessionControl?.assertOwner(owner);
    const page = this.session.getPage();
    const body = page.locator("body");
    const [title, visibleText, ariaSnapshot] = await Promise.all([
      page.title(),
      body.innerText(),
      body.ariaSnapshot(),
    ]);
    return {
      url: page.url(),
      title,
      visibleText,
      ariaSnapshot,
      timestamp: new Date().toISOString(),
    };
  }

  async captureScreenshot(owner: ControlOwner = "AUTOMATION"): Promise<Buffer> {
    this.sessionControl?.assertOwner(owner);
    return this.session.getPage().screenshot();
  }
}
