import React, { useState } from "react";
import { PRAYERS, fmtTime, prayerTimesFor } from "../../lib/prayer/prayerTimes.js";
import { DEFAULT_REMINDER_OFFSETS, dueAt, reminderLabel } from "../../lib/reminders.js";
import { MARKS, MARK_ORDER, markColor, trackingMode } from "../../lib/habits.js";
import { todayKey } from "../../lib/dates.js";
import { uid } from "../../lib/util.js";

/* Schedule + reminders for one habit: when it's due, and when to be nudged. */
export function HabitSchedule({ C, font, habit, loc, onChange, onNeedLocation }) {
  const [custom, setCustom] = useState("");
  const s = habit.schedule || {};
  const kind = s.kind || "none";
  const reminders = habit.reminders || [];

  const field = { padding: "6px 8px", borderRadius: 8, border: `1px solid ${C.border}`,
    background: C.bg, color: C.ink, fontFamily: font, fontSize: 13 };
  const chip = (on) => ({ fontFamily: font, fontSize: 12, fontWeight: 600, cursor: "pointer",
    padding: "4px 10px", borderRadius: 999, border: `1px solid ${on ? C.accent : C.border}`,
    background: on ? C.accent : "transparent", color: on ? C.accentInk : C.muted });

  const setSchedule = (patch) => onChange({ schedule: { ...s, ...patch } });

  const pick = (next) => {
    if (next === "none") return onChange({ schedule: null });
    if (next === "time") return onChange({ schedule: { kind: "time", time: s.time || "08:00", offset: 0 } });
    return onChange({ schedule: { kind: "prayer", prayer: s.prayer || "fajr", offset: s.offset || 0 } });
  };

  const addReminder = (offset) => {
    const n = Number(offset);
    if (!Number.isFinite(n)) return;
    if (reminders.some((r) => Number(r.offset) === n)) return; // no duplicate nudges
    onChange({ reminders: [...reminders, { id: uid(), offset: n }].sort((a, b) => a.offset - b.offset) });
  };
  const dropReminder = (id) => onChange({ reminders: reminders.filter((r) => r.id !== id) });

  const times = kind === "prayer" && loc ? prayerTimesFor(todayKey(), loc) : null;
  const due = dueAt({ ...habit, schedule: s.kind ? s : null }, todayKey(), times);
  const needsLoc = kind === "prayer" && !loc;

  const mode = trackingMode(habit);

  return (
    <div style={{ padding: "10px 0 14px", borderBottom: `1px solid ${C.border}` }}>
      <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", marginBottom: 10 }}>
        <span style={{ fontSize: 12, color: C.muted, marginRight: 2 }}>Track</span>
        <button style={chip(mode === "check")} onClick={() => onChange({ tracking: "check" })}>Done or not</button>
        <button style={chip(mode === "quality")} onClick={() => onChange({ tracking: "quality" })}>
          On time · delayed · missed
        </button>
      </div>
      {mode === "quality" && (
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
          {MARK_ORDER.map((m) => (
            <span key={m} style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11, color: C.muted }}>
              <span style={{ width: 13, height: 13, borderRadius: "50%", background: markColor(C, m),
                color: C.accentInk, fontSize: 9, lineHeight: 1, display: "flex",
                alignItems: "center", justifyContent: "center" }}>{MARKS[m].glyph}</span>
              {MARKS[m].label}
            </span>
          ))}
          <span style={{ fontSize: 11, color: C.muted, opacity: 0.85 }}>
            — missed still counts as answered, so it won't keep reminding you.
          </span>
        </div>
      )}
      <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", marginBottom: 10 }}>
        <span style={{ fontSize: 12, color: C.muted, marginRight: 2 }}>Due</span>
        {[["none", "Anytime"], ["time", "At a time"], ["prayer", "With a prayer"]].map(([k, label]) => (
          <button key={k} style={chip(kind === k)} onClick={() => pick(k)}>{label}</button>
        ))}
      </div>

      {kind === "time" && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
          <input type="time" value={s.time || "08:00"} aria-label={`Time for ${habit.name}`}
            onChange={(e) => setSchedule({ time: e.target.value })} style={{ ...field, width: 130 }} />
          <span style={{ fontSize: 12, color: C.muted }}>every day</span>
        </div>
      )}

      {kind === "prayer" && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <select value={s.prayer || "fajr"} aria-label={`Prayer for ${habit.name}`}
              onChange={(e) => setSchedule({ prayer: e.target.value })} style={{ ...field, minWidth: 120 }}>
              {PRAYERS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
            </select>
            <select value={String(s.offset || 0)} aria-label={`Offset from prayer for ${habit.name}`}
              onChange={(e) => setSchedule({ offset: Number(e.target.value) })} style={{ ...field }}>
              {[-60, -30, -15, -10, -5, 0, 5, 10, 15, 20, 30, 45, 60, 90].map((n) => (
                <option key={n} value={n}>
                  {n === 0 ? "at the adhan" : n < 0 ? `${-n} min before` : `${n} min after`}
                </option>
              ))}
            </select>
          </div>
          {needsLoc ? (
            <div style={{ fontSize: 12, color: C.amber, marginTop: 8, lineHeight: 1.5 }}>
              Set your location to work out prayer times.{" "}
              <button onClick={onNeedLocation} style={{ ...chip(false), color: C.amber, borderColor: C.amber,
                padding: "2px 8px" }}>Choose city</button>
            </div>
          ) : (
            <div style={{ fontSize: 12, color: C.muted, marginTop: 8 }}>
              Moves with the sun — today that's {fmtTime(due)}.
            </div>
          )}
        </div>
      )}

      {kind !== "none" && (
        <div>
          <div style={{ fontSize: 12, color: C.muted, marginBottom: 6 }}>
            Remind me{due && !needsLoc ? ` (due ${fmtTime(due)} today)` : ""}
          </div>
          {reminders.length > 0 && (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
              {reminders.map((r) => (
                <span key={r.id} style={{ ...chip(true), display: "inline-flex", alignItems: "center", gap: 6,
                  cursor: "default" }}>
                  {reminderLabel(r.offset)}
                  {due && !needsLoc && (
                    <span style={{ opacity: 0.75 }}>
                      · {fmtTime(new Date(due.getTime() + (Number(r.offset) || 0) * 60000))}
                    </span>
                  )}
                  <button onClick={() => dropReminder(r.id)} aria-label={`Remove reminder ${reminderLabel(r.offset)}`}
                    style={{ border: "none", background: "transparent", color: C.accentInk, cursor: "pointer",
                      padding: 0, fontSize: 13, lineHeight: 1, opacity: 0.8 }}>✕</button>
                </span>
              ))}
            </div>
          )}
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
            {DEFAULT_REMINDER_OFFSETS.filter((n) => !reminders.some((r) => Number(r.offset) === n)).map((n) => (
              <button key={n} onClick={() => addReminder(n)} style={{ ...chip(false), fontWeight: 500 }}>
                + {reminderLabel(n)}
              </button>
            ))}
            <input value={custom} onChange={(e) => setCustom(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && custom) { addReminder(custom); setCustom(""); } }}
              placeholder="±min" aria-label="Custom reminder offset in minutes"
              style={{ ...field, width: 70, padding: "4px 8px", fontSize: 12 }} />
            {custom !== "" && (
              <button onClick={() => { addReminder(custom); setCustom(""); }}
                style={{ ...chip(false), fontWeight: 600 }}>Add</button>
            )}
          </div>
          {!reminders.length && (
            <div style={{ fontSize: 12, color: C.muted, marginTop: 8, lineHeight: 1.5 }}>
              No reminders yet — the time still shows on your list. Negative is before, positive after.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
