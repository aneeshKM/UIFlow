import type { Page } from "playwright";
import type { ControlOwner } from "../escalation/types.js";

export type LocatorSpec =
  | { strategy: "role"; role: Parameters<Page["getByRole"]>[0]; name?: string }
  | { strategy: "label"; label: string }
  | { strategy: "placeholder"; placeholder: string }
  | { strategy: "text"; text: string }
  | { strategy: "testId"; testId: string }
  | { strategy: "css"; selector: string };

export interface ActionResult<T = undefined> {
  success: boolean;
  action: string;
  data?: T;
  error?: {
    type: "ELEMENT_NOT_FOUND" | "ACTION_TIMEOUT" | "BROWSER_NOT_STARTED" | "CONTROL_VIOLATION" | "ACTION_FAILED";
    message: string;
    screenshotPath?: string;
  };
}

export interface ControlledSurfaceObserver {
  observe(owner?: ControlOwner): Promise<SurfaceObservation>;
  captureScreenshot(owner?: ControlOwner): Promise<Buffer>;
}

export interface SurfaceObservation {
  url: string;
  title: string;
  visibleText: string;
  ariaSnapshot: string;
  timestamp: string;
}
