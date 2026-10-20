// The only place the app talks to the ledger API.
// In development, vite.config.ts forwards /api to http://localhost:3010.
// When deployed, VITE_API_URL will point to the live API instead.
const BASE = import.meta.env.VITE_API_URL ?? "/api";

export type Account = {
  id: string;
  ownerName: string;
  currency: string;
  balanceCents: number;
  createdAt: string;
};

export type RuleFlag = { rule: string; reason: string };

export type TransferResult = {
  transactionId: string;
  amountCents: number;
  status: "completed" | "pending_review";
  flags: RuleFlag[];
  fromBalanceCents: number;
  toBalanceCents: number;
};

export type Flag = {
  id: string;
  transactionId: string;
  rule: string;
  reason: string;
  status: "open" | "approved" | "rejected";
  fromAccountId: string;
  toAccountId: string;
  amountCents: number;
  createdAt: string;
};

// An error returned by the API, e.g. status 422 with code "insufficient_funds".
export class ApiError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

// Sends a request and returns the parsed JSON, or throws an ApiError.
async function call<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...options.headers },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, body.error ?? "request_failed");
  return body as T;
}

export const api = {
  listAccounts: () => call<{ accounts: Account[] }>("/accounts").then((b) => b.accounts),

  createAccount: (ownerName: string) =>
    call<Account>("/accounts", { method: "POST", body: JSON.stringify({ ownerName }) }),

  deposit: (accountId: string, amountCents: number) =>
    call<{ balanceCents: number }>("/deposits", {
      method: "POST",
      body: JSON.stringify({ accountId, amountCents }),
    }),

  // Each transfer gets a fresh idempotency key, so a double-click or a
  // retried request can't move money twice.
  transfer: (fromAccountId: string, toAccountId: string, amountCents: number) =>
    call<TransferResult>("/transfers", {
      method: "POST",
      headers: { "Idempotency-Key": crypto.randomUUID() },
      body: JSON.stringify({ fromAccountId, toAccountId, amountCents }),
    }),

  listOpenFlags: () => call<{ flags: Flag[] }>("/flags").then((b) => b.flags),

  approveFlag: (id: string) => call<unknown>(`/flags/${id}/approve`, { method: "POST" }),

  rejectFlag: (id: string) => call<unknown>(`/flags/${id}/reject`, { method: "POST" }),
};

// Formats cents as dollars, e.g. 123456 -> "$1,234.56".
const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
export function formatCents(cents: number): string {
  return usd.format(cents / 100);
}

// Turns typed dollars into cents, e.g. "12.5" -> 1250.
// Returns null for anything that isn't a positive amount with at most 2 decimals.
export function parseDollars(input: string): number | null {
  const trimmed = input.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return null;
  const cents = Math.round(Number(trimmed) * 100);
  return cents > 0 ? cents : null;
}

// Plain-language messages for the API's error codes.
const MESSAGES: Record<string, string> = {
  validation_error: "Some values aren't valid. Check the name or amount and try again.",
  account_not_found: "That account no longer exists. Refresh and try again.",
  insufficient_funds: "The sending account doesn't have enough money for this.",
  currency_mismatch: "Both accounts must use the same currency.",
  cannot_transfer_with_system_account: "Transfers can't use the system cash account.",
  already_reviewed: "This transfer was already reviewed.",
  flag_not_found: "That flag no longer exists. Refresh and try again.",
};

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return MESSAGES[err.code] ?? `Request failed (${err.status}).`;
  // fetch throws a TypeError when it can't reach the server at all.
  return "Can't reach the ledger API. Check that it's running with npm run dev:all.";
}
