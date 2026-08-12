/* Local-only budget, for offline mode and for exercising the UI before any
   cloud tables exist. Mirrors budgetStore.js call for call — same names, same
   argument order, same shapes — so BudgetView can swap one for the other and
   nothing downstream knows the difference.

   The two SQL aggregates (budget_monthly_totals, budget_account_totals) are
   reimplemented here over the whole local ledger. That is fine at local
   volumes; the cloud path keeps them server-side for a reason. */

const LOCAL_KEY = "altitude-budget-v1";

const EMPTY = { accounts: [], envelopes: [], transactions: [], paycheck: null };

function read() {
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    if (!raw) return { ...EMPTY };
    const db = JSON.parse(raw);
    return { ...EMPTY, ...db };
  } catch {
    return { ...EMPTY };
  }
}

function write(db) {
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(db));
  } catch (e) {
    console.error("budget: local save failed", e);
    throw new Error("Could not save to this device's storage.");
  }
  return db;
}

const uid = () =>
  (crypto.randomUUID?.() ?? `b-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`);

/* Postgres hands back ISO strings; match that so date ordering and any
   downstream string compare behaves identically to the cloud path. */
const now = () => new Date().toISOString();

const bySort = (a, b) =>
  (a.sort_order ?? 0) - (b.sort_order ?? 0) || String(a.created_at).localeCompare(String(b.created_at));

/* ---------------- accounts ---------------- */

export async function listAccounts() {
  return read().accounts.slice().sort(bySort);
}

export async function createAccount(userId, account) {
  const db = read();
  const row = {
    id: uid(), name: "", kind: "checking", on_budget: true, archived: false,
    sort_order: 0, ...account, created_at: now(),
  };
  db.accounts.push(row);
  write(db);
  return row;
}

export async function updateAccount(id, patch) {
  const db = read();
  const row = db.accounts.find((a) => a.id === id);
  if (!row) throw new Error("Account not found.");
  Object.assign(row, patch);
  write(db);
  return row;
}

/* ---------------- envelopes ---------------- */

export async function listEnvelopes() {
  return read().envelopes.slice().sort(bySort);
}

export async function createEnvelope(userId, envelope) {
  const db = read();
  const row = {
    id: uid(), name: "", icon: null, kind: "normal", linked_account_id: null,
    archived: false, sort_order: 0, limit_cents: null, ...envelope, created_at: now(),
  };
  db.envelopes.push(row);
  write(db);
  return row;
}

export async function updateEnvelope(id, patch) {
  const db = read();
  const row = db.envelopes.find((e) => e.id === id);
  if (!row) throw new Error("Envelope not found.");
  Object.assign(row, patch);
  write(db);
  return row;
}

/* ---------------- transactions ---------------- */

const lastDayOf = (month) => {
  const [y, m] = month.split("-").map(Number);
  return new Date(y, m, 0).getDate();
};

export async function listMonth(userId, month) {
  const from = `${month}-01`;
  const to = `${month}-${String(lastDayOf(month)).padStart(2, "0")}`;
  return read().transactions
    .filter((t) => t.date >= from && t.date <= to)
    .sort((a, b) =>
      String(b.date).localeCompare(String(a.date)) ||
      String(b.created_at).localeCompare(String(a.created_at)));
}

export async function listStarting() {
  return read().transactions.filter((t) => t.kind === "starting");
}

/** Same grouping as budget_monthly_totals(): normal rows, by envelope and month. */
export async function monthlyTotals() {
  const totals = new Map();
  read().transactions.forEach((t) => {
    if (t.kind !== "normal") return;
    const key = `${t.envelope_id}|${t.date.slice(0, 7)}`;
    totals.set(key, (totals.get(key) || 0) + t.amount_cents);
  });
  return [...totals.entries()].map(([key, total_cents]) => {
    const cut = key.lastIndexOf("|");
    const envelope_id = key.slice(0, cut);
    return {
      envelope_id: envelope_id === "null" ? null : envelope_id,
      month: key.slice(cut + 1),
      total_cents,
    };
  });
}

/**
 * Same grouping as budget_account_totals(): every row, by account — counting
 * both ends of a transfer, since a transfer is one row and the receiving
 * account only appears on it as transfer_account_id.
 */
export async function accountTotals() {
  const totals = new Map();
  const bump = (id, cents) => id && totals.set(id, (totals.get(id) || 0) + cents);
  read().transactions.forEach((t) => {
    bump(t.account_id, t.amount_cents);
    if (t.kind === "transfer") bump(t.transfer_account_id, -t.amount_cents);
  });
  return [...totals.entries()].map(([account_id, total_cents]) => ({ account_id, total_cents }));
}

export async function createTransaction(userId, tx) {
  const db = read();
  const row = {
    id: uid(), envelope_id: null, transfer_account_id: null, payee: null, note: null,
    kind: "normal", cleared: false, import_hash: null, ...tx, created_at: now(),
  };
  db.transactions.push(row);
  write(db);
  return row;
}

