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

/**
 * Income is money arriving with no envelope on it — a salary, a gift.
 *
 * A positive amount that *does* carry an envelope is a refund: returning the
 * groceries you bought is not income, it is the grocery spending coming back.
 * Treating it as income both inflates earnings and leaves the envelope showing
 * the gross figure, so a returned purchase can push it over its limit.
 */
export const isIncome = (t) => t.kind === "normal" && t.amount_cents > 0 && !t.envelope_id;

/** Everything else that moves real money: outflows, and refunds against them. */
export const isSpending = (t) => t.kind === "normal" && !isIncome(t);

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
    balance: find("balance"),
    // Exports that carry the magnitude in one column and the direction in
    // another (Capital One writes every amount positive and puts Credit/Debit
    // in "Transaction Type"). Deliberately not matched on "transaction", which
    // would collide with "Transaction Description".
    direction: find("transaction type", "debit/credit", "dr/cr", "type", "details"),
    status: find("status"),
  };
}

/**
 * True when nothing in the amount column is negative — the signature of an
 * export that relies on a separate direction column. Used to decide whether
 * to switch that mapping on by default, since forcing a sign on an already
 * signed file would flip legitimate refunds the wrong way.
 */
export function looksUnsigned(rows, amountIndex) {
  if (amountIndex < 0) return false;
  let sawNumber = false;
  for (const cells of rows) {
    const c = parseMoney(cells[amountIndex]);
    if (c == null) continue;
    if (c < 0) return false;
    sawNumber = true;
  }
  return sawNumber;
}

const DEBIT_WORDS = /debit|withdraw|\bdr\b|w\/d/i;
const CREDIT_WORDS = /credit|deposit|\bcr\b/i;

/* Phrases only a card issuer writes, and only for money coming *in* to the
   card: paying it off, a statement credit, redeemed rewards. A bank never
   thanks you on a checking statement — "DISCOVER E-PAYMENT" leaving a current
   account carries no such wording — which is what makes these safe to read a
   sign convention from. */
const CARD_CREDIT = /thank\s*you|cashback bonus|statement credit|points redeemed/i;

/**
 * Whether the export writes spending as positive, i.e. needs its signs flipped.
 *
 * Decided from rows that can only ever be a credit to the card. If those come
 * through negative, every sign in the file is the wrong way round. Files with
 * no such row — every current account here — return false and are left alone.
 */
export function detectFlip(rows, mapping) {
  if (!mapping || mapping.amount < 0) return false;   // debit/credit columns carry their own sign
  const marks = [];
  rows.forEach((cells) => {
    const payee = mapping.payee >= 0 ? String(cells[mapping.payee] || "") : "";
    if (!CARD_CREDIT.test(payee)) return;
    const c = parseMoney(cells[mapping.amount]);
    if (c) marks.push(c);
  });
  if (!marks.length) return false;
  return marks.filter((c) => c < 0).length > marks.length / 2;
}

/* Phrases that mean "my own money moved between my own accounts" rather than
   income or spending. Both halves of such a move usually get imported from two
   different exports, which otherwise invents an expense and a matching income. */
export const DEFAULT_TRANSFER_PATTERNS = [
  "transfer", "instant pmt", "real time payment", "dda to dda",
  "ach pmt", "epay", "e-payment", "autopay", "web pymt", "cardmember serv",
  "online payment", "internet payment", "mobile payment", "payment thank you",
  "card online payment", "payment to chase card",
].join(", ");

export function parseTransferPatterns(text) {
  return String(text || "")
    .split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
}

