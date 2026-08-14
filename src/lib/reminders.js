/* Turning a habit's schedule into actual moments in time.

   A habit can be anchored two ways:
     { kind: "time",   time: "07:30", offset: 0 }   — a fixed clock time
     { kind: "prayer", prayer: "fajr", offset: 15 } — relative to a prayer, which
                                                      moves a little every day

   and carries any number of reminders, each an offset in minutes from that
   moment (negative = before, positive = after). */

import { prayerLabel, prayerTimesFor } from "./prayer/prayerTimes.js";
import { recordedOn } from "./habits.js";
import { shiftKey, todayKey } from "./dates.js";

export const hasSchedule = (h) => !!(h.schedule && h.schedule.kind && h.schedule.kind !== "none");

/* The moment a habit is due on a given day, or null if it isn't scheduled
   (or is prayer-anchored with no location set yet). */
export function dueAt(habit, dayKey, times) {
  const s = habit.schedule;
  if (!hasSchedule(habit)) return null;
  const offset = Number(s.offset) || 0;

  if (s.kind === "time") {
    const [y, m, d] = dayKey.split("-").map(Number);
    const [hh, mm] = String(s.time || "").split(":").map(Number);
    if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
    // Local-time construction, so DST changes land on the right wall clock.
    return new Date(y, m - 1, d, hh, mm + offset, 0, 0);
  }

  if (s.kind === "prayer") {
    const base = times?.[s.prayer];
    if (!base) return null;
    return new Date(base.getTime() + offset * 60000);
  }
  return null;
}

export const DEFAULT_REMINDER_OFFSETS = [-30, -15, -10, -5, 0, 10, 30];

export function reminderLabel(offset) {
  const n = Number(offset) || 0;
  if (n === 0) return "At the time";
  const abs = Math.abs(n);
  const unit = abs % 60 === 0 && abs >= 60 ? `${abs / 60} hr` : `${abs} min`;
  return `${unit} ${n < 0 ? "before" : "after"}`;
}

export function describeSchedule(habit) {
  const s = habit.schedule;
  if (!hasSchedule(habit)) return null;
  const offset = Number(s.offset) || 0;
  if (s.kind === "time") return s.time || null;
  const rel = offset === 0 ? "" : offset > 0 ? ` +${offset}m` : ` ${offset}m`;
  return `${prayerLabel(s.prayer)}${rel}`;
}

/* A stable 31-bit id, so rescheduling a reminder replaces the pending native
   notification instead of stacking a duplicate next to it. */
export function fireId(key) {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) % 2147483647;
}

/* Any recorded answer silences the day's reminders — including an explicit
   "missed". Once you've marked it, being nudged again is just noise. */
const done = (log, dayKey, habitId) => recordedOn(log, dayKey, habitId);

/* Every reminder that should fire between `from` and `horizonDays` ahead.

   Habits already ticked off for a day are skipped — the whole point of a
   reminder is that you haven't done the thing yet. */
export function upcomingFires(habits, log, loc, from = new Date(), horizonDays = 3) {
  const out = [];
  const live = (habits || []).filter((h) => h.active && hasSchedule(h) && h.reminders?.length);
  if (!live.length) return out;

  const startKey = todayKey(from);
  for (let i = 0; i < horizonDays; i++) {
    const dayKey = shiftKey(startKey, i);
    const needsPrayer = live.some((h) => h.schedule.kind === "prayer");
    const times = needsPrayer && loc ? prayerTimesFor(dayKey, loc) : null;

    for (const h of live) {
      if (done(log, dayKey, h.id)) continue;
      const due = dueAt(h, dayKey, times);
      if (!due) continue;
      for (const r of h.reminders) {
        const at = new Date(due.getTime() + (Number(r.offset) || 0) * 60000);
        if (at.getTime() <= from.getTime()) continue;
        const key = `${h.id}|${r.id}|${dayKey}`;
        out.push({
          key,
          id: fireId(key),
          habitId: h.id,
          dayKey,
          at,
          due,
          title: `${h.icon || "⏰"} ${h.name}`,
          body: reminderBody(h, r, due),
        });
      }
    }
  }
  return out.sort((a, b) => a.at - b.at);
}

function reminderBody(habit, r, due) {
  const when = due.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const off = Number(r.offset) || 0;
  const anchor = habit.schedule.kind === "prayer" ? prayerLabel(habit.schedule.prayer) : null;
  if (off === 0) return anchor ? `${anchor} · ${when}` : `Due now · ${when}`;
  const rel = reminderLabel(off).toLowerCase();
  return anchor ? `${anchor} at ${when} — ${rel}` : `Due at ${when} — ${rel}`;
}

/* Reminders that came due in the recent past and haven't been shown yet.
   `firedKeys` is the set already delivered, so a reload doesn't replay them. */
export function dueNow(habits, log, loc, firedKeys, now = new Date(), graceMin = 10) {
  const out = [];
  const live = (habits || []).filter((h) => h.active && hasSchedule(h) && h.reminders?.length);
  if (!live.length) return out;

  // Yesterday too: a reminder set for 11:50pm with a 30-min "after" lands today.
  const keys = [shiftKey(todayKey(now), -1), todayKey(now)];
  for (const dayKey of keys) {
    const needsPrayer = live.some((h) => h.schedule.kind === "prayer");
    const times = needsPrayer && loc ? prayerTimesFor(dayKey, loc) : null;
    for (const h of live) {
      if (done(log, dayKey, h.id)) continue;
      const due = dueAt(h, dayKey, times);
      if (!due) continue;
      for (const r of h.reminders) {
        const at = due.getTime() + (Number(r.offset) || 0) * 60000;
        const age = (now.getTime() - at) / 60000;
        if (age < 0 || age > graceMin) continue; // not yet, or too stale to be useful
        const key = `${h.id}|${r.id}|${dayKey}`;
        if (firedKeys?.[key]) continue;
        out.push({ key, habitId: h.id, dayKey, at: new Date(at), due,
          title: `${h.icon || "⏰"} ${h.name}`, body: reminderBody(h, r, due) });
      }
    }
  }
  return out;
}

// Keep the "already fired" set from growing forever — only the last few days matter.
export function pruneFired(fired, now = new Date(), keepDays = 3) {
  const cutoff = shiftKey(todayKey(now), -keepDays);
  const out = {};
  for (const k of Object.keys(fired || {})) {
    const dayKey = k.split("|")[2];
    if (dayKey && dayKey >= cutoff) out[k] = fired[k];
  }
  return out;
}

/* Today's scheduled habits in clock order, for display under the tracker. */
export function daySchedule(habits, dayKey, loc) {
  const live = (habits || []).filter((h) => h.active && hasSchedule(h));
  if (!live.length) return [];
  const needsPrayer = live.some((h) => h.schedule.kind === "prayer");
  const times = needsPrayer && loc ? prayerTimesFor(dayKey, loc) : null;
  return live
    .map((h) => ({ habit: h, at: dueAt(h, dayKey, times) }))
    .filter((x) => x.at)
    .sort((a, b) => a.at - b.at);
}
