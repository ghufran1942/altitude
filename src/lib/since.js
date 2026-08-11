import { todayKey, shiftKey } from "./dates.js";
import { uid } from "./util.js";

export const MILESTONES = [7, 30, 100, 180, 365, 500, 1000];

export function seedSince() {
  return [];
}

/** Whole days between two YYYY-MM-DD keys. Parsed as local noon so a DST
 *  shift can't round a 24h span down to 23h and lose a day. */
export function daysBetween(fromKey, toKey) {
  const at = (k) => {
    const [y, m, d] = k.split("-").map(Number);
    return new Date(y, m - 1, d, 12);
  };
  return Math.round((at(toKey) - at(fromKey)) / 86400000);
}

/** Resets newest-first, ignoring anything in the future or duplicated. */
export function resetsFor(log, id) {
  const today = todayKey();
  return [...new Set(log[id] || [])].filter((k) => k <= today).sort().reverse();
}

/** The day the current run began: the newest reset, else the item's creation. */
export function runStart(item, log) {
  return resetsFor(log, item.id)[0] || item.createdAt || todayKey();
}

/** Every completed gap plus the one currently running, in days. */
export function gapsFor(item, log) {
  const resets = resetsFor(log, item.id);
  const anchors = [...resets, item.createdAt].filter(Boolean);
  const out = [];
  for (let i = 0; i < anchors.length - 1; i++) {
    const g = daysBetween(anchors[i + 1], anchors[i]);
    if (g > 0) out.push(g);
  }
  return out;
}

export function nextMilestone(days) {
  return MILESTONES.find((m) => m > days) ?? null;
}

/**
 * Everything the UI needs for one item.
 *  - anchor items count from a fixed date and have no resets, so no best gap
 *  - reset items count from the newest reset and track the widest gap ever
 */
export function sinceStats(item, log) {
  const today = todayKey();
  if (item.kind === "anchor") {
    const from = item.anchorDate || item.createdAt || today;
    const days = Math.max(0, daysBetween(from, today));
    return { kind: "anchor", days, from, best: null, isRecord: false,
      resets: 0, lastReset: null, next: nextMilestone(days),
      toNext: nextMilestone(days) === null ? null : nextMilestone(days) - days };
  }
  const from = runStart(item, log);
  const days = Math.max(0, daysBetween(from, today));
  const completed = gapsFor(item, log);
  const best = Math.max(days, ...completed, 0);
  const next = nextMilestone(days);
  return {
    kind: "reset", days, from, best,
    // a record only counts once you're past everything you've done before
    isRecord: completed.length > 0 && days > Math.max(...completed),
    resets: resetsFor(log, item.id).length,
    lastReset: resetsFor(log, item.id)[0] || null,
    next, toNext: next === null ? null : next - days,
  };
}

/** Record a reset on `dateKey`, keeping the list sorted and deduplicated. */
export function addReset(log, id, dateKey) {
  const today = todayKey();
  const key = dateKey > today ? today : dateKey;
  const prev = log[id] || [];
  if (prev.includes(key)) return log;
  return { ...log, [id]: [...prev, key].sort() };
}

export function removeReset(log, id, dateKey) {
  const prev = log[id] || [];
  const next = prev.filter((k) => k !== dateKey);
  const out = { ...log };
  if (next.length) out[id] = next; else delete out[id];
  return out;
}

export function newSinceItem(name, kind = "reset") {
  const t = todayKey();
  return { id: `sc-${uid()}`, name, icon: kind === "anchor" ? "📍" : "🔁",
    order: 0, active: true, createdAt: t, kind, anchorDate: kind === "anchor" ? t : null };
}

/** Deterministic sample history, mirroring the habit demo generator. */
export function demoSinceLog(items) {
  const log = {};
  items.filter((i) => i.kind === "reset").forEach((item, idx) => {
    const spacing = [11, 29, 73][idx % 3];
    const keys = [];
    for (let n = 1; n <= 4; n++) keys.push(shiftKey(todayKey(), -(spacing * n + idx * 3)));
    log[item.id] = keys.sort();
  });
  return log;
}
