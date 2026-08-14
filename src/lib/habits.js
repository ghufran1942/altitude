import { daysAgoKey, keyWeekday, keysBetween, todayKey } from "./dates.js";

// Shared by the focus streak and the habit streak so the two can't drift apart.
export function streakFrom(daySet) {
  let cur = 0;
  let i = daySet.has(todayKey()) ? 0 : 1;
  if (!daySet.has(todayKey()) && !daySet.has(daysAgoKey(1))) i = 0;
  for (; ; i++) { if (daySet.has(daysAgoKey(i))) cur++; else break; }
  const sorted = [...daySet].sort();
  let best = 0, run = 0, prev = null;
  sorted.forEach((k) => {
    if (prev) { const a = new Date(prev), b = new Date(k); run = (b - a) / 86400000 === 1 ? run + 1 : 1; }
    else run = 1;
    best = Math.max(best, run);
    prev = k;
  });
  return { current: cur, best: Math.max(best, cur) };
}

export function seedHabits() {
  const t = todayKey();
  return [
    { id: "hb-move", name: "Move", icon: "🏃", order: 0, active: true, createdAt: t },
    { id: "hb-read", name: "Read", icon: "📖", order: 1, active: true, createdAt: t },
    { id: "hb-water", name: "Water", icon: "💧", order: 2, active: true, createdAt: t },
  ];
}

/* Spellings vary a lot in English — Zuhr/Dhuhr, Fajr/Fajar — so match on a
   normalised name rather than asking anyone to rename their habits. */
const PRAYER_ALIASES = {
  tahajjud: ["tahajjud", "tahajud", "tahajjad", "qiyam", "qiyamullayl"],
  fajr: ["fajr", "fajar", "fajir"],
  sunrise: ["sunrise", "ishraq", "shuruq", "duha"],
  dhuhr: ["zuhr", "dhuhr", "duhr", "zohr", "zuhur", "dhur"],
  asr: ["asr", "aser"],
  maghrib: ["maghrib", "magrib", "maghreb"],
  isha: ["isha", "ishaa", "esha", "isha'a"],
};

// Strip emoji, punctuation and spacing so "🤲 Zuhr - 4 rakat" still matches.
const normalise = (name) => String(name || "").toLowerCase().replace(/[^a-z]/g, "");

export function prayerIdForName(name) {
  const n = normalise(name);
  if (!n) return null;
  for (const [id, aliases] of Object.entries(PRAYER_ALIASES)) {
    if (aliases.some((a) => n === a.replace(/[^a-z]/g, ""))) return id;
  }
  return null;
}

// The five obligatory prayers, in order. Tahajjud and sunrise are anchorable too
// but aren't created for you — whether they belong on a daily list is personal.
const FIVE = [
  { prayer: "fajr", name: "Fajr" },
  { prayer: "dhuhr", name: "Zuhr" },
  { prayer: "asr", name: "Asr" },
  { prayer: "maghrib", name: "Maghrib" },
  { prayer: "isha", name: "Isha" },
];

/* Anchor any prayer-named habits to their prayer time, and add whichever of the
   five are missing. Habits that already carry a schedule are left untouched, so
   this is safe to press twice. */
export function attachPrayerHabits(habits) {
  const t = todayKey();
  const out = habits.map((h) => {
    if (!h.active || h.schedule) return h;
    const prayer = prayerIdForName(h.name);
    if (!prayer) return h;
    return { ...h, schedule: { kind: "prayer", prayer, offset: 0 },
      reminders: h.reminders?.length ? h.reminders : [{ id: `rm-${prayer}`, offset: 0 }] };
  });

  const covered = new Set(
    out.filter((h) => h.active).map((h) => h.schedule?.kind === "prayer" ? h.schedule.prayer : prayerIdForName(h.name))
  );
  let order = out.reduce((m, h) => Math.max(m, h.order ?? 0), -1);
  const added = FIVE.filter((p) => !covered.has(p.prayer)).map((p) => ({
    id: `hb-${p.prayer}`,
    name: p.name,
    icon: "🤲",
    order: ++order,
    active: true,
    createdAt: t,
    schedule: { kind: "prayer", prayer: p.prayer, offset: 0 },
    reminders: [{ id: `rm-${p.prayer}`, offset: 0 }],
  }));

  return [...out, ...added];
}

