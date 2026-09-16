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
    return classifyApplicationState(observation);
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
          message: "The application remained in a transient loading state after one retry.",
        };
    }
  }
}
