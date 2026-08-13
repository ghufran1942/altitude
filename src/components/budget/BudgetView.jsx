import React, { useState, useEffect, useCallback, useMemo } from "react";
import { Modal } from "../Modal.jsx";
import { money, moneySigned } from "../../lib/budget/money.js";
import {
  currentMonth, shiftMonth, monthLabel, monthSummary, envelopeSpending,
  accountBalances, netWorth, indexMonthlyTotals, baselineFor, startingAdjustment,
} from "../../lib/budget/budget.js";
import * as cloudStore from "../../lib/budget/budgetStore.js";
import * as localStore from "../../lib/budget/localBudgetStore.js";
import { TransactionForm, AccountManager, EnvelopeManager, smallBtn } from "./BudgetForms.jsx";
import { CsvImport } from "./CsvImport.jsx";
import { PaycheckManager } from "./PaycheckForm.jsx";
import { candidateDates, hashesFor, duePayDates, paycheckRows } from "../../lib/budget/paycheck.js";
import { todayKey } from "../../lib/dates.js";

export function BudgetView({ C, font, display, userId, isPhone, isNarrow, onToast }) {
  const [month, setMonth] = useState(currentMonth());
  const [accounts, setAccounts] = useState([]);
  const [envelopes, setEnvelopes] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [totals, setTotals] = useState([]);
  const [acctTotals, setAcctTotals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [modal, setModal] = useState(null);          // add | edit | accounts | envelopes | import
  const [editing, setEditing] = useState(null);
  const [filterEnvelope, setFilterEnvelope] = useState("");
  const [paycheck, setPaycheck] = useState(null);
  const [duePay, setDuePay] = useState([]);
  const [openings, setOpenings] = useState(new Map());

  /* Signed out there are no cloud tables to talk to, so fall back to the
     localStorage store. Identical API, so nothing below this line knows or
     cares which one it got. */
  const local = !userId;
  const store = local ? localStore : cloudStore;

  const btn = smallBtn(C, font);

  /* ---------- loading ---------- */

  /* Which paydays have come round without reaching the ledger. Answered by
     import_hash rather than by a "last posted" marker, so a paycheck posted on
     another device already counts as posted here. */
  const refreshDue = useCallback(async (config) => {
    const dates = candidateDates(config, todayKey());
    if (!dates.length) { setDuePay([]); return; }
    const existing = await store.existingHashes(userId, hashesFor(config, dates));
    setDuePay(duePayDates(config, dates, existing));
  }, [store, userId]);

  const loadStatic = useCallback(async () => {
    const [a, e, t, at, pc, st] = await Promise.all([
      store.listAccounts(userId), store.listEnvelopes(userId),
      store.monthlyTotals(userId), store.accountTotals(userId), store.getPaycheck(userId),
      store.listStarting(userId),
    ]);
    setAccounts(a); setEnvelopes(e); setTotals(t); setAcctTotals(at); setPaycheck(pc);
    setOpenings(new Map(st.map((r) => [r.account_id, r.amount_cents])));
    await refreshDue(pc);
    return { accounts: a, envelopes: e };
  }, [store, userId, refreshDue]);

  const loadMonth = useCallback(async (m) => {
    const rows = await store.listMonth(userId, m);
    setTransactions(rows);
    return rows;
  }, [store, userId]);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true); setError(null);
      try {
        const { accounts: a } = await loadStatic();
        if (!alive) return;
        if (!a.length) { setLoading(false); return; }   // first run, show setup
        await loadMonth(month);
      } catch (e) {
        if (alive) setError(e.message || "Could not load your budget.");
      }
      if (alive) setLoading(false);
    })();
    return () => { alive = false; };
  }, [loadStatic, loadMonth, month]);

  /* Returns what it loaded, so a caller that just wrote a row can check the
     result against the envelope's limit without waiting for a re-render. */
  const refresh = useCallback(async () => {
    try {
      const [statics, rows] = await Promise.all([loadStatic(), loadMonth(month)]);
      return { ...statics, transactions: rows };
    } catch (e) {
      onToast?.(e.message || "Refresh failed");
      return null;
    }
  }, [loadStatic, loadMonth, month, onToast]);

  /* ---------- derived ---------- */

  const balances = useMemo(() => {
    const m = new Map(accounts.map((a) => [a.id, 0]));
    acctTotals.forEach((r) => m.has(r.account_id) && m.set(r.account_id, Number(r.total_cents)));
    return m;
  }, [accounts, acctTotals]);

  const summary = useMemo(() => monthSummary(transactions), [transactions]);
  const envRows = useMemo(() => envelopeSpending(envelopes, transactions), [envelopes, transactions]);
  const totalsIndex = useMemo(() => indexMonthlyTotals(
    totals.map((r) => ({ ...r, total_cents: Number(r.total_cents) }))), [totals]);
  const worth = useMemo(() => {
    const fake = accounts.map((a) => ({ ...a }));
    const rows = [...balances.entries()].map(([id, v]) => ({ account_id: id, amount_cents: v, kind: "normal" }));
    return netWorth(fake, rows);
  }, [accounts, balances]);

  /* Envelopes answer "where did it go"; these answer "what is left". Grouped
     rather than listed flat, since a card balance is a debt and reads the
     opposite way round to money in the bank. */
  const accountGroups = useMemo(() => {
    const cash = [], cards = [];
    accounts.filter((a) => !a.archived).forEach((a) => {
      const row = { id: a.id, name: a.name, balance: balances.get(a.id) || 0 };
      (a.kind === "credit" ? cards : cash).push(row);
    });
    const total = (xs) => xs.reduce((s, x) => s + x.balance, 0);
    return { cash, cards, cashTotal: total(cash), cardTotal: total(cards) };
  }, [accounts, balances]);

  const spendingByEnvelope = useMemo(
    () => new Map(envRows.map(({ envelope, spent }) => [envelope.id, spent])), [envRows]);

  const overLimit = useMemo(() => envRows.filter(
    ({ envelope, spent }) => envelope.limit_cents != null && spent > envelope.limit_cents), [envRows]);

  const visible = useMemo(() => (
    filterEnvelope
      ? transactions.filter((t) => (t.envelope_id || "__unassigned") === filterEnvelope)
      : transactions
  ), [transactions, filterEnvelope]);

  const nameOf = useMemo(() => {
    const m = new Map(envelopes.map((e) => [e.id, e]));
    return (id) => m.get(id);
  }, [envelopes]);
  const acctName = useMemo(() => {
    const m = new Map(accounts.map((a) => [a.id, a.name]));
    return (id) => m.get(id) || "—";
  }, [accounts]);

  /* ---------- mutations ---------- */

  const guard = (fn) => async (...args) => {
    try { return await fn(...args); }
    catch (e) { onToast?.(e.message || "Something went wrong"); throw e; }
  };

  /* Warn on the edit that crosses the line, not just on the next render — by
     the time the row is saved the user is usually already looking away. */
  const warnIfOverLimit = (envelopeId, after) => {
    if (!envelopeId || !after) return;
    const envelope = after.envelopes.find((e) => e.id === envelopeId);
    if (envelope?.limit_cents == null) return;
    const spent = envelopeSpending([envelope], after.transactions)
      .find((r) => r.envelope.id === envelopeId)?.spent || 0;
    if (spent > envelope.limit_cents) {
      onToast?.(`${envelope.name} is over its ${money(envelope.limit_cents)} limit — ` +
        `${money(spent)} spent in ${monthLabel(month)}.`);
    }
  };

  const saveTransaction = guard(async (tx) => {
    if (editing?.id) await store.updateTransaction(editing.id, tx);
    else await store.createTransaction(userId, tx);
    setModal(null); setEditing(null);
    warnIfOverLimit(tx.envelope_id, await refresh());
  });

  const removeTransaction = guard(async (id) => {
    await store.deleteTransaction(id);
    setModal(null); setEditing(null);
    await refresh();
  });

  const addAccount = guard(async (account, startingCents) => {
    const created = await store.createAccount(userId, account);
    if (startingCents) {
      await store.createTransaction(userId, {
        account_id: created.id, date: `${month}-01`, amount_cents: startingCents,
        payee: "Starting balance", kind: "starting", envelope_id: null, cleared: true,
      });
    }
    await refresh();
  });

  const patchAccount = guard(async (id, patch) => {
    setAccounts((xs) => xs.map((a) => (a.id === id ? { ...a, ...patch } : a)));
    await store.updateAccount(id, patch);
  });

  const addEnvelope = guard(async (envelope) => {
    await store.createEnvelope(userId, envelope);
    await refresh();
  });

  const patchEnvelope = guard(async (id, patch) => {
    setEnvelopes((xs) => xs.map((e) => (e.id === id ? { ...e, ...patch } : e)));
    await store.updateEnvelope(id, patch);
  });

  const savePaycheckConfig = guard(async (config) => {
    const saved = await store.savePaycheck(userId, config);
    setPaycheck(saved);
    setModal(null);
    await refreshDue(saved);
  });

  /* Deterministic import hashes mean this runs through the same duplicate
     handling as a CSV import — posting twice cannot double-deposit. */
  const postDuePaychecks = guard(async () => {
    const rows = duePay.flatMap((pd) => paycheckRows(paycheck, pd));
    if (!rows.length) return;
    const { inserted } = await store.importTransactions(userId, rows);
    await refresh();
    await refreshDue(paycheck);
    onToast?.(`Posted ${duePay.length} payday${duePay.length > 1 ? "s" : ""} · ` +
      `${inserted} deposit${inserted === 1 ? "" : "s"}.`, "accent");
  });

  /**
   * Import the rows, then — if the export carried a running balance — reconcile
   * the account to it by sizing its starting-balance row to whatever the
   * imported history doesn't already account for. Rewrites the existing
   * starting row rather than stacking a second one.
   */
  const importCsv = guard(async (rows, balance, accountId) => {
    const res = await store.importTransactions(userId, rows);
    if (!balance || !accountId) return res;

    const through = await store.accountRowsThrough(userId, accountId, balance.date);
    const target = startingAdjustment(accountId, balance.balance_cents, through);
    const existing = through.find((t) => t.kind === "starting" && t.account_id === accountId);

    if (existing) {
      if (existing.amount_cents !== target) await store.updateTransaction(existing.id, { amount_cents: target });
    } else if (target !== 0) {
      const earliest = through.reduce((m, t) => (t.date < m ? t.date : m), balance.date);
      await store.createTransaction(userId, {
        account_id: accountId, date: earliest, amount_cents: target,
        payee: "Starting balance", kind: "starting", envelope_id: null, cleared: true,
      });
    }
    return { ...res, balanceSet: balance.balance_cents, startingCents: target };
  });

  /**
   * Set what an account held before its imported history begins. Most bank
   * exports carry no running balance, so without this an account shows only
   * the movement in the file — a card that was already owed money in December
   * reads far too healthy.
   */
  const setOpeningBalance = guard(async (accountId, cents) => {
    const rows = await store.accountRowsThrough(userId, accountId, todayKey());
    const mine = rows.filter((t) => t.account_id === accountId);
    const existing = mine.find((t) => t.kind === "starting");
    if (existing) {
      if (existing.amount_cents !== cents) {
        await store.updateTransaction(existing.id, { amount_cents: cents });
      }
    } else if (cents !== 0) {
      // Date it before anything else on the account, so it counts towards any
      // later balance reconciliation rather than sitting after it.
      const earliest = mine.reduce((m, t) => (!m || t.date < m ? t.date : m), null);
      await store.createTransaction(userId, {
        account_id: accountId, date: earliest || `${month}-01`, amount_cents: cents,
        payee: "Starting balance", kind: "starting", envelope_id: null, cleared: true,
      });
    }
    await refresh();
  });

  const clearAccount = guard(async (accountId) => {
    const n = await store.deleteAccountTransactions(userId, accountId);
    setFilterEnvelope("");
    await refresh();
    onToast?.(`Deleted ${n} row${n === 1 ? "" : "s"} — that account is ready to re-import.`, "amber");
  });

  const runSeed = guard(async () => {
    setLoading(true);
    await store.seedBudget(userId);
    await refresh();
    setLoading(false);
  });

  /* Local only. Four months of plausible ledger, so the month nav, the
     envelope baselines and the card-debt tile all have something to show
     without hand-entering a hundred rows first. */
  const runSample = guard(async () => {
    setLoading(true);
    await store.seedSampleBudget(userId);
    setMonth(currentMonth());
    setFilterEnvelope("");
    await refresh();
    setLoading(false);
  });

  const resetLocal = guard(async () => {
    setLoading(true);
    await store.clearLocalBudget();
    setFilterEnvelope("");
    await refresh();
    setLoading(false);
  });

  /* ---------- render ---------- */

  const panel = { background: C.surface, border: `1px solid ${C.border}`,
    borderRadius: 14, padding: isNarrow ? 16 : 22 };

  if (loading) {
    return <section style={panel}><div style={{ fontSize: 13, color: C.muted }}>Loading…</div></section>;
  }

  if (error) {
    return (
      <section style={panel}>
        <div style={{ fontSize: 13, color: C.danger, marginBottom: 12 }}>{error}</div>
        <button style={{ ...btn, fontSize: 13, padding: "7px 14px" }} onClick={refresh}>Try again</button>
      </section>
    );
  }

  if (!accounts.length) {
    return (
      <section style={panel}>
        <div style={{ fontFamily: display, fontWeight: 700, fontSize: 15, marginBottom: 8 }}>Budget</div>
        <div style={{ fontSize: 13, color: C.muted, lineHeight: 1.7, marginBottom: 14, maxWidth: 520 }}>
          Nothing set up yet. Start with a checking account and six common envelopes —
          you can rename, add and archive any of them afterwards.
          {local && " Signed out, so this stays on this device only."}
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button onClick={runSeed}
            style={{ ...btn, background: C.accent, color: C.accentInk, borderColor: C.accent,
              fontSize: 13, padding: "8px 16px" }}>Set up my budget</button>
          {local && (
            <button onClick={runSample} style={{ ...btn, fontSize: 13, padding: "8px 16px" }}>
              Load sample data
            </button>
          )}
        </div>
      </section>
    );
  }

  const card = { background: C.bg, borderRadius: 10, padding: "11px 13px" };
  const cardLabel = { fontSize: 11, color: C.muted, marginBottom: 3 };
  const cardValue = { fontSize: 16, fontWeight: 600, fontVariantNumeric: "tabular-nums" };

  return (
    <section style={panel}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
        <div style={{ fontFamily: display, fontWeight: 700, fontSize: 15 }}>Budget</div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <button style={btn} onClick={() => setMonth((m) => shiftMonth(m, -1))} aria-label="Previous month">‹</button>
          <div style={{ fontSize: 12, color: C.muted, minWidth: 108, textAlign: "center" }}>
            {monthLabel(month)}
          </div>
          <button style={{ ...btn, opacity: month >= currentMonth() ? 0.4 : 1 }}
            disabled={month >= currentMonth()}
            onClick={() => setMonth((m) => shiftMonth(m, 1))} aria-label="Next month">›</button>
        </div>
        <div style={{ flex: 1 }} />
        {local && (
          <>
            {!isPhone && <span style={{ fontSize: 11, color: C.muted }}>this device only</span>}
            <button style={btn} onClick={resetLocal}>Reset</button>
          </>
        )}
        <button style={btn} onClick={() => setModal("paycheck")}>Paycheck</button>
        <button style={btn} onClick={() => setModal("envelopes")}>Envelopes</button>
        <button style={btn} onClick={() => setModal("accounts")}>Accounts</button>
        <button style={btn} onClick={() => setModal("import")}>Import CSV</button>
        <button style={{ ...btn, background: C.accent, color: C.accentInk, borderColor: C.accent }}
          onClick={() => { setEditing(null); setModal("add"); }}>Add</button>
      </div>

      <div style={{ display: "grid", gap: 10, marginBottom: 20,
        gridTemplateColumns: isPhone ? "1fr 1fr" : "repeat(4, 1fr)" }}>
        <div style={card}>
          <div style={cardLabel}>Income</div>
          <div style={{ ...cardValue, color: summary.income ? C.accent : C.ink }}>{money(summary.income)}</div>
        </div>
        <div style={card}>
          <div style={cardLabel}>Spent</div>
          <div style={cardValue}>{money(summary.spent)}</div>
        </div>
        <div style={card}>
          <div style={cardLabel}>Net</div>
          <div style={{ ...cardValue, color: summary.net < 0 ? C.danger : C.accent }}>
            {moneySigned(summary.net)}
          </div>
        </div>
        <div style={card}>
          <div style={cardLabel}>{worth.debt < 0 ? "Card debt" : "Transactions"}</div>
          <div style={{ ...cardValue, color: worth.debt < 0 ? C.amber : C.ink }}>
            {worth.debt < 0 ? money(worth.debt) : summary.count}
          </div>
        </div>
      </div>

      {duePay.length > 0 && (
        <div role="status" style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap",
          marginBottom: 16, padding: "10px 12px", borderRadius: 10, fontSize: 12.5,
          lineHeight: 1.6, background: C.bg, border: `1px solid ${C.accent}` }}>
          <span>
            <strong style={{ fontWeight: 700 }}>
              {duePay.length} payday{duePay.length > 1 ? "s" : ""} ready to post:
            </strong>{" "}
            {duePay.map((pd) => `${pd.date} ${money(pd.amount_cents)}`).join(" · ")}
          </span>
          <div style={{ flex: 1 }} />
          <button onClick={postDuePaychecks}
            style={{ ...btn, background: C.accent, color: C.accentInk,
              border: `1px solid ${C.accent}` }}>
            Post
          </button>
          <button style={btn} onClick={() => setModal("paycheck")}>Edit</button>
        </div>
      )}

      {overLimit.length > 0 && (
        <div role="status" style={{ display: "flex", alignItems: "flex-start", gap: 8,
          marginBottom: 16, padding: "10px 12px", borderRadius: 10, fontSize: 12.5,
          lineHeight: 1.6, background: C.bg, border: `1px solid ${C.amber}` }}>
          <span aria-hidden="true">⚠</span>
          <span>
            <strong style={{ fontWeight: 700 }}>Over limit in {monthLabel(month)}:</strong>{" "}
            {overLimit.map(({ envelope, spent }) =>
              `${envelope.name} ${money(spent)} of ${money(envelope.limit_cents)}`).join(" · ")}
          </span>
        </div>
      )}

      {/* what's actually in the accounts, before the month's spending breakdown */}
      <div style={{ display: "grid", gap: 10, marginBottom: 18,
        gridTemplateColumns: isPhone ? "1fr" : "1fr 1fr" }}>
        {[["In the bank", accountGroups.cash, accountGroups.cashTotal, false],
          ["On the cards", accountGroups.cards, accountGroups.cardTotal, true]]
          .filter(([, list]) => list.length)
          .map(([label, list, total, isCard]) => (
            <div key={label} style={{ background: C.bg, borderRadius: 10, padding: "11px 13px" }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 7 }}>
                <span style={{ fontSize: 11, color: C.muted }}>{label}</span>
                <div style={{ flex: 1 }} />
                <span style={{ fontSize: 16, fontWeight: 600, fontVariantNumeric: "tabular-nums",
                  color: total < 0 ? (isCard ? C.amber : C.danger) : C.ink }}>{money(total)}</span>
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "3px 12px" }}>
                {list.map((a) => (
                  <span key={a.id} style={{ fontSize: 11.5, color: C.muted }}>
                    {a.name}{" "}
                    <span style={{ fontVariantNumeric: "tabular-nums",
                      color: a.balance < 0 ? (isCard ? C.amber : C.danger) : C.ink }}>
                      {money(a.balance)}
                    </span>
                  </span>
                ))}
              </div>
            </div>
          ))}
      </div>

      {/* envelopes */}
      <div style={{ fontSize: 12, color: C.muted, marginBottom: 8 }}>By envelope</div>
      {!envRows.length ? (
        <div style={{ fontSize: 13, color: C.muted, padding: "6px 0 16px" }}>
          No spending recorded this month.
        </div>
      ) : (
        <div style={{ marginBottom: 20 }}>
          {envRows.map(({ envelope, spent }) => {
            /* An explicit limit beats the trailing average — it is what the
               user actually asked to be measured against. */
            const limit = envelope.limit_cents ?? null;
            const base = limit ?? (envelope.id === "__unassigned" ? null
              : baselineFor(envelope.id, totalsIndex, month));
            // Refunds can net an envelope below zero; a negative bar width is
            // not a thing, so floor it.
            const pct = base ? Math.min(100, Math.max(0, Math.round((100 * spent) / base))) : 0;
            const over = base != null && spent > base;
            const active = filterEnvelope === envelope.id;
            return (
              <div key={envelope.id}
                onClick={() => setFilterEnvelope(active ? "" : envelope.id)}
                style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 6px",
                  cursor: "pointer", borderRadius: 8, borderTop: `1px solid ${C.border}`,
                  background: active ? C.bg : "transparent" }}>
                <div style={{ width: isPhone ? 110 : 150, minWidth: 0, fontSize: 13,
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  <span style={{ marginRight: 7 }}>{envelope.icon}</span>{envelope.name}
                </div>
                {!isPhone && (
                  <div style={{ flex: 1, maxWidth: 240, height: 5, borderRadius: 3,
                    background: C.ringTrack, overflow: "hidden" }}>
                    <div style={{ width: `${pct}%`, height: "100%",
                      background: over ? C.amber : C.accent }} />
                  </div>
                )}
                <div style={{ flex: 1 }} />
                {/* Both columns keep their width even when empty, so the
                    amounts stay in one line down the list. */}
                {!isPhone && (
                  <span style={{ fontSize: 11, width: 96, textAlign: "right",
                    color: limit != null && over ? C.amber : C.muted }}>
                    {base == null ? "" : limit != null ? `limit ${money(limit)}` : `avg ${money(base)}`}
                  </span>
                )}
                {!isPhone && (
                  <span style={{ fontSize: 11, width: 92, textAlign: "right", fontWeight: 700,
                    fontVariantNumeric: "tabular-nums", color: C.amber }}>
                    {over ? `over ${money(spent - base)}` : ""}
                  </span>
                )}
                <span style={{ fontSize: 13, fontVariantNumeric: "tabular-nums", width: 92,
                  textAlign: "right", color: over ? C.amber : C.ink }}>{money(spent)}</span>
              </div>
            );
          })}
        </div>
      )}

      {/* transactions */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
        <div style={{ fontSize: 12, color: C.muted }}>
          {filterEnvelope ? "Filtered" : "Transactions"} · {visible.length}
        </div>
        {filterEnvelope && (
          <button style={{ ...btn, fontSize: 11, padding: "3px 8px" }}
            onClick={() => setFilterEnvelope("")}>Clear filter</button>
        )}
      </div>

      {!visible.length ? (
        <div style={{ fontSize: 13, color: C.muted, padding: "6px 0" }}>
          Nothing here yet. Add one, or import a CSV from your bank.
        </div>
      ) : (
        <div>
          {visible.map((t) => {
            const env = nameOf(t.envelope_id);
            const isTransfer = t.kind === "transfer";
            const isStarting = t.kind === "starting";
            return (
              <div key={t.id} onClick={() => { setEditing(t); setModal("edit"); }}
                style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 6px",
                  cursor: "pointer", borderTop: `1px solid ${C.border}` }}>
                <span style={{ fontSize: 12, color: C.muted, width: 74, flexShrink: 0 }}>
                  {t.date.slice(5)}
                </span>
                <span style={{ flex: 1, minWidth: 0, fontSize: 13, overflow: "hidden",
                  textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {t.payee || <span style={{ color: C.muted }}>(no payee)</span>}
                </span>
                {!isPhone && (
                  <span style={{ fontSize: 12, color: C.muted, width: 150, flexShrink: 0,
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {/* An imported transfer has no destination on it — the far
                        side came from that account's own export. */}
                    {isTransfer ? (t.transfer_account_id ? `→ ${acctName(t.transfer_account_id)}` : "transfer")
                      : isStarting ? "starting balance"
                      : env ? `${env.icon || ""} ${env.name}`
                      // Income has no envelope by design — envelopes track
                      // spending — so it is not the amber "you forgot one" case.
                      : t.amount_cents > 0 ? "income"
                      : <span style={{ color: C.amber }}>unassigned</span>}
                  </span>
                )}
                {!isPhone && (
                  <span style={{ fontSize: 12, color: C.muted, width: 100, flexShrink: 0,
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {acctName(t.account_id)}
                  </span>
                )}
                <span style={{ fontSize: 13, fontVariantNumeric: "tabular-nums", width: 96,
                  textAlign: "right", flexShrink: 0,
                  color: isTransfer || isStarting ? C.muted : t.amount_cents > 0 ? C.accent : C.ink }}>
                  {money(t.amount_cents)}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {/* modals */}
      {(modal === "add" || modal === "edit") && (
        <Modal C={C} title={modal === "edit" ? "Edit transaction" : "Add transaction"}
          onClose={() => { setModal(null); setEditing(null); }}>
          <TransactionForm C={C} font={font} accounts={accounts} envelopes={envelopes}
            initial={editing} onSave={saveTransaction} onDelete={removeTransaction}
            onCancel={() => { setModal(null); setEditing(null); }} />
        </Modal>
      )}

      {modal === "accounts" && (
        <Modal C={C} title="Accounts" onClose={() => setModal(null)}>
          <AccountManager C={C} font={font} accounts={accounts} balances={balances}
            openings={openings} onCreate={addAccount} onUpdate={patchAccount}
            onSetStarting={setOpeningBalance} onClear={clearAccount} />
        </Modal>
      )}

      {modal === "envelopes" && (
        <Modal C={C} title="Envelopes" onClose={() => setModal(null)}>
          <EnvelopeManager C={C} font={font} envelopes={envelopes} spending={spendingByEnvelope}
            onCreate={addEnvelope} onUpdate={patchEnvelope} />
        </Modal>
      )}

      {modal === "paycheck" && (
        <Modal C={C} title="Recurring paycheck" onClose={() => setModal(null)}>
          <PaycheckManager C={C} font={font} accounts={accounts} initial={paycheck}
            onSave={savePaycheckConfig} onClose={() => setModal(null)} />
        </Modal>
      )}

      {modal === "import" && (
        <Modal C={C} title="Import CSV" onClose={() => { setModal(null); refresh(); }}>
          <CsvImport C={C} font={font} accounts={accounts}
            onCheckDuplicates={(hashes) => store.existingHashes(userId, hashes)}
            onImport={importCsv}
            onClose={() => { setModal(null); refresh(); }} />
        </Modal>
      )}
    </section>
  );
}
