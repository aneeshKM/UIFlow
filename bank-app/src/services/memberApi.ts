import {
  API_BASE_URL,
  handleResponse,
} from "./api";

import type {
  Member,
  MemberCreateRequest,
} from "../types/bank";


export async function getMember(
  memberId: string,
): Promise<Member> {
  const response = await fetch(
    `${API_BASE_URL}/api/members/${encodeURIComponent(
      memberId,
    )}`,
  );

  return handleResponse<Member>(response);
}


export async function createMember(
  data: MemberCreateRequest,
): Promise<Member> {
  const response = await fetch(
    `${API_BASE_URL}/api/members`,
    {
      method: "POST",

      headers: {
        "Content-Type": "application/json",
      },

      body: JSON.stringify(data),
    },
  );

  return handleResponse<Member>(response);
}