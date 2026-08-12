import { sumCents, parseMoney } from "./money.js";

/* ---------- months ---------- */

export const monthOf = (dateKey) => (dateKey || "").slice(0, 7);

export function shiftMonth(month, delta) {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function currentMonth(now = new Date()) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"];

export function monthLabel(month) {
  const [y, m] = month.split("-").map(Number);
  return `${MONTH_NAMES[m - 1]} ${y}`;
}

/* ---------- transaction classification ----------
   Three kinds, and the distinction drives every total below:
     normal   — real income or spending, belongs to an envelope
     transfer — moving money between own accounts, neither income nor expense
     starting — pre-existing balance, history that predates budgeting
*/

export const isSpending = (t) => t.kind === "normal" && t.amount_cents < 0;
export const isIncome = (t) => t.kind === "normal" && t.amount_cents > 0;

/* ---------- balances ---------- */

/**
 * What one row does to one account's balance.
 *
 * A transfer is stored as a single row on the account the money left, so the
 * receiving account only sees it through transfer_account_id — paying a credit
 * card off checking has to reduce the card's debt, not just the checking
 * balance. Summing account_id alone silently drops that half.
 */
export function balanceDelta(accountId, t) {
  if (t.account_id === accountId) return t.amount_cents;
  if (t.kind === "transfer" && t.transfer_account_id === accountId) return -t.amount_cents;
  return 0;
}

/** Account balance is simply every row touching it, starting rows included. */
export function accountBalance(accountId, transactions) {
  return sumCents(transactions.map((t) => balanceDelta(accountId, t)));
}

export function accountBalances(accounts, transactions) {
  const byAccount = new Map(accounts.map((a) => [a.id, 0]));
  transactions.forEach((t) => {
    if (byAccount.has(t.account_id)) {
      byAccount.set(t.account_id, byAccount.get(t.account_id) + t.amount_cents);
    }
    if (t.kind === "transfer" && byAccount.has(t.transfer_account_id)) {
      byAccount.set(t.transfer_account_id, byAccount.get(t.transfer_account_id) - t.amount_cents);
    }
  });
  return byAccount;
}

/** Net worth splits on-budget from tracking accounts. */
export function netWorth(accounts, transactions) {
  const bal = accountBalances(accounts, transactions);
  let onBudget = 0, offBudget = 0, debt = 0;
  accounts.forEach((a) => {
    if (a.archived) return;
    const v = bal.get(a.id) || 0;
    if (a.kind === "credit") debt += v;
    if (a.on_budget) onBudget += v; else offBudget += v;
  });
  return { onBudget, offBudget, debt, total: onBudget + offBudget };
}

/* ---------- month rollups ---------- */

/**
 * Everything the month view needs, from that month's transactions alone.
 * Transfers and starting balances are excluded from income/spent — moving
 * your own money between accounts is not income, and neither is history.
 */
export function monthSummary(transactions) {
  const income = sumCents(transactions.filter(isIncome).map((t) => t.amount_cents));
  const spent = sumCents(transactions.filter(isSpending).map((t) => t.amount_cents));
  return {
    income,
    spent: -spent,               // report spending as a positive magnitude
    net: income + spent,
    count: transactions.length,
  };
}

/** Spending per envelope for one month, biggest first. Income is excluded. */
export function envelopeSpending(envelopes, transactions) {
  const byEnvelope = new Map();
  transactions.filter(isSpending).forEach((t) => {
    const key = t.envelope_id || "__unassigned";
    byEnvelope.set(key, (byEnvelope.get(key) || 0) - t.amount_cents);
  });
  const rows = envelopes
    .filter((e) => e.kind !== "payment")
    .map((e) => ({ envelope: e, spent: byEnvelope.get(e.id) || 0 }))
    .filter((r) => r.spent > 0 || !r.envelope.archived);
  const unassigned = byEnvelope.get("__unassigned") || 0;
  if (unassigned > 0) {
    rows.push({ envelope: { id: "__unassigned", name: "Unassigned", icon: "❓" }, spent: unassigned });
  }
  return rows.sort((a, b) => b.spent - a.spent);
}

/**
 * Phase 1 has no allocations, so bars need a reference. Use each envelope's
 * mean monthly spend over the trailing months we have summary data for.
 * Phase 2 replaces this with the real allocation.
 */
export function baselineFor(envelopeId, monthlyTotals, upToMonth, lookback = 3) {
  const months = [];
  for (let i = 1; i <= lookback; i++) months.push(shiftMonth(upToMonth, -i));
  const vals = months
    .map((m) => monthlyTotals.get(`${envelopeId}|${m}`))
    .filter((v) => v != null && v > 0);
  if (!vals.length) return null;
  return Math.round(sumCents(vals) / vals.length);
}

/** Compact `envelope|month -> spent` index built from the aggregate query. */
export function indexMonthlyTotals(rows) {
  const map = new Map();
  rows.forEach((r) => {
    if (r.total_cents >= 0) return;             // spending only
    map.set(`${r.envelope_id}|${r.month}`, -r.total_cents);
  });
  return map;
}

/* ---------- CSV ---------- */

/** RFC4180-ish parser: handles quoted fields, embedded commas and "" escapes. */
export function parseCsv(text) {
  const rows = [];
  let row = [], field = "", quoted = false, i = 0;
  const src = text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  while (i < src.length) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') { field += '"'; i += 2; continue; }
        quoted = false; i++; continue;
      }
      field += c; i++; continue;
    }
    if (c === '"') { quoted = true; i++; continue; }
    if (c === ",") { row.push(field); field = ""; i++; continue; }
    if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; i++; continue; }
    field += c; i++;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((f) => f.trim() !== ""));
}

