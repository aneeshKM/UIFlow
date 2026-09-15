import type { BrowserSession } from "./BrowserSession.js";
import type { SurfaceObservation } from "./types.js";

export class SurfaceObserver {
  constructor(private readonly session: BrowserSession) {}

  async observe(): Promise<SurfaceObservation> {
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

  async captureScreenshot(): Promise<Buffer> {
    return this.session.getPage().screenshot();
  }
}
