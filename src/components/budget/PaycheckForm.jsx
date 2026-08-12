import React, { useState } from "react";
import { todayKey } from "../../lib/dates.js";
import { parseMoney, centsToInput, money } from "../../lib/budget/money.js";
import { DEFAULT_PAYCHECK, splitAmount, splitTotal } from "../../lib/budget/paycheck.js";
import { fieldStyle, smallBtn } from "./BudgetForms.jsx";

const label = (C) => ({ fontSize: 11, color: C.muted, marginBottom: 4, display: "block" });

/**
 * The recurring-paycheck config: which days of the month it lands, how much on
 * each, and the percentage split across accounts.
 *
 * Edits are held as a draft and written on Save rather than per keystroke —
 * a half-typed percentage would otherwise repeatedly rewrite the split and
 * the preview underneath it.
 */
export function PaycheckManager({ C, font, accounts, initial, onSave, onClose }) {
  const live = accounts.filter((a) => !a.archived);
  const base = initial || { ...DEFAULT_PAYCHECK, start_date: todayKey() };

  const [payee, setPayee] = useState(base.payee || "Paycheck");
  const [startDate, setStartDate] = useState(base.start_date || todayKey());
  const [payDays, setPayDays] = useState(
    (base.pay_days?.length ? base.pay_days : DEFAULT_PAYCHECK.pay_days).map((p) => ({
      day: String(p.day ?? ""), amount: p.amount_cents ? centsToInput(p.amount_cents) : "",
    })));
  const [splits, setSplits] = useState(
    (base.splits?.length ? base.splits : [{ account_id: live[0]?.id || "", percent: 100 }])
      .map((s) => ({ account_id: s.account_id || "", percent: String(s.percent ?? "") })));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const f = fieldStyle(C, font);
  const btn = smallBtn(C, font);

  const parsed = {
    pay_days: payDays
      .map((p) => ({ day: Number(p.day), amount_cents: parseMoney(p.amount) || 0 }))
      .filter((p) => p.day >= 1 && p.day <= 31),
    splits: splits
      .map((s) => ({ account_id: s.account_id, percent: Number(s.percent) || 0 }))
      .filter((s) => s.account_id && s.percent > 0),
  };
  const pct = splitTotal(parsed.splits);
  const pctOff = parsed.splits.length > 0 && Math.abs(pct - 100) > 0.001;

  const setPayDay = (i, patch) =>
    setPayDays((xs) => xs.map((p, k) => (k === i ? { ...p, ...patch } : p)));
  const setSplit = (i, patch) =>
    setSplits((xs) => xs.map((s, k) => (k === i ? { ...s, ...patch } : s)));

  const save = async () => {
    if (!parsed.pay_days.length) { setError("Add at least one pay day."); return; }
    if (!parsed.splits.length) { setError("Add at least one account to split into."); return; }
    if (pctOff) { setError(`The percentages add up to ${round(pct)}%, not 100%.`); return; }
    setBusy(true); setError(null);
    try {
      await onSave({ payee: payee.trim() || "Paycheck", start_date: startDate, ...parsed });
    } catch (e) {
      setError(e.message || "Could not save"); setBusy(false);
    }
  };

  const nameOf = (id) => live.find((a) => a.id === id)?.name || "—";

  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
        <div>
          <span style={label(C)}>Payer</span>
          <input value={payee} onChange={(e) => setPayee(e.target.value)}
            placeholder="Paycheck" style={f} />
        </div>
        <div>
          <span style={label(C)}>Start posting from</span>
          <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} style={f} />
        </div>
      </div>

      <div style={{ fontSize: 12, color: C.muted, marginBottom: 6 }}>Pay days</div>
      {payDays.map((p, i) => (
        <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
          <span style={{ fontSize: 12, color: C.muted, width: 26 }}>on</span>
          <input value={p.day} onChange={(e) => setPayDay(i, { day: e.target.value.replace(/\D/g, "").slice(0, 2) })}
            aria-label={`Day of month for pay day ${i + 1}`} inputMode="numeric"
            style={{ ...f, width: 58, textAlign: "center" }} />
          <span style={{ fontSize: 12, color: C.muted }}>{ordinal(p.day)}</span>
          <div style={{ flex: 1 }} />
          <input value={p.amount} onChange={(e) => setPayDay(i, { amount: e.target.value })}
            aria-label={`Amount for pay day ${i + 1}`} placeholder="0.00" inputMode="decimal"
            style={{ ...f, width: 110, textAlign: "right" }} />
          <button style={{ ...btn, color: C.danger }} disabled={payDays.length === 1}
            onClick={() => setPayDays((xs) => xs.filter((_, k) => k !== i))}
            aria-label={`Remove pay day ${i + 1}`}>✕</button>
        </div>
      ))}
      <button style={{ ...btn, marginBottom: 18 }}
        onClick={() => setPayDays((xs) => [...xs, { day: "", amount: "" }])}>+ Add a pay day</button>

      <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 6 }}>
        <span style={{ fontSize: 12, color: C.muted }}>Split into</span>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 11, fontWeight: 700, color: pctOff ? C.amber : C.muted }}>
          {round(pct)}% of 100%
        </span>
      </div>
      {splits.map((s, i) => (
        <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
          <select value={s.account_id} onChange={(e) => setSplit(i, { account_id: e.target.value })}
            aria-label={`Account for split ${i + 1}`} style={{ ...f, flex: 1, minWidth: 0 }}>
            <option value="">Pick an account…</option>
            {live.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
          <input value={s.percent} onChange={(e) => setSplit(i, { percent: e.target.value.replace(/[^\d.]/g, "") })}
            aria-label={`Percent for split ${i + 1}`} inputMode="decimal"
            style={{ ...f, width: 72, textAlign: "right" }} />
          <span style={{ fontSize: 12, color: C.muted, width: 12 }}>%</span>
          <button style={{ ...btn, color: C.danger }} disabled={splits.length === 1}
            onClick={() => setSplits((xs) => xs.filter((_, k) => k !== i))}
            aria-label={`Remove split ${i + 1}`}>✕</button>
        </div>
      ))}
      <button style={{ ...btn, marginBottom: 16 }}
        onClick={() => setSplits((xs) => [...xs, { account_id: "", percent: "" }])}>+ Add an account</button>

      {/* What the config actually produces, in cents, before anything is written. */}
      {parsed.splits.length > 0 && parsed.pay_days.some((p) => p.amount_cents > 0) && (
        <div style={{ background: C.bg, borderRadius: 10, padding: "11px 13px", marginBottom: 16 }}>
          <div style={{ fontSize: 11, color: C.muted, marginBottom: 7 }}>Each payday deposits</div>
          {parsed.pay_days.filter((p) => p.amount_cents > 0).map((p) => (
            <div key={p.day} style={{ marginBottom: 6 }}>
              <div style={{ fontSize: 12, marginBottom: 3 }}>
                {ordinal(p.day)} · {money(p.amount_cents)}
              </div>
              {splitAmount(p.amount_cents, parsed.splits).map((s) => (
                <div key={s.account_id} style={{ display: "flex", fontSize: 12, color: C.muted,
                  paddingLeft: 12, lineHeight: 1.7 }}>
                  <span style={{ flex: 1 }}>{nameOf(s.account_id)}</span>
                  <span style={{ fontVariantNumeric: "tabular-nums" }}>{money(s.amount_cents)}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      {error && <div style={{ fontSize: 12, color: C.danger, marginBottom: 10 }}>{error}</div>}

      <div style={{ display: "flex", gap: 8 }}>
        <button onClick={save} disabled={busy}
          style={{ ...btn, background: C.accent, color: C.accentInk,
            border: `1px solid ${C.accent}`,
            fontSize: 13, padding: "8px 16px", opacity: busy ? 0.5 : 1 }}>Save</button>
        <button onClick={onClose} style={{ ...btn, fontSize: 13, padding: "8px 16px" }}>Cancel</button>
      </div>

      <div style={{ fontSize: 12, color: C.muted, marginTop: 14, lineHeight: 1.6 }}>
        Paydays that have already passed show up as a prompt on the budget — nothing
        is added to your ledger until you post them. A day past the end of a short
        month lands on that month's last day.
      </div>
    </div>
  );
}

const round = (n) => Math.round(n * 100) / 100;

function ordinal(day) {
  const n = Number(day);
  if (!n) return "—";
  const rest = n % 100;
  const suffix = rest >= 11 && rest <= 13 ? "th"
    : n % 10 === 1 ? "st" : n % 10 === 2 ? "nd" : n % 10 === 3 ? "rd" : "th";
  return `${n}${suffix}`;
}
