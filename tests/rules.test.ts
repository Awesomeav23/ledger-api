import { describe, it, expect } from "vitest";
import { evaluateRules, TransferContext } from "../src/fraud/rules";

// A fixed "now", so the account-age math is the same on every run.
const NOW = new Date("2026-01-15T12:00:00Z");
const HOUR = 3_600_000;

// A transfer that passes every rule: a $10 transfer from a $1,000 balance,
// out of a week-old account, with no other recent transfers.
// Each test changes only the field it cares about.
function ctx(overrides: Partial<TransferContext> = {}): TransferContext {
  return {
    amountCents: 1_000,
    fromBalanceCents: 100_000,
    fromAccountCreatedAt: new Date(NOW.getTime() - 7 * 24 * HOUR),
    recentTransferCount: 0,
    now: NOW,
    ...overrides,
  };
}

// Returns just the names of the rules that fired, for easy comparison.
function firedRules(c: TransferContext): string[] {
  return evaluateRules(c).map((f) => f.rule);
}

describe("fraud rules", () => {
  it("passes an ordinary transfer", () => {
    expect(firedRules(ctx())).toEqual([]);
  });

  describe("new_account_large_transfer", () => {
    it("flags $500+ from an account under 24 hours old", () => {
      const c = ctx({
        amountCents: 60_000,
        fromBalanceCents: 100_000,
        fromAccountCreatedAt: new Date(NOW.getTime() - 1 * HOUR),
      });
      expect(firedRules(c)).toEqual(["new_account_large_transfer"]);
    });

    it("does not flag the same amount from an older account", () => {
      const c = ctx({ amountCents: 60_000, fromBalanceCents: 100_000 });
      expect(firedRules(c)).toEqual([]);
    });

    it("does not flag a small transfer from a new account", () => {
      const c = ctx({ fromAccountCreatedAt: new Date(NOW.getTime() - 1 * HOUR) });
      expect(firedRules(c)).toEqual([]);
    });
  });

  describe("high_velocity", () => {
    it("flags the 6th transfer within a minute", () => {
      expect(firedRules(ctx({ recentTransferCount: 5 }))).toEqual(["high_velocity"]);
    });

    it("does not flag the 5th transfer within a minute", () => {
      expect(firedRules(ctx({ recentTransferCount: 4 }))).toEqual([]);
    });
  });

  describe("drains_balance", () => {
    it("flags a transfer of more than 90% of the balance", () => {
      expect(firedRules(ctx({ amountCents: 9_100, fromBalanceCents: 10_000 }))).toEqual([
        "drains_balance",
      ]);
    });

    it("does not flag a transfer of exactly 90%", () => {
      expect(firedRules(ctx({ amountCents: 9_000, fromBalanceCents: 10_000 }))).toEqual([]);
    });
  });

  it("reports every rule that fires on the same transfer", () => {
    const c = ctx({
      amountCents: 60_000,
      fromBalanceCents: 60_000,
      fromAccountCreatedAt: new Date(NOW.getTime() - 1 * HOUR),
      recentTransferCount: 5,
    });
    expect(firedRules(c)).toEqual([
      "new_account_large_transfer",
      "high_velocity",
      "drains_balance",
    ]);
  });

  it("includes a readable reason with each flag", () => {
    const [flag] = evaluateRules(ctx({ amountCents: 9_500, fromBalanceCents: 10_000 }));
    expect(flag.reason).toBe("$95.00 out of a $100.00 balance");
  });
});
