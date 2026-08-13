/* Money is stored as integer cents everywhere. Never floats — a running
   balance built from 0.1 + 0.2 drifts within a single month. */

export const CURRENCY = "USD";
export const LOCALE = "en-US";

const fmt = new Intl.NumberFormat(LOCALE, {
  style: "currency", currency: CURRENCY, minimumFractionDigits: 2,
});
const fmtNoSign = new Intl.NumberFormat(LOCALE, {
  style: "currency", currency: CURRENCY, minimumFractionDigits: 2,
  signDisplay: "never",
});

/** "$1,234.56" — negatives render with a leading minus. */
export function money(cents) {
  return fmt.format((cents || 0) / 100);
}
/** "$1,234.56" with the sign stripped, for columns that colour instead. */
export function moneyAbs(cents) {
  return fmtNoSign.format((cents || 0) / 100);
}
/** "+$20.00" / "−$20.00" — explicit direction, for transaction rows. */
export function moneySigned(cents) {
  const n = cents || 0;
  if (n === 0) return fmt.format(0);
  return (n > 0 ? "+" : "−") + fmtNoSign.format(n / 100);
}

/**
 * Parse user or CSV input into integer cents.
 * Handles "$1,234.56", "(12.30)" as negative, "1.234,56" European style,
 * "1 234,56", and bare "45". Returns null when nothing numeric is present.
 */
export function parseMoney(input) {
  if (typeof input === "number") return Math.round(input * 100);
  if (input == null) return null;
  let s = String(input).trim();
  if (!s) return null;

  let negative = false;
  if (/^\(.*\)$/.test(s)) { negative = true; s = s.slice(1, -1); }
  if (/^-/.test(s)) { negative = true; s = s.slice(1); }
  if (/-$/.test(s)) { negative = true; s = s.slice(0, -1); }

  s = s.replace(/[^\d.,]/g, "");
  if (!s || !/\d/.test(s)) return null;

  const lastDot = s.lastIndexOf(".");
  const lastComma = s.lastIndexOf(",");
  let decimalAt = -1;
  if (lastDot >= 0 && lastComma >= 0) {
    decimalAt = Math.max(lastDot, lastComma);            // whichever is rightmost
  } else if (lastComma >= 0) {
    // a lone comma is decimal only when it looks like "12,34", not "1,234"
    if (s.length - lastComma - 1 !== 3) decimalAt = lastComma;
  } else if (lastDot >= 0) {
    if (s.length - lastDot - 1 !== 3 || s.split(".").length === 2) decimalAt = lastDot;
  }

  let whole, frac;
  if (decimalAt >= 0) {
    whole = s.slice(0, decimalAt).replace(/[.,]/g, "");
    frac = s.slice(decimalAt + 1).replace(/[.,]/g, "");
  } else {
    whole = s.replace(/[.,]/g, "");
    frac = "";
  }
  frac = (frac + "00").slice(0, 2);
  const cents = Number(whole || "0") * 100 + Number(frac || "0");
  if (!Number.isFinite(cents)) return null;
  return negative ? -cents : cents;
}

/** Sum a list of cent amounts without leaving integer space. */
export const sumCents = (list) => list.reduce((a, b) => a + (b || 0), 0);

/** Cents → the "12.34" string an <input> expects. */
export function centsToInput(cents) {
  if (cents == null) return "";
  const n = Math.abs(cents);
  return `${Math.floor(n / 100)}.${String(n % 100).padStart(2, "0")}`;
}
