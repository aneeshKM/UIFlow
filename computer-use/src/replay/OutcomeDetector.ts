import type { SurfaceObservation } from "../browser/types.js";
import type {
  OutcomeDetectionResult,
  ReplayBrowserActions,
  ReplaySurfaceObserver,
  RuntimeState,
} from "./types.js";

const MEMBER_NOT_FOUND = /No member found for ID\s+([^\s]+)/i;
const SESSION_EXPIRED = /Your session has expired|Please sign in again/i;
const LOADING = /\bSearching\.\.\.|\bLoading(?:\s+[A-Za-z]+)?\.\.\.|\bApplying\.\.\./i;
const APP_ERROR = /core banking system encountered an unexpected error|application error|something went wrong|unable to (?:search|load)|permission to perform this operation|unexpected error|unknown error|request failed/i;

export interface OutcomeDetectorOptions {
  transientRetries?: number;
  retryDelayMs?: number;
}

export class OutcomeDetector {
  private readonly transientRetries: number;
  private readonly retryDelayMs: number;

  constructor(
    private readonly observer: ReplaySurfaceObserver,
    private readonly actions: ReplayBrowserActions,
    options: OutcomeDetectorOptions = {},
  ) {
    this.transientRetries = options.transientRetries ?? 1;
    this.retryDelayMs = options.retryDelayMs ?? 500;
  }

  classify(observation: SurfaceObservation): RuntimeState {
    if (observation.url.includes("/login") || SESSION_EXPIRED.test(observation.visibleText)) {
      return { kind: "session_expired", message: "The browser session has expired." };
    }

    const memberNotFound = observation.visibleText.match(MEMBER_NOT_FOUND);
    if (memberNotFound) {
      return { kind: "member_not_found", message: memberNotFound[0] };
    }

    if (LOADING.test(observation.visibleText)) {
      return { kind: "loading", message: "The application is still loading." };
    }

    const appError = observation.visibleText.match(APP_ERROR);
    if (appError) return { kind: "known_app_error", message: appError[0] };
    return { kind: "normal" };
  }

  async detect(): Promise<OutcomeDetectionResult> {
    let observation = await this.observer.observe();
    let state = this.classify(observation);

    for (let retry = 0; state.kind === "loading" && retry < this.transientRetries; retry += 1) {
      const wait = await this.actions.wait(this.retryDelayMs);
      if (!wait.success) {
        return {
          status: "failure",
          code: "ACTION_FAILED",
          observed: state,
          message: wait.error?.message ?? "Could not wait for the transient application state.",
        };
      }
      observation = await this.observer.observe();
      state = this.classify(observation);
    }

    switch (state.kind) {
      case "normal":
        return { status: "normal" };
      case "member_not_found":
        return {
          status: "business_outcome",
          code: "MEMBER_NOT_FOUND",
          details: { message: state.message },
        };
      case "session_expired":
        return {
          status: "failure",
          code: "SESSION_EXPIRED",
          observed: { url: observation.url, message: state.message },
          message: state.message,
        };
      case "known_app_error":
        return {
          status: "failure",
          code: "UNEXPECTED_STATE",
          observed: { url: observation.url, message: state.message },
          message: state.message,
        };
      case "loading":
        return {
          status: "failure",
          code: "TIMEOUT",
          expected: "settled application state",
          observed: { url: observation.url, message: state.message },
          message: "The application remained in a transient loading state after one retry.",
        };
    }
  }
}