export async function updateTransaction(id, patch) {
  const db = read();
  const row = db.transactions.find((t) => t.id === id);
  if (!row) throw new Error("Transaction not found.");
  Object.assign(row, patch);
  write(db);
  return row;
}

export async function deleteTransaction(id) {
  const db = read();
  db.transactions = db.transactions.filter((t) => t.id !== id);
  write(db);
}

/** Mirrors the cloud upsert: rows whose import_hash already exists are skipped. */
export async function importTransactions(userId, rows) {
  const db = read();
  const seen = new Set(db.transactions.map((t) => t.import_hash).filter(Boolean));
  let inserted = 0, skipped = 0;
  rows.forEach((r) => {
    if (r.import_hash && seen.has(r.import_hash)) { skipped++; return; }
    if (r.import_hash) seen.add(r.import_hash);
    db.transactions.push({
      id: uid(), envelope_id: null, transfer_account_id: null, payee: null, note: null,
      kind: "normal", cleared: false, import_hash: null, ...r, created_at: now(),
    });
    inserted++;
  });
  write(db);
  return { inserted, skipped };
}

export async function existingHashes(userId, hashes) {
  if (!hashes.length) return new Set();
  const mine = new Set(read().transactions.map((t) => t.import_hash).filter(Boolean));
  return new Set(hashes.filter((h) => mine.has(h)));
}

/* ---------------- paycheck ---------------- */

export async function getPaycheck() {
  return read().paycheck || null;
}

export async function savePaycheck(userId, config) {
  const db = read();
  db.paycheck = {
    payee: config.payee || "Paycheck",
    start_date: config.start_date || null,
    pay_days: config.pay_days || [],
    splits: config.splits || [],
  };
  write(db);
  return db.paycheck;
}

/* ---------------- first run ---------------- */

export const STARTER_ENVELOPES = [
  { name: "Rent", icon: "🏠" }, { name: "Groceries", icon: "🛒" },
  { name: "Gas", icon: "🚗" }, { name: "Eating out", icon: "🍜" },
  { name: "Utilities", icon: "⚡" }, { name: "Fun", icon: "🎬" },
];

export async function seedBudget(userId) {
  const account = await createAccount(userId, {
    name: "Checking", kind: "checking", on_budget: true, sort_order: 0,
  });
  const envelopes = [];
  for (let i = 0; i < STARTER_ENVELOPES.length; i++) {
    envelopes.push(await createEnvelope(userId, {
      ...STARTER_ENVELOPES[i], kind: "normal", sort_order: i,
    }));
  }
  return { account, envelopes };
}

/* ---------------- sample data ---------------- */

/* Seeded so a reload reproduces the same ledger — when the point is checking
   whether a bar or a total renders correctly, the numbers must not move
   underneath you between refreshes. */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SAMPLE_ACCOUNTS = [
  { name: "Checking", kind: "checking", on_budget: true, starting: 240000 },
  { name: "Savings", kind: "savings", on_budget: true, starting: 600000 },
  { name: "Visa", kind: "credit", on_budget: true, starting: -32000 },
];

/* Monthly limits for the sample. Groceries and Eating out are set deliberately
   tight so the over-limit warning fires on load; Gas and Fun are left unset so
   the trailing-average fallback is visible in the same list. */
const SAMPLE_LIMITS = {
  Rent: 170000, Groceries: 35000, "Eating out": 20000, Utilities: 18000,
};

/* count/day/amount are [min, max] inclusive; amounts in cents, before sign. */
const SAMPLE_SPEND = [
  { envelope: "Rent", account: "Checking", count: [1, 1], day: [1, 3], amount: [165000, 165000],
    payees: ["Fairview Apartments"] },
  { envelope: "Groceries", account: "Visa", count: [4, 6], day: [2, 28], amount: [3200, 11500],
    payees: ["Trader Joe's", "Safeway", "Costco", "Whole Foods", "Corner Market"] },
  { envelope: "Gas", account: "Visa", count: [2, 3], day: [3, 27], amount: [3400, 6200],
    payees: ["Shell", "Chevron", "Costco Gas"] },
  { envelope: "Eating out", account: "Visa", count: [3, 6], day: [1, 28], amount: [1200, 7800],
    payees: ["Thai Basil", "Blue Bottle", "Pizzeria Delfina", "Chipotle", "Sushi Ran", "Taqueria"] },
  { envelope: "Utilities", account: "Checking", count: [2, 2], day: [8, 18], amount: [4200, 13500],
    payees: ["PG&E", "Comcast", "City Water"] },
  { envelope: "Fun", account: "Checking", count: [1, 3], day: [5, 26], amount: [1500, 9000],
    payees: ["AMC Theatres", "Steam", "Spotify", "Bandcamp"] },
];

