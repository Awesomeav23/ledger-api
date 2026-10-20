// Everything a rule needs to know about a transfer. The transfers route
// gathers these values (while the accounts are locked) before any rule runs.
export type TransferContext = {
  amountCents: number;
  fromBalanceCents: number;
  fromAccountCreatedAt: Date;
  // Completed or pending transfers from this account in the last minute,
  // not counting the current one.
  recentTransferCount: number;
  now: Date;
};

// What a rule returns when it flags a transfer.
export type RuleResult = { rule: string; reason: string };

// A rule checks a transfer and returns a flag, or null if the transfer passes.
type Rule = (ctx: TransferContext) => RuleResult | null;

// Thresholds, kept in one place so they're easy to change.
export const LARGE_TRANSFER_CENTS = 50_000; // $500
export const NEW_ACCOUNT_HOURS = 24;
export const MAX_TRANSFERS_PER_MINUTE = 5;
export const DRAIN_RATIO = 0.9; // 90% of the balance

// Formats cents as dollars for readable reasons, e.g. 50000 -> "$500.00".
function dollars(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

// Rule 1: a large transfer from an account created less than 24 hours ago.
const newAccountLargeTransfer: Rule = (ctx) => {
  const ageHours = (ctx.now.getTime() - ctx.fromAccountCreatedAt.getTime()) / 3_600_000;
  if (ageHours < NEW_ACCOUNT_HOURS && ctx.amountCents >= LARGE_TRANSFER_CENTS) {
    return {
      rule: "new_account_large_transfer",
      reason: `${dollars(ctx.amountCents)} from an account ${ageHours.toFixed(1)} hours old`,
    };
  }
  return null;
};

// Rule 2: more than 5 transfers from one account within one minute.
// recentTransferCount doesn't include this transfer, so 5 earlier ones
// means this is the 6th.
const highVelocity: Rule = (ctx) => {
  if (ctx.recentTransferCount >= MAX_TRANSFERS_PER_MINUTE) {
    return {
      rule: "high_velocity",
      reason: `${ctx.recentTransferCount + 1} transfers from this account within one minute`,
    };
  }
  return null;
};

// Rule 3: a transfer that moves more than 90% of the account's balance.
const drainsBalance: Rule = (ctx) => {
  if (ctx.amountCents > ctx.fromBalanceCents * DRAIN_RATIO) {
    return {
      rule: "drains_balance",
      reason: `${dollars(ctx.amountCents)} out of a ${dollars(ctx.fromBalanceCents)} balance`,
    };
  }
  return null;
};

// All active rules. To add a rule, write a function like the ones above
// and add it to this list.
const rules: Rule[] = [newAccountLargeTransfer, highVelocity, drainsBalance];

// Runs every rule and returns the ones that flagged the transfer.
// An empty list means the transfer passed all rules.
export function evaluateRules(ctx: TransferContext): RuleResult[] {
  return rules.map((rule) => rule(ctx)).filter((r): r is RuleResult => r !== null);
}
