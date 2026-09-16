export const BUSINESS_OUTCOME_CODES = [
  "MEMBER_NOT_FOUND",
  "NO_ACCOUNTS_FOUND",
  "ACCOUNT_TYPE_NOT_FOUND",
] as const;

export type BusinessOutcomeCode = typeof BUSINESS_OUTCOME_CODES[number];

export interface BusinessOutcome {
  code: BusinessOutcomeCode;
  details?: Record<string, string>;
}

export type ApplicationState =
  | { kind: "normal" }
  | { kind: "business_outcome"; outcome: BusinessOutcome }
  | { kind: "session_expired"; message: string }
  | { kind: "known_app_error"; message: string }
  | { kind: "loading"; message: string };
