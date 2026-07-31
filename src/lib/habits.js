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

export const doneOn = (log, key, id) => !!(log[key] && log[key][id]);

export const dayCount = (log, key, ids) => ids.reduce((n, id) => n + (doneOn(log, key, id) ? 1 : 0), 0);

// Every day from the earliest logged day (or earliest habit) to today, newest first.
// The createdAt floor is what stops an empty tracker rendering back to 1970.
export function habitDayKeys(habits, log) {
  const keys = Object.keys(log).filter((k) => Object.values(log[k] || {}).some(Boolean));
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
