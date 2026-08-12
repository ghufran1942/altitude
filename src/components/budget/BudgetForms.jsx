import React, { useState } from "react";
import { todayKey } from "../../lib/dates.js";
import { parseMoney, centsToInput, money } from "../../lib/budget/money.js";

/* ---------------- shared field styles ---------------- */

export const fieldStyle = (C, font) => ({
  padding: "8px 10px", borderRadius: 8, border: `1px solid ${C.border}`,
  background: C.bg, color: C.ink, fontFamily: font, fontSize: 13, width: "100%",
});
export const smallBtn = (C, font) => ({
  fontFamily: font, fontSize: 12, fontWeight: 600, cursor: "pointer",
  padding: "5px 10px", borderRadius: 7, border: `1px solid ${C.border}`,
  background: C.surface, color: C.muted,
});
const label = (C) => ({ fontSize: 11, color: C.muted, marginBottom: 4, display: "block" });

/* ---------------- transaction form ---------------- */

/**
 * One form for both new and existing rows. `direction` keeps the sign out of
 * the user's hands — typing a minus in an amount field is a common way to
 * end up with an accidental positive expense.
 */
export function TransactionForm({ C, font, accounts, envelopes, initial, onSave, onDelete, onCancel }) {
  const live = accounts.filter((a) => !a.archived);
  const envs = envelopes.filter((e) => !e.archived && e.kind !== "payment");
  const start = initial || {};

  const [date, setDate] = useState(start.date || todayKey());
  const [amount, setAmount] = useState(
    start.amount_cents != null ? centsToInput(start.amount_cents) : "");
  const [direction, setDirection] = useState(
    start.amount_cents != null && start.amount_cents > 0 ? "in" : "out");
  const [payee, setPayee] = useState(start.payee || "");
  const [note, setNote] = useState(start.note || "");
  const [accountId, setAccountId] = useState(start.account_id || live[0]?.id || "");
  const [envelopeId, setEnvelopeId] = useState(start.envelope_id || "");
  const [kind, setKind] = useState(start.kind || "normal");
  const [transferTo, setTransferTo] = useState(start.transfer_account_id || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const f = fieldStyle(C, font);
  const btn = smallBtn(C, font);
  const isTransfer = kind === "transfer";

  const submit = async () => {
    const cents = parseMoney(amount);
    if (cents == null || cents === 0) { setError("Enter an amount"); return; }
    if (!accountId) { setError("Pick an account"); return; }
    if (isTransfer && !transferTo) { setError("Pick a destination account"); return; }
    if (isTransfer && transferTo === accountId) { setError("Pick a different account"); return; }
    setBusy(true); setError(null);
    try {
      await onSave({
        date,
        amount_cents: direction === "out" ? -Math.abs(cents) : Math.abs(cents),
        payee: payee.trim() || null,
        note: note.trim() || null,
        account_id: accountId,
        envelope_id: isTransfer ? null : envelopeId || null,
        transfer_account_id: isTransfer ? transferTo : null,
        kind,
      });
    } catch (e) {
      setError(e.message || "Could not save");
      setBusy(false);
    }
  };

  return (
    <div>
      <div style={{ display: "flex", gap: 4, marginBottom: 14 }}>
        {[["normal", "Spending / income"], ["transfer", "Transfer"]].map(([k, t]) => (
          <button key={k} onClick={() => setKind(k)}
            style={{ ...btn, border: `1px solid ${kind === k ? C.accent : C.border}`,
              background: kind === k ? C.accent : "transparent",
              color: kind === k ? C.accentInk : C.muted }}>{t}</button>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
        <div>
          <span style={label(C)}>Date</span>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={f} />
        </div>
        <div>
          <span style={label(C)}>Amount</span>
          <div style={{ display: "flex", gap: 6 }}>
            <input value={amount} onChange={(e) => setAmount(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
              placeholder="0.00" inputMode="decimal" style={{ ...f, flex: 1 }} />
            {!isTransfer && (
              <div style={{ display: "flex", gap: 3 }}>
                {[["out", "−"], ["in", "+"]].map(([d, t]) => (
                  <button key={d} onClick={() => setDirection(d)} aria-label={d === "out" ? "Outflow" : "Inflow"}
                    style={{ ...btn, padding: "5px 9px", fontSize: 14,
                      border: `1px solid ${direction === d ? C.accent : C.border}`,
                      background: direction === d ? C.accent : "transparent",
                      color: direction === d ? C.accentInk : C.muted }}>{t}</button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <div style={{ marginBottom: 12 }}>
        <span style={label(C)}>{isTransfer ? "From account" : "Account"}</span>
        <select value={accountId} onChange={(e) => setAccountId(e.target.value)} style={f}>
          {live.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
      </div>

      {isTransfer ? (
        <div style={{ marginBottom: 12 }}>
          <span style={label(C)}>To account</span>
          <select value={transferTo} onChange={(e) => setTransferTo(e.target.value)} style={f}>
            <option value="">Choose…</option>
            {live.filter((a) => a.id !== accountId).map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
          <div style={{ fontSize: 11, color: C.muted, marginTop: 6, lineHeight: 1.5 }}>
            Transfers move your own money — they don't count as income or spending.
          </div>
        </div>
      ) : (
        <div style={{ marginBottom: 12 }}>
          <span style={label(C)}>Envelope</span>
          <select value={envelopeId} onChange={(e) => setEnvelopeId(e.target.value)} style={f}>
            <option value="">{direction === "in" ? "Income (no envelope)" : "Unassigned"}</option>
            {envs.map((e) => <option key={e.id} value={e.id}>{e.icon} {e.name}</option>)}
          </select>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 14 }}>
        <div>
          <span style={label(C)}>Payee</span>
          <input value={payee} onChange={(e) => setPayee(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
            placeholder="Where?" style={f} />
        </div>
        <div>
          <span style={label(C)}>Note</span>
          <input value={note} onChange={(e) => setNote(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
            placeholder="Optional" style={f} />
        </div>
      </div>

      {error && (
        <div style={{ fontSize: 12, color: C.danger, marginBottom: 12 }}>{error}</div>
      )}

      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <button onClick={submit} disabled={busy}
          style={{ ...btn, background: C.accent, color: C.accentInk, borderColor: C.accent,
            fontSize: 13, padding: "8px 16px", opacity: busy ? 0.6 : 1 }}>
          {busy ? "Saving…" : initial?.id ? "Save changes" : "Add transaction"}
        </button>
        <button onClick={onCancel} style={{ ...btn, fontSize: 13, padding: "8px 14px" }}>Cancel</button>
        <div style={{ flex: 1 }} />
        {initial?.id && (
          <button onClick={() => onDelete(initial.id)}
            style={{ ...btn, fontSize: 13, padding: "8px 14px", color: C.danger }}>Delete</button>
        )}
      </div>
    </div>
  );
}

/* ---------------- accounts ---------------- */

const KINDS = [["checking", "Checking"], ["savings", "Savings"], ["cash", "Cash"], ["credit", "Credit card"]];

export function AccountManager({ C, font, accounts, balances, onCreate, onUpdate, onSetStarting }) {
  const [name, setName] = useState("");
  const [kind, setKind] = useState("checking");
  const [starting, setStarting] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const f = fieldStyle(C, font);
  const btn = smallBtn(C, font);
  const live = accounts.filter((a) => !a.archived);

  const add = async () => {
    if (!name.trim()) return;
    setBusy(true); setError(null);
    try {
      const cents = parseMoney(starting);
      await onCreate({ name: name.trim(), kind, on_budget: true, sort_order: live.length },
        cents == null ? 0 : kind === "credit" ? -Math.abs(cents) : cents);
      setName(""); setStarting("");
    } catch (e) { setError(e.message || "Could not create"); }
    setBusy(false);
  };

  return (
    <div>
      {live.map((a) => {
        const bal = balances.get(a.id) || 0;
        const isCredit = a.kind === "credit";
        return (
          <div key={a.id} style={{ display: "flex", alignItems: "center", gap: 8,
            padding: "9px 0", borderBottom: `1px solid ${C.border}` }}>
            <input value={a.name} onChange={(e) => onUpdate(a.id, { name: e.target.value })}
              aria-label="Account name" style={{ ...f, flex: 1, minWidth: 0 }} />
            <span style={{ fontSize: 11, color: C.muted, width: 78 }}>
              {KINDS.find(([k]) => k === a.kind)?.[1] || a.kind}
            </span>
            <span style={{ fontSize: 13, fontWeight: 600, width: 100, textAlign: "right",
              fontVariantNumeric: "tabular-nums",
              color: bal < 0 ? (isCredit ? C.amber : C.danger) : C.ink }}>{money(bal)}</span>
            <button style={{ ...btn, color: C.danger }}
              onClick={() => onUpdate(a.id, { archived: true })}>Archive</button>
          </div>
        );
      })}

      <div style={{ marginTop: 16, paddingTop: 14, borderTop: `1px solid ${C.border}` }}>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>Add an account</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
          <input value={name} onChange={(e) => setName(e.target.value)}
            placeholder="Account name" style={f} />
          <select value={kind} onChange={(e) => setKind(e.target.value)} style={f}>
            {KINDS.map(([k, t]) => <option key={k} value={k}>{t}</option>)}
          </select>
        </div>
        <input value={starting} onChange={(e) => setStarting(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") add(); }}
          placeholder={kind === "credit" ? "Amount currently owed" : "Starting balance"}
          inputMode="decimal" style={{ ...f, marginBottom: 10 }} />
        {kind === "credit" && (
          <div style={{ fontSize: 11, color: C.muted, marginBottom: 10, lineHeight: 1.5 }}>
            Enter what you owe as a positive number — it's recorded as debt. Existing
            balances are stored as a dated starting entry, so they never count as spending.
          </div>
        )}
        {error && <div style={{ fontSize: 12, color: C.danger, marginBottom: 10 }}>{error}</div>}
        <button onClick={add} disabled={busy || !name.trim()}
          style={{ ...btn, background: C.accent, color: C.accentInk, borderColor: C.accent,
            fontSize: 13, padding: "7px 14px", opacity: busy || !name.trim() ? 0.5 : 1 }}>
          {busy ? "Adding…" : "Add account"}
        </button>
      </div>
    </div>
  );
}

/* ---------------- envelopes ---------------- */

/**
 * Monthly limit for one envelope. Unlike the name and icon fields it keeps a
 * draft string rather than writing through on every keystroke — "12." and "" are
 * both mid-typing states that parseMoney reads as "no limit", so committing per
 * keystroke would clear the limit the moment you reached for the decimal point.
 */
function LimitInput({ C, font, envelope, onCommit }) {
  const saved = envelope.limit_cents != null ? centsToInput(envelope.limit_cents) : "";
  const [draft, setDraft] = useState(saved);
  const [editing, setEditing] = useState(false);

  const commit = () => {
    setEditing(false);
    const trimmed = draft.trim();
    const cents = trimmed ? parseMoney(trimmed) : null;
    const next = cents ? Math.abs(cents) : null;
    if (next === (envelope.limit_cents ?? null)) { setDraft(saved); return; }
    onCommit(next);
  };

  return (
    <input
      value={editing ? draft : saved}
      onFocus={() => { setDraft(saved); setEditing(true); }}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.target.blur();
        if (e.key === "Escape") { setDraft(saved); setEditing(false); e.target.blur(); }
      }}
      placeholder="none"
      inputMode="decimal"
      aria-label={`Monthly limit for ${envelope.name}`}
      style={{ ...fieldStyle(C, font), width: 88, textAlign: "right" }}
    />
  );
}

export function EnvelopeManager({ C, font, envelopes, spending, onCreate, onUpdate }) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const f = fieldStyle(C, font);
  const btn = smallBtn(C, font);
  const live = envelopes.filter((e) => !e.archived && e.kind !== "payment");
  const spentIn = (id) => (spending?.get(id) || 0);

  const add = async () => {
    if (!name.trim()) return;
    setBusy(true);
    try {
      await onCreate({ name: name.trim(), icon: "📦", kind: "normal", sort_order: live.length });
      setName("");
    } catch { /* surfaced by the caller's toast */ }
    setBusy(false);
  };

  const move = (id, dir) => {
    const i = live.findIndex((e) => e.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= live.length) return;
    onUpdate(live[i].id, { sort_order: live[j].sort_order });
    onUpdate(live[j].id, { sort_order: live[i].sort_order });
  };

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, paddingBottom: 6,
        fontSize: 11, color: C.muted }}>
        <span style={{ flex: 1, minWidth: 0 }}>Envelope</span>
        <span style={{ width: 78, textAlign: "right" }}>This month</span>
        <span style={{ width: 88, textAlign: "right" }}>Monthly limit</span>
        <span style={{ width: 122 }} />
      </div>
      {live.map((e, i) => {
        const spent = spentIn(e.id);
        const over = e.limit_cents != null && spent > e.limit_cents;
        return (
          <div key={e.id} style={{ display: "flex", alignItems: "center", gap: 8,
            padding: "8px 0", borderBottom: `1px solid ${C.border}` }}>
            <input value={e.icon || ""} onChange={(ev) => onUpdate(e.id, { icon: ev.target.value.slice(0, 2) })}
              aria-label={`Icon for ${e.name}`} style={{ ...f, width: 46, textAlign: "center" }} />
            <input value={e.name} onChange={(ev) => onUpdate(e.id, { name: ev.target.value })}
              aria-label="Envelope name" style={{ ...f, flex: 1, minWidth: 0 }} />
            <span title={over ? "Over the limit" : undefined}
              style={{ width: 78, textAlign: "right", fontSize: 12, fontVariantNumeric: "tabular-nums",
                color: over ? C.amber : C.muted, fontWeight: over ? 700 : 400 }}>
              {over && "⚠ "}{money(spent)}
            </span>
            <LimitInput C={C} font={font} envelope={e}
              onCommit={(cents) => onUpdate(e.id, { limit_cents: cents })} />
            <button style={btn} onClick={() => move(e.id, -1)} disabled={i === 0} aria-label="Move up">↑</button>
            <button style={btn} onClick={() => move(e.id, 1)} disabled={i === live.length - 1} aria-label="Move down">↓</button>
            <button style={{ ...btn, color: C.danger }}
              onClick={() => onUpdate(e.id, { archived: true })}>Archive</button>
          </div>
        );
      })}
      <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
        <input value={name} onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") add(); }}
          placeholder="New envelope" style={{ ...f, flex: 1 }} />
        <button onClick={add} disabled={busy || !name.trim()}
          style={{ ...btn, background: C.accent, color: C.accentInk, borderColor: C.accent,
            fontSize: 13, padding: "7px 14px", opacity: busy || !name.trim() ? 0.5 : 1 }}>Add</button>
      </div>
      <div style={{ fontSize: 12, color: C.muted, marginTop: 12, lineHeight: 1.6 }}>
        A monthly limit turns that envelope's bar into progress against the limit and
        warns you once the month's spending goes past it. Leave it blank to fall back
        to the trailing three-month average instead.
        <br />
        Archiving an envelope hides it from the pickers but keeps every past transaction
        attached to it.
      </div>
    </div>
  );
}