export const hasPrayerHabit = (habits) =>
  habits.some((h) => h.active && (h.schedule?.kind === "prayer" || prayerIdForName(h.name)));

/* ---------------- how a day is marked ----------------

   A habit's entry for a day is either the original plain tick (`true`) or one
   of three quality marks. The distinction that matters everywhere else: red is
   a deliberate record that you did NOT pray, so it counts as logged but not as
   done — otherwise marking your misses honestly would inflate your streak. */

export const MARKS = {
  green: { id: "green", label: "On time", glyph: "✓" },
  yellow: { id: "yellow", label: "Delayed", glyph: "!" },
  red: { id: "red", label: "Missed", glyph: "✕" },
};
export const MARK_ORDER = ["green", "yellow", "red"];

// Prayers get the three marks by default; anything else is a plain tick unless
// you say otherwise, so existing habits keep behaving exactly as they did.
export const trackingMode = (habit) =>
  habit?.tracking || (habit?.schedule?.kind === "prayer" ? "quality" : "check");

export const markOn = (log, key, id) => {
  const v = log?.[key]?.[id];
  return v === undefined || v === false ? null : v;
};

// "You prayed" — the legacy tick, on time, or delayed. Not a recorded miss.
export const doneOn = (log, key, id) => {
  const v = markOn(log, key, id);
  return v === true || v === "green" || v === "yellow";
};

// "You recorded something", including an explicit miss. Reminders use this:
// once you've answered for the day, there's nothing left to nudge about.
export const recordedOn = (log, key, id) => markOn(log, key, id) !== null;

/* Click order: nothing → on time → delayed → missed → nothing. A legacy tick
   lands on "on time" so the first click after switching a habit to quality
   tracking states the quality explicitly rather than guessing it. */
export function nextMark(current, mode) {
  if (mode !== "quality") return current ? null : true;
  if (current === true || current === null || current === undefined) return "green";
  const i = MARK_ORDER.indexOf(current);
  return i < 0 || i === MARK_ORDER.length - 1 ? null : MARK_ORDER[i + 1];
}

export const markColor = (C, mark) =>
  mark === "yellow" ? C.amber : mark === "red" ? C.danger : C.accent;

export const dayCount = (log, key, ids) => ids.reduce((n, id) => n + (doneOn(log, key, id) ? 1 : 0), 0);

// How a day breaks down across the three marks, for the tracker's summary line.
export function dayMarks(log, key, ids) {
  const out = { green: 0, yellow: 0, red: 0, tick: 0 };
  ids.forEach((id) => {
    const v = markOn(log, key, id);
    if (v === true) out.tick++;
    else if (v && out[v] !== undefined) out[v]++;
  });
  return out;
}

// Every day from the earliest logged day (or earliest habit) to today, newest first.
// The createdAt floor is what stops an empty tracker rendering back to 1970.
export function habitDayKeys(habits, log) {
  const keys = Object.keys(log).filter((k) => Object.values(log[k] || {}).some((v) => v !== undefined && v !== false));
  const created = habits.map((h) => h.createdAt).filter(Boolean);
  const earliest = [...keys, ...created].sort()[0] || todayKey();
  return keysBetween(earliest, todayKey());
}

