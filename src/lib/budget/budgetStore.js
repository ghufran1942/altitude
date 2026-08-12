import { supabase } from "../../supabaseClient.js";

/* Budget lives in real tables, not the JSONB blob in store.js. Transaction
   volume would otherwise rewrite the entire app state on every keystroke.
   The two persistence models never touch — keep it that way. */

const fail = (label, error) => {
  console.error(`budget: ${label} failed`, error);
  throw new Error(error?.message || label);
};

/* ---------------- accounts ---------------- */

export async function listAccounts(userId) {
  const { data, error } = await supabase
    .from("accounts").select("*").eq("user_id", userId)
    .order("sort_order").order("created_at");
  if (error) fail("load accounts", error);
  return data || [];
}

export async function createAccount(userId, account) {
  const { data, error } = await supabase
    .from("accounts").insert({ ...account, user_id: userId }).select().single();
  if (error) fail("create account", error);
  return data;
}

export async function updateAccount(id, patch) {
  const { data, error } = await supabase
    .from("accounts").update(patch).eq("id", id).select().single();
  if (error) fail("update account", error);
  return data;
}

/* ---------------- envelopes ---------------- */

export async function listEnvelopes(userId) {
  const { data, error } = await supabase
    .from("envelopes").select("*").eq("user_id", userId)
    .order("sort_order").order("created_at");
  if (error) fail("load envelopes", error);
  return data || [];
}

export async function createEnvelope(userId, envelope) {
  const { data, error } = await supabase
    .from("envelopes").insert({ ...envelope, user_id: userId }).select().single();
  if (error) fail("create envelope", error);
  return data;
}

export async function updateEnvelope(id, patch) {
  const { data, error } = await supabase
    .from("envelopes").update(patch).eq("id", id).select().single();
  if (error) fail("update envelope", error);
  return data;
}

/* ---------------- transactions ---------------- */

/**
 * One month at a time. Loading every transaction would pull megabytes to
 * render a single screen — balances come from monthlyTotals() instead.
 */
export async function listMonth(userId, month) {
  const from = `${month}-01`;
  const [y, m] = month.split("-").map(Number);
  const last = new Date(y, m, 0).getDate();
  const to = `${month}-${String(last).padStart(2, "0")}`;
  const { data, error } = await supabase
    .from("transactions").select("*")
    .eq("user_id", userId).gte("date", from).lte("date", to)
    .order("date", { ascending: false }).order("created_at", { ascending: false });
  if (error) fail("load transactions", error);
  return data || [];
}

/** Every row that isn't a normal dated movement — starting balances. */
export async function listStarting(userId) {
  const { data, error } = await supabase
    .from("transactions").select("*").eq("user_id", userId).eq("kind", "starting");
  if (error) fail("load starting balances", error);
  return data || [];
}

/**
 * Compact per-envelope, per-month aggregate for balances and baselines.
 * Twenty envelopes over three years is ~720 rows regardless of volume.
 */
export async function monthlyTotals(userId) {
  const { data, error } = await supabase.rpc("budget_monthly_totals", { p_user: userId });
  if (error) fail("load monthly totals", error);
  return data || [];
}

/** Account balances as of now, computed server-side over all rows. */
export async function accountTotals(userId) {
  const { data, error } = await supabase.rpc("budget_account_totals", { p_user: userId });
  if (error) fail("load account totals", error);
  return data || [];
}

export async function createTransaction(userId, tx) {
  const { data, error } = await supabase
    .from("transactions").insert({ ...tx, user_id: userId }).select().single();
  if (error) fail("create transaction", error);
  return data;
}

export async function updateTransaction(id, patch) {
  const { data, error } = await supabase
    .from("transactions").update(patch).eq("id", id).select().single();
  if (error) fail("update transaction", error);
  return data;
}

export async function deleteTransaction(id) {
  const { error } = await supabase.from("transactions").delete().eq("id", id);
  if (error) fail("delete transaction", error);
}

/**
 * Bulk insert for CSV import, chunked so a large file doesn't exceed the
 * request limit. Ignores rows whose import_hash already exists rather than
 * erroring, so a re-import is safe.
 */
export async function importTransactions(userId, rows, chunkSize = 250) {
  let inserted = 0, skipped = 0;
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize).map((r) => ({ ...r, user_id: userId }));
    const { data, error } = await supabase
      .from("transactions")
      .upsert(chunk, { onConflict: "user_id,import_hash", ignoreDuplicates: true })
      .select("id");
    if (error) fail("import transactions", error);
    inserted += (data || []).length;
    skipped += chunk.length - (data || []).length;
  }
  return { inserted, skipped };
}

/** Hashes already present, so the import preview can flag duplicates. */
export async function existingHashes(userId, hashes) {
  if (!hashes.length) return new Set();
  const found = new Set();
  for (let i = 0; i < hashes.length; i += 200) {
    const chunk = hashes.slice(i, i + 200);
    const { data, error } = await supabase
      .from("transactions").select("import_hash")
      .eq("user_id", userId).in("import_hash", chunk);
    if (error) fail("check duplicates", error);
    (data || []).forEach((r) => r.import_hash && found.add(r.import_hash));
  }
  return found;
}

/* ---------------- paycheck ---------------- */

/** One recurring income stream per user, so this is a single row keyed on user_id. */
export async function getPaycheck(userId) {
  const { data, error } = await supabase
    .from("paychecks").select("*").eq("user_id", userId).maybeSingle();
  if (error) fail("load paycheck", error);
  return data || null;
}

export async function savePaycheck(userId, config) {
  const { data, error } = await supabase.from("paychecks").upsert({
    user_id: userId,
    payee: config.payee || "Paycheck",
    start_date: config.start_date || null,
    pay_days: config.pay_days || [],
    splits: config.splits || [],
  }, { onConflict: "user_id" }).select().single();
  if (error) fail("save paycheck", error);
  return data;
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
