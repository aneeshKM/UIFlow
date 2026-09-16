import type { SurfaceObservation } from "../browser/types.js";
import type { ApplicationState } from "./types.js";

const MEMBER_NOT_FOUND = /No member found for ID\s+([^\s.]+)/i;
const NO_ACCOUNTS_FOUND = /No accounts found for member\s+([^\s.]+)/i;
const ACCOUNT_TYPE_NOT_FOUND = /No\s+([A-Za-z][A-Za-z -]*?)\s+account found for member\s+([^\s.]+)/i;
const SESSION_EXPIRED = /Your session has expired|Please sign in again/i;
const LOADING = /\bSearching\.\.\.|\bLoading(?:\s+[A-Za-z]+)?\.\.\.|\bApplying\.\.\./i;
const APP_ERROR = /core banking system encountered an unexpected error|application error|something went wrong|unable to (?:search|load)|permission to perform this operation|unexpected error|unknown error|request failed/i;

export function classifyApplicationState(observation: SurfaceObservation): ApplicationState {
  if (observation.url.includes("/login") || SESSION_EXPIRED.test(observation.visibleText)) {
    return { kind: "session_expired", message: "The browser session has expired." };
  }

  const memberNotFound = observation.visibleText.match(MEMBER_NOT_FOUND);
  if (memberNotFound) {
    return {
      kind: "business_outcome",
      outcome: {
        code: "MEMBER_NOT_FOUND",
        details: { message: memberNotFound[0], memberId: memberNotFound[1]! },
      },
    };
  }

  const noAccounts = observation.visibleText.match(NO_ACCOUNTS_FOUND);
  if (noAccounts) {
    return {
      kind: "business_outcome",
      outcome: {
        code: "NO_ACCOUNTS_FOUND",
        details: { message: noAccounts[0], memberId: noAccounts[1]! },
      },
    };
  }

  const accountTypeNotFound = observation.visibleText.match(ACCOUNT_TYPE_NOT_FOUND);
  if (accountTypeNotFound) {
    return {
      kind: "business_outcome",
      outcome: {
        code: "ACCOUNT_TYPE_NOT_FOUND",
        details: {
          message: accountTypeNotFound[0],
          accountType: accountTypeNotFound[1]!.trim(),
          memberId: accountTypeNotFound[2]!,
        },
      },
    };
  }

  if (LOADING.test(observation.visibleText)) {
    return { kind: "loading", message: "The application is still loading." };
  }

  const appError = observation.visibleText.match(APP_ERROR);
  if (appError) return { kind: "known_app_error", message: appError[0] };
  return { kind: "normal" };
}