/**
 * Four months of a plausible ledger: the current month plus the three before
 * it, which is exactly the lookback baselineFor() averages over, so the
 * envelope bars have something to measure against on first render.
 *
 * The current month is generated only up to today, and `Eating out` is run
 * deliberately hot, so both the normal and the over-baseline bar states are
 * visible without having to enter anything by hand.
 */
export async function seedSampleBudget(userId, { months = 4, seed = 20260811 } = {}) {
  const rand = rng(seed);
  const pick = (list) => list[Math.floor(rand() * list.length)];
  const between = ([lo, hi]) => lo + Math.floor(rand() * (hi - lo + 1));

  const today = new Date();
  const thisMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;
  const monthAt = (delta) => {
    const d = new Date(today.getFullYear(), today.getMonth() + delta, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  };

  const db = { ...EMPTY };
  let seq = 0;
  const stamp = () => new Date(Date.now() + seq++).toISOString();

  const accounts = SAMPLE_ACCOUNTS.map((a, i) => ({
    id: uid(), name: a.name, kind: a.kind, on_budget: a.on_budget,
    archived: false, sort_order: i, created_at: stamp(),
  }));
  const envelopes = STARTER_ENVELOPES.map((e, i) => ({
    id: uid(), ...e, kind: "normal", linked_account_id: null,
    archived: false, sort_order: i, limit_cents: SAMPLE_LIMITS[e.name] ?? null,
    created_at: stamp(),
  }));
  db.accounts = accounts;
  db.envelopes = envelopes;

  const acct = (name) => accounts.find((a) => a.name === name).id;
  const env = (name) => envelopes.find((e) => e.name === name).id;

  const add = (tx) => db.transactions.push({
    id: uid(), envelope_id: null, transfer_account_id: null, payee: null, note: null,
    kind: "normal", cleared: true, import_hash: null, ...tx, created_at: stamp(),
  });

  const oldest = monthAt(-(months - 1));
  SAMPLE_ACCOUNTS.forEach((a) => {
    if (!a.starting) return;
    add({
      account_id: acct(a.name), date: `${oldest}-01`, amount_cents: a.starting,
      payee: "Starting balance", kind: "starting",
    });
  });

  for (let i = months - 1; i >= 0; i--) {
    const month = monthAt(-i);
    const isCurrent = month === thisMonth;
    // Only the days that have actually happened, so the current month reads
    // as partial rather than as a suspiciously cheap full month.
    const maxDay = isCurrent ? today.getDate() : lastDayOf(month);
    const on = (day) => `${month}-${String(Math.min(day, maxDay)).padStart(2, "0")}`;
    /* Squeeze each window into the days that exist so far rather than dropping
       whatever lands past today — a partial month should read as busy up to
       today, not as a suspiciously quiet full month. */
    const dayIn = ([lo, hi]) => between([Math.min(lo, maxDay), Math.min(hi, maxDay)]);

    [1, 15].forEach((day) => {
      if (day > maxDay) return;
      add({
        account_id: acct("Checking"), date: on(day), amount_cents: 210000 + between([-4000, 4000]),
        payee: "Northwind Labs", note: "Salary",
      });
    });

    SAMPLE_SPEND.forEach((spec) => {
      const hot = isCurrent && spec.envelope === "Eating out";
      const n = between(spec.count) + (hot ? 1 : 0);
      for (let k = 0; k < n; k++) {
        const cents = between(spec.amount);
        add({
          account_id: acct(spec.account), date: on(dayIn(spec.day)),
          amount_cents: -(hot ? Math.round(cents * 1.15) : cents),
          payee: pick(spec.payees), envelope_id: env(spec.envelope),
        });
      }
    });

    // One unassigned row a month, so the amber "unassigned" path has a subject.
    add({
      account_id: acct("Checking"), date: on(dayIn([6, 24])),
      amount_cents: -between([2000, 9000]), payee: "ATM withdrawal",
    });

    // Transfers are neither income nor spending — worth having one in view.
    // One row per transfer, on the account the money left; the far side is
    // picked up from transfer_account_id by the balance aggregates.
    add({
      account_id: acct("Checking"), date: on(dayIn([5, 5])), amount_cents: -40000,
      payee: "To savings", kind: "transfer", transfer_account_id: acct("Savings"),
    });

    // Card payment, so the Visa balance stays realistic instead of running away.
    // Skipped in the current month, which leaves a live card balance to look at.
    if (!isCurrent) {
      add({ account_id: acct("Checking"), date: on(20), amount_cents: -55000,
        payee: "Visa payment", kind: "transfer", transfer_account_id: acct("Visa") });
    }
  }

  write(db);
  return { accounts, envelopes, count: db.transactions.length };
}

/** Wipe the local ledger — the sample is disposable by design. */
export async function clearLocalBudget() {
  try {
    localStorage.removeItem(LOCAL_KEY);
  } catch (e) {
    console.error("budget: local clear failed", e);
  }
}