export function matchesTransfer(payee, patterns) {
  if (!patterns.length) return false;
  const p = String(payee || "").toLowerCase();
  return patterns.some((pat) => p.includes(pat));
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
export function importHash(accountId, dateKey, amountCents, payee, seq = 0) {
  const norm = (payee || "").toLowerCase().replace(/\s+/g, " ").trim().slice(0, 40);
  /* `seq` distinguishes genuinely repeated purchases — two identical train
     fares bought the same day are two transactions, not a double-import. It is
     stable across overlapping exports because a day's rows come as a set.
     Occurrence 0 is left unsuffixed so hashes written before this existed still
     match and don't re-import. */
  const base = `${accountId}|${dateKey}|${amountCents}|${norm}`;
  const raw = seq > 0 ? `${base}|#${seq}` : base;
  let h = 5381;
  for (let i = 0; i < raw.length; i++) h = ((h * 33) ^ raw.charCodeAt(i)) >>> 0;
  return `${h.toString(36)}-${raw.length.toString(36)}`;
}

/**
 * Turn parsed rows into draft transactions.
 * `flip` handles exports where outflows are written positive.
 */
export function rowsToDrafts(rows, mapping, accountId, { flip = false, transferPatterns = [] } = {}) {
  const out = [];
  const seenKey = new Map();          // how many identical rows we've passed
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

    /* A mapped direction column is authoritative — it is the only thing that
       carries the sign in exports that write every amount positive. */
    if (cents != null && mapping.direction >= 0) {
      const dir = String(cells[mapping.direction] || "");
      if (DEBIT_WORDS.test(dir)) cents = -Math.abs(cents);
      else if (CREDIT_WORDS.test(dir)) cents = Math.abs(cents);
    }

    const payee = mapping.payee >= 0 ? String(cells[mapping.payee] || "").trim() : "";
    const note = mapping.note >= 0 && mapping.note !== mapping.payee
      ? String(cells[mapping.note] || "").trim() : "";

    const balance = mapping.balance >= 0 ? parseMoney(cells[mapping.balance]) : null;

    const problem = !dateKey ? "unreadable date" : cents == null ? "unreadable amount" : null;

    // Nth identical row of the day, so repeated purchases keep distinct hashes.
    let seq = 0;
    if (!problem) {
      const key = `${dateKey}|${cents}|${payee.toLowerCase()}`;
      seq = seenKey.get(key) || 0;
      seenKey.set(key, seq + 1);
    }

    const statusCell = mapping.status >= 0 ? String(cells[mapping.status] || "") : "";
    const pending = /pending|processing|unposted|in progress/i.test(statusCell);
    const isTransfer = matchesTransfer(payee, transferPatterns);

    out.push({
      rowIndex: idx,
      date: dateKey,
      amount_cents: cents,
      balance_cents: balance,
      payee,
      note,
      account_id: accountId,
      envelope_id: null,
      transfer_account_id: null,
      kind: isTransfer ? "transfer" : "normal",
      import_hash: problem ? null : importHash(accountId, dateKey, cents, payee, seq),
      problem,
      pending,
      include: !problem && !pending,
    });
  });
  return out;
}

/**
 * The running-balance figure to trust out of a bank export: the one attached
 * to the newest transaction in the file.
 *
 * Exports come both ways round, and several rows can share the newest date, so
 * the file's own direction decides which of those to take — the last of them
 * when the file runs oldest-first, the first when it runs newest-first. Either
 * way the aim is the balance *after* the final movement of that day.
 */
export function balanceAnchor(drafts) {
  const usable = drafts.filter((d) => d.date && d.balance_cents != null && !d.problem);
  if (!usable.length) return null;
  const descending = usable[0].date > usable[usable.length - 1].date;
  const maxDate = usable.reduce((m, d) => (d.date > m ? d.date : m), usable[0].date);
  const onMax = usable.filter((d) => d.date === maxDate);
  const pick = descending ? onMax[0] : onMax[onMax.length - 1];
  return { date: pick.date, balance_cents: pick.balance_cents };
}

/**
 * The starting-balance row an account needs so that its balance on `asOf`
 * equals what the bank says. Everything already in the ledger up to that date
 * counts against it, so this is the gap the pre-history has to fill.
 */
export function startingAdjustment(accountId, asOfBalanceCents, rowsThrough) {
  const known = sumCents(rowsThrough
    .filter((t) => t.kind !== "starting")
    .map((t) => balanceDelta(accountId, t)));
  return asOfBalanceCents - known;
}

/** Split drafts into new / duplicate-within-file / already-imported. */
export function triageDrafts(drafts, existingHashes) {
  const seen = new Set();
  return drafts.map((d) => {
    if (d.problem) return { ...d, status: "error" };
    // Unposted rows can still change date or amount before they settle, which
    // would give them a different hash and import a second copy.
    if (d.pending) return { ...d, status: "pending", include: false };
    if (existingHashes.has(d.import_hash)) return { ...d, status: "duplicate", include: false };
    if (seen.has(d.import_hash)) return { ...d, status: "repeat", include: false };
    seen.add(d.import_hash);
    return { ...d, status: "new" };
  });
}
