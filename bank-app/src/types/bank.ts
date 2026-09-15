export interface Account {
  id: string;
  account_number: string;
  type: string;
  available_balance: number;
  current_balance: number;
  status: string;
  last_activity: string;
  statement_preference: string;
}

export interface Member {
  id: string;
  first_name: string;
  last_name: string;

  date_of_birth: string | null;
  email: string | null;
  phone: string | null;

  status: string;

  accounts: Account[];
}

export interface MemberCreateRequest {
  first_name: string;
  last_name: string;
  date_of_birth: string;
  email: string;
  phone: string;
}

export interface AccountCreateRequest {
  type: "Savings" | "Checking" | "Money Market";
  initial_deposit: number;
  statement_preference: "Electronic" | "Paper";
}

export interface AccountPreview {
  member_id: string;
  type: string;
  initial_deposit: number;
  statement_preference: string;
  status: string;
}