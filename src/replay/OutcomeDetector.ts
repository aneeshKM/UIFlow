import type { SurfaceObservation } from "../browser/types.js";
import { classifyApplicationState } from "../outcomes/classifyApplicationState.js";
import type {
  OutcomeDetectionResult,
  ReplayBrowserActions,
  ReplaySurfaceObserver,
  RuntimeState,
} from "./types.js";

export interface OutcomeDetectorOptions {
  transientRetries?: number;
  retryDelayMs?: number;
}

export class OutcomeDetector {
  private readonly transientRetries?: number;
  private readonly retryDelayMs: number;

  constructor(
    private readonly observer: ReplaySurfaceObserver,
    private readonly actions: ReplayBrowserActions,
    options: OutcomeDetectorOptions = {},
  ) {
    this.transientRetries = options.transientRetries;
    this.retryDelayMs = options.retryDelayMs ?? 250;
    if (this.transientRetries !== undefined
      && (!Number.isInteger(this.transientRetries) || this.transientRetries < 0)) {
      throw new Error("transientRetries must be a non-negative integer.");
    }
    if (!Number.isInteger(this.retryDelayMs) || this.retryDelayMs < 1 || this.retryDelayMs > 2_000) {
      throw new Error("retryDelayMs must be an integer between 1 and 2000.");
    }
  }

  classify(observation: SurfaceObservation): RuntimeState {
    return classifyApplicationState(observation);
  }

  async detect(timeoutMs = 10_000): Promise<OutcomeDetectionResult> {
    let observation = await this.observer.observe();
    let state = this.classify(observation);
    const boundedTimeoutMs = Math.max(0, timeoutMs);
    const retryLimit = this.transientRetries
      ?? Math.ceil(boundedTimeoutMs / this.retryDelayMs);

    for (let retry = 0; state.kind === "loading" && retry < retryLimit; retry += 1) {
      const elapsedBudgetMs = retry * this.retryDelayMs;
      const remainingMs = Math.max(0, boundedTimeoutMs - elapsedBudgetMs);
      const wait = await this.actions.wait(Math.min(this.retryDelayMs, remainingMs));
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
      case "business_outcome":
        return {
          status: "business_outcome",
          code: state.outcome.code,
          ...(state.outcome.details === undefined ? {} : { details: state.outcome.details }),
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
          message: `The application remained in a transient loading state for ${boundedTimeoutMs}ms.`,
        };
    }
  }
}
