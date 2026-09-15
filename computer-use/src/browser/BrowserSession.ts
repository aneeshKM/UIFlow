import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";

export class BrowserSession {
  private browser?: Browser;
  private context?: BrowserContext;
  private page?: Page;
  private tracing = false;

  constructor(private readonly headless = false) {}

  async start(): Promise<void> {
    if (this.browser) throw new Error("Browser session is already running.");
    this.browser = await chromium.launch({ headless: this.headless });
    try {
      this.context = await this.browser.newContext();
      this.page = await this.context.newPage();
    } catch (error) {
      await this.close();
      throw error;
    }
  }

  getPage(): Page {
    if (!this.page) throw new Error("Browser session has not started.");
    return this.page;
  }

  async navigate(url: string): Promise<void> {
    await this.getPage().goto(url, { waitUntil: "domcontentloaded" });
  }

  async startTrace(): Promise<void> {
    if (!this.context) throw new Error("Browser session has not started.");
    if (this.tracing) throw new Error("Trace is already running.");
    await this.context.tracing.start({ screenshots: true, snapshots: true });
    this.tracing = true;
  }

  async stopTrace(path: string): Promise<void> {
    if (!this.context || !this.tracing) throw new Error("No trace is running.");
    await mkdir(dirname(path), { recursive: true });
    await this.context.tracing.stop({ path });
    this.tracing = false;
  }

  async close(): Promise<void> {
    const context = this.context;
    const browser = this.browser;
    this.page = undefined;
    this.context = undefined;
    this.browser = undefined;
    this.tracing = false;
    try {
      await context?.close();
    } finally {
      await browser?.close();
    }
  }
}