/** Guess which columns hold what, so the mapping UI opens pre-filled. */
export function guessColumns(header) {
  const norm = header.map((h) => h.toLowerCase().trim());
  const find = (...pats) =>
    norm.findIndex((h) => pats.some((p) => h.includes(p)));
  return {
    date: find("date", "posted", "transaction date"),
    payee: find("description", "payee", "merchant", "name", "memo"),
    amount: find("amount", "value"),
    debit: find("debit", "withdrawal"),
    credit: find("deposit", "credit"),
    note: find("note", "memo", "reference"),
  };
}

/**
 * Normalise a date cell to YYYY-MM-DD.
 * Ambiguous numeric dates are read US-first (MM/DD/YYYY) unless the first
 * component is clearly > 12, since that's the dominant export format here.
 */
export function normalizeDate(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  m = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})/);
  if (m) {
    let [, a, b, y] = m;
    if (y.length === 2) y = String(2000 + Number(y));
    let month = a, day = b;
    if (Number(a) > 12 && Number(b) <= 12) { month = b; day = a; }
    return `${y}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }
  return null;
}

/**
 * Stable dedupe key. Same date + amount + payee from the same account is
 * treated as the same transaction, so overlapping exports can't double up.
 * Deliberately excludes note and envelope, which the user may edit later.
 */
export function importHash(accountId, dateKey, amountCents, payee) {
  const norm = (payee || "").toLowerCase().replace(/\s+/g, " ").trim().slice(0, 40);
  const raw = `${accountId}|${dateKey}|${amountCents}|${norm}`;
  let h = 5381;
  for (let i = 0; i < raw.length; i++) h = ((h * 33) ^ raw.charCodeAt(i)) >>> 0;
  return `${h.toString(36)}-${raw.length.toString(36)}`;
}

/**
 * Turn parsed rows into draft transactions.
 * `flip` handles exports where outflows are written positive.
 */
export function rowsToDrafts(rows, mapping, accountId, { flip = false } = {}) {
  const out = [];
  rows.forEach((cells, idx) => {
    const dateKey = normalizeDate(cells[mapping.date]);
    let cents = null;
    if (mapping.amount >= 0 && cells[mapping.amount] != null && cells[mapping.amount] !== "") {
      cents = parseMoney(cells[mapping.amount]);
    } else {
      const debit = mapping.debit >= 0 ? parseMoney(cells[mapping.debit]) : null;
      const credit = mapping.credit >= 0 ? parseMoney(cells[mapping.credit]) : null;
      if (debit) cents = -Math.abs(debit);
      else if (credit) cents = Math.abs(credit);
    }
    if (cents != null && flip) cents = -cents;
    const payee = mapping.payee >= 0 ? String(cells[mapping.payee] || "").trim() : "";
    const note = mapping.note >= 0 && mapping.note !== mapping.payee
      ? String(cells[mapping.note] || "").trim() : "";

    const problem = !dateKey ? "unreadable date" : cents == null ? "unreadable amount" : null;
    out.push({
      rowIndex: idx,
      date: dateKey,
      amount_cents: cents,
      payee,
      note,
      account_id: accountId,
      envelope_id: null,
      kind: "normal",
      import_hash: dateKey && cents != null ? importHash(accountId, dateKey, cents, payee) : null,
      problem,
      include: !problem,
    });
  });
  return out;
}

/** Split drafts into new / duplicate-within-file / already-imported. */
export function triageDrafts(drafts, existingHashes) {
  const seen = new Set();
  return drafts.map((d) => {
    if (d.problem) return { ...d, status: "error" };
    if (existingHashes.has(d.import_hash)) return { ...d, status: "duplicate", include: false };
    if (seen.has(d.import_hash)) return { ...d, status: "repeat", include: false };
    seen.add(d.import_hash);
    return { ...d, status: "new" };
  });
}
