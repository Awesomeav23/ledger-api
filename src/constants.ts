// ID of the system cash account, created in migration 005.
// Deposits debit this account, so its balance is negative by the total
// amount of money that has entered the ledger.
export const SYSTEM_CASH_ACCOUNT_ID = "00000000-0000-4000-8000-000000000001";