export function habitStats(habits, log) {
  const days = habitDayKeys(habits, log); // newest first
  const live = habits.filter((h) => h.active).sort((a, b) => a.order - b.order);
  const rateOver = (id, arr) => (arr.length ? arr.filter((k) => doneOn(log, k, id)).length / arr.length : 0);

  const rows = live.map((h) => {
    // Score a habit from whichever came first: the day it was created, or the
    // oldest day it was actually logged. Demo history and backfilled days both
    // land before createdAt, and clipping at createdAt alone hides all of them.
    const firstLogged = days.filter((k) => doneOn(log, k, h.id)).pop() || null;
    const floor = [h.createdAt, firstLogged].filter(Boolean).sort()[0] || null;
    const hDays = floor ? days.filter((k) => k >= floor) : days;
    const last90 = hDays.slice(0, 90), r30 = hDays.slice(0, 30), p30 = hDays.slice(30, 60);
    const st = streakFrom(new Set(hDays.filter((k) => doneOn(log, k, h.id))));
    const wd = Array.from({ length: 7 }, (_, i) => {
      const sub = hDays.filter((k) => keyWeekday(k) === i);
      return sub.length ? sub.filter((k) => doneOn(log, k, h.id)).length / sub.length : 0;
    });
    const rec = rateOver(h.id, r30), pri = rateOver(h.id, p30);

    // Punctuality over the same 90 days: of the times you did pray, how many
    // were on time. Days marked with a legacy tick have no quality recorded, so
    // they're left out rather than counted as either.
    const counts = { green: 0, yellow: 0, red: 0 };
    last90.forEach((k) => {
      const v = markOn(log, k, h.id);
      if (v && counts[v] !== undefined) counts[v]++;
    });
    const graded = counts.green + counts.yellow;

    return {
      habit: h,
      rate: rateOver(h.id, last90),
      streak: st.current,
      best: st.best,
      lastKey: hDays.find((k) => doneOn(log, k, h.id)) || null,
      wd,
      // needs a full prior window, otherwise a young tracker reads as "collapsing"
      momentum: p30.length >= 14 ? rec - pri : null,
      atRisk: p30.length >= 14 && pri >= 0.4 && rec <= pri - 0.15,
      marks: counts,
      onTime: graded ? counts.green / graded : null,
      graded,
    };
  });

  const ranked = [...rows].sort((a, b) => b.rate - a.rate);
  const agg = Array.from({ length: 7 }, (_, i) =>
    rows.length ? rows.reduce((s, r) => s + r.wd[i], 0) / rows.length : 0);

  return {
    rows, ranked, agg, span: days.length,
    best: ranked[0] || null,
    worst: ranked.length > 1 ? ranked[ranked.length - 1] : null,
    longest: rows.reduce((b, r) => (r.best > (b ? b.best : -1) ? r : b), null),
    bestDay: agg.indexOf(Math.max(...agg)),
    worstDay: agg.indexOf(Math.min(...agg)),
    spread: rows.length ? Math.max(...agg) - Math.min(...agg) : 0,
  };
}

export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Seeded, so the same habits always produce the same history — a demo that
// reshuffles on every click is hard to reason about.
export function demoHabitLog(habits, days = 120) {
  const live = habits.filter((h) => h.active).sort((a, b) => a.order - b.order);
  const profiles = [
    { base: 0.93, weekend: 0.05, drift: 0.0 },   // solid
    { base: 0.80, weekend: 0.30, drift: 0.0 },   // weekdays only
    { base: 0.74, weekend: 0.22, drift: -0.45 }, // slipping — trips "at risk"
    { base: 0.40, weekend: 0.18, drift: 0.30 },  // improving
  ];
  const log = {};
  live.forEach((h, hi) => {
    const p = profiles[hi % profiles.length];
    const rnd = mulberry32(1000 + hi * 7919);
    for (let i = days - 1; i >= 0; i--) {
      const key = daysAgoKey(i);
      const age = 1 - i / days; // 0 oldest, 1 newest
      const chance = p.base + p.drift * (age - 0.5) * 2 - (keyWeekday(key) >= 5 ? p.weekend : 0);
      if (rnd() < Math.max(0, Math.min(1, chance))) {
        if (!log[key]) log[key] = {};
        log[key][h.id] = true;
      }
    }
  });
  return log;
}
