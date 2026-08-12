/* Recurring paycheck: one income stream, landing on a few fixed days of the
   month, split across accounts by percentage.

   Nothing here writes. It turns a config plus "what date is it" into the rows
   that ought to exist, and each row carries a deterministic import_hash — so
   posting reuses the CSV importer's duplicate handling and re-posting the same
   payday is a no-op rather than a double deposit. */

export const DEFAULT_PAYCHECK = {
  payee: "Paycheck",
  start_date: null,                              // don't back-fill before this
  pay_days: [{ day: 15, amount_cents: 0 }, { day: 30, amount_cents: 0 }],
  splits: [],                                    // [{ account_id, percent }]
};

const pad = (n) => String(n).padStart(2, "0");
const daysInMonth = (year, month1) => new Date(year, month1, 0).getDate();

/**
 * A day-of-month pinned to a real date in that month. Someone paid on the 31st
 * still gets paid in February, so anything past the end clamps to the last day.
 */
export function payDateIn(year, month1, day) {
  return `${year}-${pad(month1)}-${pad(Math.min(Math.max(day, 1), daysInMonth(year, month1)))}`;
}

/** Every payday the config implies within [from, to], oldest first. */
export function payDatesBetween(payDays, from, to) {
  if (!from || !to || from > to) return [];
  const [fy, fm] = from.split("-").map(Number);
  const [ty, tm] = to.split("-").map(Number);
  const out = [];
  let y = fy, m = fm;
  while (y < ty || (y === ty && m <= tm)) {
    (payDays || []).forEach((pd) => {
      const date = payDateIn(y, m, pd.day);
      if (date >= from && date <= to) out.push({ date, day: pd.day, amount_cents: pd.amount_cents });
    });
    if (++m > 12) { m = 1; y++; }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Divide one paycheck across the split accounts.
 *
 * Percentages almost never divide a cent total evenly, so the shares are
 * floored and the leftover cents handed out by largest fractional part. The
 * result always adds back up to exactly the paycheck — money cannot be
 * allowed to evaporate into rounding.
 */
export function splitAmount(amountCents, splits) {
  const live = (splits || []).filter((s) => s.account_id && s.percent > 0);
  const totalPct = live.reduce((a, s) => a + s.percent, 0);
  if (!live.length || !amountCents || totalPct <= 0) return [];

  const exact = live.map((s) => (amountCents * s.percent) / totalPct);
  const cents = exact.map(Math.floor);
  const order = exact
    .map((v, i) => ({ frac: v - Math.floor(v), i }))
    .sort((a, b) => b.frac - a.frac);

  let leftover = amountCents - cents.reduce((a, b) => a + b, 0);
  for (let k = 0; leftover > 0; k++, leftover--) cents[order[k % order.length].i]++;

  return live.map((s, i) => ({ account_id: s.account_id, amount_cents: cents[i] }));
}

/** Stable across re-posts: same payday, same account, same row. */
export const paycheckHash = (date, accountId) => `paycheck:${date}:${accountId}`;

/** The deposits one payday should produce. */
export function paycheckRows(config, payDate) {
  return splitAmount(payDate.amount_cents, config.splits).map((s) => ({
    account_id: s.account_id,
    date: payDate.date,
    amount_cents: s.amount_cents,
    payee: config.payee?.trim() || "Paycheck",
    note: null,
    envelope_id: null,                 // income is not envelope spending
    transfer_account_id: null,
    kind: "normal",
    cleared: false,
    import_hash: paycheckHash(payDate.date, s.account_id),
  }));
}

/** Paydays that have already come round, from start_date to today inclusive. */
export function candidateDates(config, today) {
  if (!config?.splits?.length) return [];
  return payDatesBetween(config.pay_days, config.start_date || today, today)
    .filter((pd) => pd.amount_cents > 0);
}

export function hashesFor(config, dates) {
  return dates.flatMap((pd) => paycheckRows(config, pd).map((r) => r.import_hash));
}

/** Of those paydays, the ones not already in the ledger. */
export function duePayDates(config, dates, existingHashes) {
  return dates.filter((pd) =>
    paycheckRows(config, pd).some((r) => !existingHashes.has(r.import_hash)));
}

/** Percentages as entered — surfaced so the form can say when they don't add up. */
export function splitTotal(splits) {
  return (splits || []).reduce((a, s) => a + (Number(s.percent) || 0), 0);
}
