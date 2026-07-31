// px of indent per depth step in the tree
export const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export const todayKey = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export function daysAgoKey(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return todayKey(d);
}

export function fmtDeadline(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  const now = new Date();
  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (d.toDateString() === now.toDateString()) return time; // today → just "1:30 PM"
  const day = d.toLocaleDateString([], {
    month: "short", day: "numeric",
    ...(d.getFullYear() !== now.getFullYear() ? { year: "numeric" } : {}),
  });
  return `${day}, ${time}`;
}

export function deadlineState(iso) {
  if (!iso) return null;
  const diff = new Date(iso).getTime() - Date.now();
  if (diff < 0) return "overdue";
  if (diff < 24 * 3600 * 1000) return "soon";
  return "future";
}

export function defaultDeadlineStr() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T17:00`;
}

export function shiftKey(key, delta) {
  const [y, m, d] = key.split("-").map(Number);
  return todayKey(new Date(y, m - 1, d + delta));
}

export function keysBetween(fromKey, toKey) {
  const out = [];
  let k = toKey;
  while (k >= fromKey) { out.push(k); k = shiftKey(k, -1); }
  return out;
}

export const WD = ["M", "T", "W", "T", "F", "S", "S"];

export const WD_FULL = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

export const keyWeekday = (key) => {                      // Monday = 0
  const [y, m, d] = key.split("-").map(Number);
  return (new Date(y, m - 1, d).getDay() + 6) % 7;
};

export const weekStart = (key) => shiftKey(key, -keyWeekday(key));

// Three Monday-aligned calendar weeks ending with the week containing `endKey`.
export function threeWeeks(endKey = todayKey()) {
  const start = shiftKey(weekStart(endKey), -14);
  return [0, 1, 2].map((w) => Array.from({ length: 7 }, (_, i) => shiftKey(start, w * 7 + i)));
}

export function sinceLabel(key) {
  if (!key) return "Never";
  if (key === todayKey()) return "Today";
  if (key === daysAgoKey(1)) return "Yesterday";
  for (let i = 2; i <= 60; i++) if (key === daysAgoKey(i)) return `${i}d ago`;
  return key;
}
