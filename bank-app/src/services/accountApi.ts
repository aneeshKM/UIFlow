import { API_BASE_URL, handleResponse } from "./api";

import type {
  Account,
  AccountCreateRequest,
  AccountPreview,
} from "../types/bank";

export async function getAccount(
  memberId: string,
  accountId: string,
): Promise<Account> {
  const response = await fetch(
    `${API_BASE_URL}/api/members/${encodeURIComponent(
      memberId,
    )}/accounts/${encodeURIComponent(accountId)}`,
  );

  return handleResponse<Account>(response);
}

export async function previewAccount(
  memberId: string,
  data: AccountCreateRequest,
): Promise<AccountPreview> {
  const response = await fetch(
    `${API_BASE_URL}/api/members/${encodeURIComponent(
      memberId,
    )}/accounts/preview`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(data),
    },
  );

  return handleResponse<AccountPreview>(response);
}

export async function createAccount(
  memberId: string,
  data: AccountCreateRequest,
): Promise<Account> {
  const response = await fetch(
    `${API_BASE_URL}/api/members/${encodeURIComponent(
      memberId,
    )}/accounts`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(data),
    },
  );

  return handleResponse<Account>(response);
}