import React, { useState } from "react";
import { money } from "../../lib/budget/money.js";
import {
  parseCsv, guessColumns, rowsToDrafts, triageDrafts, balanceAnchor, looksUnsigned,
  detectFlip, DEFAULT_TRANSFER_PATTERNS, parseTransferPatterns, matchesTransfer,
} from "../../lib/budget/budget.js";
import { fieldStyle, smallBtn } from "./BudgetForms.jsx";

/**
 * Three steps: pick a file, confirm the column mapping, review what will be
 * inserted. Nothing is written until the last step — a bad mapping silently
 * importing 300 rows is much worse than one extra click.
 */
export function CsvImport({ C, font, accounts, onCheckDuplicates, onImport, onClose }) {
  const [step, setStep] = useState("file");
  const [rows, setRows] = useState([]);
  const [mapping, setMapping] = useState(null);
  const [hasHeader, setHasHeader] = useState(true);
  const [flip, setFlip] = useState(false);
  const [flipAuto, setFlipAuto] = useState(false);
  const [accountId, setAccountId] = useState(accounts.filter((a) => !a.archived)[0]?.id || "");
  const [drafts, setDrafts] = useState([]);
  const [useBalance, setUseBalance] = useState(true);
  const [transferText, setTransferText] = useState(DEFAULT_TRANSFER_PATTERNS);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);

  const f = fieldStyle(C, font);
  const btn = smallBtn(C, font);
  const live = accounts.filter((a) => !a.archived);

  const readFile = (file) => {
    setError(null);
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = parseCsv(String(reader.result || ""));
        if (parsed.length < 2) { setError("That file has no data rows."); return; }
        const guess = guessColumns(parsed[0]);
        /* Only let a direction column drive the sign when the amounts don't
           carry one themselves — on a signed export it would turn refunds
           filed under "DEBIT" into charges. */
        if (!looksUnsigned(parsed.slice(1), guess.amount)) guess.direction = -1;
        const autoFlip = detectFlip(parsed.slice(1), guess);
        setRows(parsed);
        setMapping(guess);
        setFlip(autoFlip);
        setFlipAuto(autoFlip);
        setStep("map");
      } catch {
        setError("Could not read that file.");
      }
    };
    reader.onerror = () => setError("Could not read that file.");
    reader.readAsText(file);
  };

  const buildPreview = async () => {
    setBusy(true); setError(null);
    try {
      const body = hasHeader ? rows.slice(1) : rows;
      const built = rowsToDrafts(body, mapping, accountId,
        { flip, transferPatterns: parseTransferPatterns(transferText) });
      const hashes = built.map((d) => d.import_hash).filter(Boolean);
      const existing = await onCheckDuplicates(hashes);
      setDrafts(triageDrafts(built, existing));
      setStep("review");
    } catch (e) {
      setError(e.message || "Could not build the preview.");
    }
    setBusy(false);
  };

  const commit = async () => {
    const picked = drafts.filter((d) => d.include && !d.problem);
    // Re-importing a file you already loaded leaves nothing new to insert, but
    // reconciling the balance off it is still worth doing on its own.
    if (!picked.length && !(useBalance && anchor)) { setError("Nothing selected."); return; }
    setBusy(true); setError(null);
    try {
      // balance_cents is read off the file to reconcile the account; it is not
      // a column on a transaction and must not travel with the insert.
      const res = await onImport(
        picked.map(({ rowIndex, problem, status, include, balance_cents, pending, ...t }) => t),
        useBalance ? anchor : null,
        accountId);
      setResult(res);
      setStep("done");
    } catch (e) {
      setError(e.message || "Import failed.");
    }
    setBusy(false);
  };

  const header = hasHeader ? rows[0] : rows[0]?.map((_, i) => `Column ${i + 1}`);
  const counts = {
    new: drafts.filter((d) => d.status === "new").length,
    duplicate: drafts.filter((d) => d.status === "duplicate").length,
    repeat: drafts.filter((d) => d.status === "repeat").length,
    pending: drafts.filter((d) => d.status === "pending").length,
    error: drafts.filter((d) => d.status === "error").length,
  };
  const selected = drafts.filter((d) => d.include && !d.problem).length;
  const anchor = balanceAnchor(drafts);
  const accountName = live.find((a) => a.id === accountId)?.name || "this account";
  const canCommit = selected > 0 || (useBalance && !!anchor);

  /* ---------- step: file ---------- */
  if (step === "file") {
    return (
      <div>
        {!live.length ? (
          <div style={{ fontSize: 13, color: C.muted, lineHeight: 1.6 }}>
            Add an account first — imported transactions need somewhere to land.
          </div>
        ) : (
          <>
            <div style={{ marginBottom: 12 }}>
              <span style={{ fontSize: 11, color: C.muted, marginBottom: 4, display: "block" }}>
                Import into
              </span>
              <select value={accountId} onChange={(e) => setAccountId(e.target.value)} style={f}>
                {live.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </div>
            <input type="file" accept=".csv,text/csv"
              onChange={(e) => e.target.files?.[0] && readFile(e.target.files[0])}
              style={{ ...f, padding: 10 }} />
            <div style={{ fontSize: 12, color: C.muted, marginTop: 12, lineHeight: 1.6 }}>
              Export a CSV from your bank. You'll confirm which columns mean what before
              anything is saved, and rows you've already imported are detected and skipped.
            </div>
            {error && <div style={{ fontSize: 12, color: C.danger, marginTop: 10 }}>{error}</div>}
          </>
        )}
      </div>
    );
  }

  /* ---------- step: map ---------- */
  if (step === "map") {
    const options = header.map((h, i) => (
      <option key={i} value={i}>{h || `Column ${i + 1}`}</option>
    ));
    const pick = (key, allowNone) => (
      <select value={mapping[key]} style={f}
        onChange={(e) => setMapping({ ...mapping, [key]: Number(e.target.value) })}>
        {allowNone && <option value={-1}>— none —</option>}
        {options}
      </select>
    );
    const sample = (hasHeader ? rows[1] : rows[0]) || [];

    return (
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
          <input type="checkbox" checked={hasHeader} id="hdr"
            onChange={(e) => setHasHeader(e.target.checked)} />
          <label htmlFor="hdr" style={{ fontSize: 13, cursor: "pointer" }}>
            First row is a header
          </label>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
          <div>
            <span style={{ fontSize: 11, color: C.muted, marginBottom: 4, display: "block" }}>Date</span>
            {pick("date")}
          </div>
          <div>
            <span style={{ fontSize: 11, color: C.muted, marginBottom: 4, display: "block" }}>Payee</span>
            {pick("payee", true)}
          </div>
        </div>

        <div style={{ marginBottom: 12 }}>
          <span style={{ fontSize: 11, color: C.muted, marginBottom: 4, display: "block" }}>
            Amount — one signed column
          </span>
          {pick("amount", true)}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
          <div>
            <span style={{ fontSize: 11, color: C.muted, marginBottom: 4, display: "block" }}>
              …or Debit
            </span>
            {pick("debit", true)}
          </div>
          <div>
            <span style={{ fontSize: 11, color: C.muted, marginBottom: 4, display: "block" }}>
              …and Credit
            </span>
            {pick("credit", true)}
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
          <div>
            <span style={{ fontSize: 11, color: C.muted, marginBottom: 4, display: "block" }}>
              Direction — for exports whose amounts have no sign
            </span>
            {pick("direction", true)}
          </div>
          <div>
            <span style={{ fontSize: 11, color: C.muted, marginBottom: 4, display: "block" }}>
              Status — to hold back pending rows
            </span>
            {pick("status", true)}
          </div>
        </div>

        <div style={{ marginBottom: 12 }}>
          <span style={{ fontSize: 11, color: C.muted, marginBottom: 4, display: "block" }}>
            Running balance — optional, used to set this account's opening balance
          </span>
          {pick("balance", true)}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
          <input type="checkbox" checked={flip} id="flip"
            onChange={(e) => { setFlip(e.target.checked); setFlipAuto(false); }} />
          <label htmlFor="flip" style={{ fontSize: 13, cursor: "pointer" }}>
            Flip signs — my export writes spending as positive
          </label>
          {flipAuto && (
            <span style={{ fontSize: 11, color: C.accent }}>
              set automatically — this file's payment rows are negative
            </span>
          )}
        </div>

        <div style={{ background: C.bg, borderRadius: 8, padding: 12, marginBottom: 14 }}>
          <div style={{ fontSize: 11, color: C.muted, marginBottom: 6 }}>First data row</div>
          <div style={{ fontSize: 12, fontFamily: font, wordBreak: "break-all" }}>
            {sample.map((cell, i) => (
              <span key={i} style={{ marginRight: 10,
                color: Object.values(mapping).includes(i) ? C.accent : C.muted }}>{cell}</span>
            ))}
          </div>
        </div>

        {error && <div style={{ fontSize: 12, color: C.danger, marginBottom: 10 }}>{error}</div>}
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={buildPreview} disabled={busy}
            style={{ ...btn, background: C.accent, color: C.accentInk, borderColor: C.accent,
              fontSize: 13, padding: "8px 16px", opacity: busy ? 0.6 : 1 }}>
            {busy ? "Checking…" : "Preview"}
          </button>
          <button onClick={() => setStep("file")} style={{ ...btn, fontSize: 13, padding: "8px 14px" }}>
            Back
          </button>
        </div>
      </div>
    );
  }

  /* ---------- step: review ---------- */
  if (step === "review") {
    const tint = { new: C.ink, duplicate: C.muted, repeat: C.muted, pending: C.amber, error: C.danger };
    /* Re-tagging transfers only changes `kind`, which no hash or duplicate
       check depends on, so it can be reapplied without rebuilding the preview. */
    const retag = (text) => {
      setTransferText(text);
      const pats = parseTransferPatterns(text);
      setDrafts((xs) => xs.map((d) => (
        { ...d, kind: matchesTransfer(d.payee, pats) ? "transfer" : "normal" })));
    };
    const transferCount = drafts.filter((d) => d.kind === "transfer").length;

    return (
      <div>
        <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginBottom: 12, fontSize: 12 }}>
          <span><strong>{counts.new}</strong> new</span>
          {counts.duplicate > 0 && <span style={{ color: C.muted }}>{counts.duplicate} already imported</span>}
          {counts.repeat > 0 && <span style={{ color: C.muted }}>{counts.repeat} repeated in file</span>}
          {counts.pending > 0 && <span style={{ color: C.amber }}>{counts.pending} pending — held back</span>}
          {counts.error > 0 && <span style={{ color: C.danger }}>{counts.error} unreadable</span>}
        </div>

        <div style={{ marginBottom: 12 }}>
          <span style={{ fontSize: 11, color: C.muted, marginBottom: 4, display: "block" }}>
            Treat as transfers, not income or spending — {transferCount} of {drafts.length} rows match
          </span>
          <input value={transferText} onChange={(e) => retag(e.target.value)}
            aria-label="Transfer keywords" placeholder="comma-separated words"
            style={{ ...f, fontSize: 12 }} />
        </div>

        <div style={{ maxHeight: 300, overflowY: "auto", border: `1px solid ${C.border}`,
          borderRadius: 8, marginBottom: 14 }}>
          {drafts.map((d, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 10px",
              borderBottom: i < drafts.length - 1 ? `1px solid ${C.border}` : "none",
              opacity: d.problem ? 0.65 : 1 }}>
              <input type="checkbox" checked={d.include} disabled={!!d.problem}
                onChange={(e) => setDrafts(drafts.map((x, j) =>
                  j === i ? { ...x, include: e.target.checked } : x))} />
              <span style={{ fontSize: 12, color: C.muted, width: 82, flexShrink: 0 }}>
                {d.date || "—"}
              </span>
              <span style={{ fontSize: 12, flex: 1, minWidth: 0, color: tint[d.status],
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {d.payee || "(no payee)"}
                {d.problem && <span style={{ color: C.danger }}> · {d.problem}</span>}
                {d.status === "duplicate" && <span style={{ color: C.muted }}> · already imported</span>}
                {d.status === "repeat" && <span style={{ color: C.muted }}> · repeat</span>}
                {d.status === "pending" && <span style={{ color: C.amber }}> · pending</span>}
              </span>
              <button
                onClick={() => setDrafts(drafts.map((x, j) => (
                  j === i ? { ...x, kind: x.kind === "transfer" ? "normal" : "transfer" } : x)))}
                title={d.kind === "transfer" ? "Counted as a transfer" : "Counted as income or spending"}
                style={{ ...btn, flexShrink: 0, padding: "2px 7px", fontSize: 11,
                  border: `1px solid ${d.kind === "transfer" ? C.accent : C.border}`,
                  color: d.kind === "transfer" ? C.accent : C.muted }}>⇄</button>
              <span style={{ fontSize: 12, fontVariantNumeric: "tabular-nums", flexShrink: 0,
                color: d.kind === "transfer" ? C.muted : d.amount_cents > 0 ? C.accent : C.ink }}>
                {d.amount_cents == null ? "—" : money(d.amount_cents)}
              </span>
            </div>
          ))}
        </div>

        {anchor && (
          <div style={{ display: "flex", alignItems: "flex-start", gap: 8, marginBottom: 14,
            padding: "10px 12px", borderRadius: 8, background: C.bg }}>
            <input type="checkbox" checked={useBalance} id="usebal"
              onChange={(e) => setUseBalance(e.target.checked)} style={{ marginTop: 2 }} />
            <label htmlFor="usebal" style={{ fontSize: 12.5, cursor: "pointer", lineHeight: 1.6 }}>
              Set the opening balance so <strong>{accountName}</strong> reads{" "}
              <strong>{money(anchor.balance_cents)}</strong> on {anchor.date}, matching the
              running balance in the file.
            </label>
          </div>
        )}

        {error && <div style={{ fontSize: 12, color: C.danger, marginBottom: 10 }}>{error}</div>}
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button onClick={commit} disabled={busy || !canCommit}
            style={{ ...btn, background: C.accent, color: C.accentInk, borderColor: C.accent,
              fontSize: 13, padding: "8px 16px", opacity: busy || !canCommit ? 0.5 : 1 }}>
            {busy ? "Importing…"
              : selected ? `Import ${selected}`
              : "Set balance only"}
          </button>
          <button onClick={() => setStep("map")} style={{ ...btn, fontSize: 13, padding: "8px 14px" }}>
            Back
          </button>
          <div style={{ flex: 1 }} />
          <span style={{ fontSize: 11, color: C.muted }}>Everything lands unassigned — sort it after.</span>
        </div>
      </div>
    );
  }

  /* ---------- step: done ---------- */
  return (
    <div>
      <div style={{ fontSize: 14, marginBottom: 8 }}>
        Imported <strong>{result?.inserted ?? 0}</strong> transaction{result?.inserted === 1 ? "" : "s"}.
      </div>
      {result?.skipped > 0 && (
        <div style={{ fontSize: 12, color: C.muted, marginBottom: 12 }}>
          {result.skipped} skipped as duplicates.
        </div>
      )}
      {result?.balanceSet != null && (
        <div style={{ fontSize: 12, color: C.muted, marginBottom: 12, lineHeight: 1.6 }}>
          Balance reconciled to {money(result.balanceSet)} — opening balance set to{" "}
          {money(result.startingCents)}.
        </div>
      )}
      <button onClick={onClose}
        style={{ ...btn, background: C.accent, color: C.accentInk, borderColor: C.accent,
          fontSize: 13, padding: "8px 16px" }}>Done</button>
    </div>
  );
}
