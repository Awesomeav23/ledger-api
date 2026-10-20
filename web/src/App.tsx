import { useEffect, useState } from "react";
import {
  api,
  errorMessage,
  formatCents,
  parseDollars,
  type Account,
  type Flag,
  type TransferResult,
} from "./api";
import "./App.css";

// A message shown under a form after an action.
type Notice = { kind: "ok" | "error" | "hold"; text: string } | null;

// Any form submit event (only preventDefault is needed).
type SubmitEvent = { preventDefault: () => void };

export default function App() {
  // null while the first load is in progress.
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  // NEW (Step 6.5): open fraud flags, loaded alongside the accounts.
  const [flags, setFlags] = useState<Flag[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Bumped after every change, so the effect below reloads everything.
  const [version, setVersion] = useState(0);
  const reload = () => setVersion((v) => v + 1);

  useEffect(() => {
    // Ignore a response that arrives after a newer reload has started.
    let cancelled = false;
    Promise.all([api.listAccounts(), api.listOpenFlags()])
      .then(([accountList, flagList]) => {
        if (!cancelled) {
          setAccounts(accountList);
          setFlags(flagList);
          setLoadError(null);
        }
      })
      .catch((err) => {
        if (!cancelled) setLoadError(errorMessage(err));
      });
    return () => {
      cancelled = true;
    };
  }, [version]);

  return (
    <div className="app">
      <header className="masthead">
        <h1>Ledger</h1>
        <p>Accounts, transfers, and held payments</p>
      </header>

      <div className="layout">
        {/* NEW (Step 6.5): the left column now holds the ledger and the review queue. */}
        <div className="stack">
          <section className="panel" aria-labelledby="accounts-heading">
            <h2 id="accounts-heading">Accounts</h2>
            {loadError ? (
              <p className="notice error">{loadError}</p>
            ) : accounts === null ? (
              <p className="empty">Loading accounts…</p>
            ) : (
              <AccountsTable accounts={accounts} />
            )}
          </section>

          <ReviewQueue flags={flags} accounts={accounts ?? []} onDone={reload} />
        </div>

        <div className="stack">
          <CreateAccountForm onDone={reload} />
          <DepositForm accounts={accounts ?? []} onDone={reload} />
          <TransferForm accounts={accounts ?? []} onDone={reload} />
        </div>
      </div>
    </div>
  );
}

// The ledger of accounts, newest first.
function AccountsTable({ accounts }: { accounts: Account[] }) {
  if (accounts.length === 0) {
    return <p className="empty">No accounts yet. Open one to get started.</p>;
  }
  return (
    <div className="table-wrap">
      <table className="ledger">
        <thead>
          <tr>
            <th scope="col">Owner</th>
            <th scope="col">Opened</th>
            <th scope="col" className="amount">
              Balance
            </th>
          </tr>
        </thead>
        <tbody>
          {accounts.map((a) => (
            <tr key={a.id}>
              <td>
                <span className="owner">{a.ownerName}</span>
                {/* The first 8 characters are enough to tell accounts apart. */}
                <span className="account-id">{a.id.slice(0, 8)}</span>
              </td>
              <td>{new Date(a.createdAt).toLocaleDateString()}</td>
              <td className="amount">{formatCents(a.balanceCents)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Creates a new account from an owner name.
function CreateAccountForm({ onDone }: { onDone: () => void }) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const account = await api.createAccount(name);
      setNotice({ kind: "ok", text: `Opened an account for ${account.ownerName}.` });
      setName("");
      onDone();
    } catch (err) {
      setNotice({ kind: "error", text: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="panel" onSubmit={submit}>
      <h2>Open an account</h2>
      <div className="field">
        <label htmlFor="owner-name">Owner name</label>
        <input
          id="owner-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={100}
          required
        />
      </div>
      <button className="button" disabled={busy}>
        Open account
      </button>
      {notice && (
        <p className={`notice ${notice.kind}`} role="status">
          {notice.text}
        </p>
      )}
    </form>
  );
}

// Deposits money into a chosen account.
function DepositForm({ accounts, onDone }: { accounts: Account[]; onDone: () => void }) {
  const [accountId, setAccountId] = useState("");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    const cents = parseDollars(amount);
    if (cents === null) {
      setNotice({ kind: "error", text: "Enter an amount like 25 or 25.50." });
      return;
    }
    setBusy(true);
    try {
      const result = await api.deposit(accountId, cents);
      const owner = accounts.find((a) => a.id === accountId)?.ownerName ?? "the account";
      setNotice({
        kind: "ok",
        text: `Added ${formatCents(cents)} to ${owner}. New balance: ${formatCents(result.balanceCents)}.`,
      });
      setAmount("");
      onDone();
    } catch (err) {
      setNotice({ kind: "error", text: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="panel" onSubmit={submit}>
      <h2>Add money</h2>
      <div className="field">
        <label htmlFor="deposit-account">Account</label>
        <select
          id="deposit-account"
          value={accountId}
          onChange={(e) => setAccountId(e.target.value)}
          required
        >
          <option value="">Choose an account</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.ownerName} ({formatCents(a.balanceCents)})
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor="deposit-amount">Amount in dollars</label>
        <input
          id="deposit-amount"
          inputMode="decimal"
          placeholder="0.00"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          required
        />
      </div>
      <button className="button" disabled={busy}>
        Add money
      </button>
      {notice && (
        <p className={`notice ${notice.kind}`} role="status">
          {notice.text}
        </p>
      )}
    </form>
  );
}

// Sends money from one account to another.
// A transfer either completes right away or is held for review by a fraud rule.
function TransferForm({ accounts, onDone }: { accounts: Account[]; onDone: () => void }) {
  const [fromId, setFromId] = useState("");
  const [toId, setToId] = useState("");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);

  const nameOf = (id: string) => accounts.find((a) => a.id === id)?.ownerName ?? "the account";

  // Describes the result in plain language for the message under the form.
  function describe(result: TransferResult): Notice {
    const what = `${formatCents(result.amountCents)} from ${nameOf(fromId)} to ${nameOf(toId)}`;
    if (result.status === "completed") {
      return { kind: "ok", text: `Sent ${what}.` };
    }
    const reasons = result.flags.map((f) => f.reason).join("; ");
    return {
      kind: "hold",
      text: `Held ${what} for review: ${reasons}. No money has moved yet.`,
    };
  }

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    const cents = parseDollars(amount);
    if (cents === null) {
      setNotice({ kind: "error", text: "Enter an amount like 25 or 25.50." });
      return;
    }
    if (fromId === toId) {
      setNotice({ kind: "error", text: "Choose two different accounts." });
      return;
    }
    setBusy(true);
    try {
      const result = await api.transfer(fromId, toId, cents);
      setNotice(describe(result));
      setAmount("");
      onDone();
    } catch (err) {
      setNotice({ kind: "error", text: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="panel" onSubmit={submit}>
      <h2>Send money</h2>
      <div className="field">
        <label htmlFor="transfer-from">From</label>
        <select id="transfer-from" value={fromId} onChange={(e) => setFromId(e.target.value)} required>
          <option value="">Choose an account</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.ownerName} ({formatCents(a.balanceCents)})
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor="transfer-to">To</label>
        <select id="transfer-to" value={toId} onChange={(e) => setToId(e.target.value)} required>
          <option value="">Choose an account</option>
          {/* The sending account can't also be the receiver. */}
          {accounts
            .filter((a) => a.id !== fromId)
            .map((a) => (
              <option key={a.id} value={a.id}>
                {a.ownerName}
              </option>
            ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor="transfer-amount">Amount in dollars</label>
        <input
          id="transfer-amount"
          inputMode="decimal"
          placeholder="0.00"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          required
        />
      </div>
      <button className="button" disabled={busy}>
        Send money
      </button>
      {notice && (
        <p className={`notice ${notice.kind}`} role="status">
          {notice.text}
        </p>
      )}
    </form>
  );
}

// NEW (Step 6.5): One held transfer, with every reason it was flagged.
type HeldTransfer = {
  flagId: string; // any one of its flags; approving or rejecting closes them all
  fromAccountId: string;
  toAccountId: string;
  amountCents: number;
  reasons: string[];
};

// NEW (Step 6.5): Combines flags into one entry per held transfer, since a
// transfer that broke two rules has two flags but needs only one decision.
function groupByTransfer(flags: Flag[]): HeldTransfer[] {
  const byTransaction = new Map<string, HeldTransfer>();
  for (const f of flags) {
    const existing = byTransaction.get(f.transactionId);
    if (existing) {
      existing.reasons.push(f.reason);
    } else {
      byTransaction.set(f.transactionId, {
        flagId: f.id,
        fromAccountId: f.fromAccountId,
        toAccountId: f.toAccountId,
        amountCents: f.amountCents,
        reasons: [f.reason],
      });
    }
  }
  return [...byTransaction.values()];
}

// NEW (Step 6.5): The list of held transfers, with Approve and Reject buttons.
function ReviewQueue({
  flags,
  accounts,
  onDone,
}: {
  flags: Flag[];
  accounts: Account[];
  onDone: () => void;
}) {
  // The flag currently being approved or rejected, so its buttons can be disabled.
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice>(null);

  const nameOf = (id: string) => accounts.find((a) => a.id === id)?.ownerName ?? "an account";
  const held = groupByTransfer(flags);

  async function decide(item: HeldTransfer, decision: "approve" | "reject") {
    setBusyId(item.flagId);
    const what = `${formatCents(item.amountCents)} from ${nameOf(item.fromAccountId)} to ${nameOf(item.toAccountId)}`;
    try {
      if (decision === "approve") {
        await api.approveFlag(item.flagId);
        setNotice({ kind: "ok", text: `Approved ${what}. The money has moved.` });
      } else {
        await api.rejectFlag(item.flagId);
        setNotice({ kind: "ok", text: `Rejected ${what}. No money moved.` });
      }
      onDone();
    } catch (err) {
      setNotice({ kind: "error", text: errorMessage(err) });
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="panel" aria-labelledby="review-heading">
      <h2 id="review-heading">Waiting for review</h2>
      {held.length === 0 ? (
        <p className="empty">No transfers waiting for review.</p>
      ) : (
        <ul className="hold-list">
          {held.map((item) => (
            <li key={item.flagId} className="hold-item">
              <div>
                <p>
                  <span className="owner">{formatCents(item.amountCents)}</span> from{" "}
                  {nameOf(item.fromAccountId)} to {nameOf(item.toAccountId)}
                </p>
                {item.reasons.map((reason) => (
                  <p key={reason} className="hold-reason">
                    {reason}
                  </p>
                ))}
              </div>
              <div className="hold-actions">
                <button
                  className="button"
                  disabled={busyId !== null}
                  onClick={() => decide(item, "approve")}
                >
                  Approve
                </button>
                <button
                  className="button quiet"
                  disabled={busyId !== null}
                  onClick={() => decide(item, "reject")}
                >
                  Reject
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {notice && (
        <p className={`notice ${notice.kind}`} role="status">
          {notice.text}
        </p>
      )}
    </section>
  );
}
