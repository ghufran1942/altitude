import React, { useMemo } from "react";
import { WD, threeWeeks, todayKey } from "../../lib/dates.js";
import { MARKS, MARK_ORDER as MARK_KEYS, dayCount, dayMarks, doneOn, markColor, markOn,
  trackingMode } from "../../lib/habits.js";
import { daySchedule } from "../../lib/reminders.js";
import { fmtTime } from "../../lib/prayer/prayerTimes.js";

/* The control cycles rather than toggles, so the label says where the next
   press lands — "Mark X done" would be a lie on a three-state button. */
function markAria(habit, mark, quality) {
  if (!quality) return mark ? `Mark ${habit.name} not done` : `Mark ${habit.name} done`;
  const state = mark === true ? "done" : mark ? MARKS[mark].label.toLowerCase() : "not recorded";
  const next = mark === "green" ? "delayed" : mark === "yellow" ? "missed"
    : mark === "red" ? "not recorded" : "on time";
  return `${habit.name}: ${state}. Press to mark ${next}`;
}

export function HabitsToday({ C, font, display, habits, log, dateKey, onShift, onToggle, onManage,
  compact, viewSwitch, loc, now }) {
  const live = habits.filter((h) => h.active).sort((a, b) => a.order - b.order);
  // No grid on phone, so the stepper is how you reach an earlier day there.
  const target = compact ? dateKey : todayKey();
  const done = dayCount(log, target, live.map((h) => h.id));
  const pct = live.length ? Math.round((100 * done) / live.length) : 0;
  const isToday = target === todayKey();
  // Only summarise punctuality when something is actually tracked that way.
  const graded = live.filter((h) => trackingMode(h) === "quality");
  const tally = dayMarks(log, target, graded.map((h) => h.id));
  const weeks = threeWeeks();
  const today = todayKey();

  // Scheduled times for the day on screen, and what's coming up next today.
  const sched = useMemo(() => daySchedule(habits, target, loc), [habits, target, loc]);
  const dueMap = useMemo(() => {
    const m = {};
    sched.forEach(({ habit, at }) => { m[habit.id] = at; });
    return m;
  }, [sched]);
  const nextUp = useMemo(() => {
    if (!isToday || !now) return null;
    return sched.find(({ habit, at }) => at > now && !doneOn(log, target, habit.id)) || null;
  }, [sched, isToday, now, log, target]);

  const stepBtn = { fontFamily: font, fontSize: 13, fontWeight: 600, cursor: "pointer", padding: "4px 10px",
    borderRadius: 8, border: `1px solid ${C.border}`, background: C.surface, color: C.ink };
  const weekendBg = C.bg === "#101820" ? "#141D26" : "#F4F7F9";

  const row = (cells) => (
    <div style={{ display: "grid", gridTemplateColumns: "132px repeat(3, 1fr)", gap: 14, alignItems: "center" }}>
      {cells}
    </div>
  );

  return (
    <section style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14, padding: compact ? 16 : 22 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
        <div style={{ fontFamily: display, fontWeight: 700, fontSize: 15 }}>{viewSwitch ? "Track" : "Habits"}</div>
        {viewSwitch}
        {compact && (
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <button style={stepBtn} onClick={() => onShift(-1)} aria-label="Previous day">‹</button>
            <div style={{ fontSize: 12, color: C.muted, minWidth: 88, textAlign: "center" }}>
              {isToday ? "Today" : dateKey}
            </div>
            <button style={{ ...stepBtn, opacity: isToday ? 0.4 : 1 }} disabled={isToday}
              onClick={() => onShift(1)} aria-label="Next day">›</button>
          </div>
        )}
        <div style={{ flex: 1 }} />
        {nextUp && (
          <div style={{ fontSize: 12, color: C.muted, display: "flex", alignItems: "center", gap: 5 }}>
            <span style={{ color: C.accent, fontWeight: 600 }}>Next</span>
            <span>{nextUp.habit.icon} {nextUp.habit.name}</span>
            <span style={{ fontVariantNumeric: "tabular-nums" }}>{fmtTime(nextUp.at)}</span>
          </div>
        )}
        {graded.length > 0 && (tally.green + tally.yellow + tally.red) > 0 && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: C.muted }}>
            {MARK_KEYS.filter((m) => tally[m]).map((m) => (
              <span key={m} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}
                title={`${tally[m]} ${MARKS[m].label.toLowerCase()}`}>
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: markColor(C, m) }} />
                {tally[m]}
              </span>
            ))}
          </div>
        )}
        <div style={{ fontSize: 12, color: C.muted }}>{done} of {live.length} · {pct}%</div>
        <button style={{ ...stepBtn, fontSize: 12, color: C.muted }} onClick={onManage}>Edit habits</button>
      </div>

      {graded.length > 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap",
          fontSize: 11, color: C.muted, marginBottom: 10 }}>
          {MARK_KEYS.map((m) => (
            <span key={m} style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
              <span style={{ width: 13, height: 13, borderRadius: "50%", background: markColor(C, m),
                color: C.accentInk, fontSize: 9, lineHeight: 1, display: "flex",
                alignItems: "center", justifyContent: "center" }}>{MARKS[m].glyph}</span>
              {MARKS[m].label}
            </span>
          ))}
          <span style={{ opacity: 0.8 }}>· tap a prayer to cycle through</span>
        </div>
      )}

      {!live.length ? (
        <div style={{ fontSize: 13, color: C.muted, padding: "10px 0" }}>
          No habits yet. Add your first one with “Edit habits”.
        </div>
      ) : (
        <div>
          {!compact && row([
            <div key="sp" />,
            ...weeks.map((wk, wi) => (
              <div key={wi} style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 3 }}>
                {WD.map((d, di) => (
                  <div key={di} style={{ fontSize: 10, textAlign: "center",
                    color: wk[di] === today ? C.ink : C.muted,
                    fontWeight: wk[di] === today ? 700 : 400 }}>{d}</div>
                ))}
              </div>
            )),
          ])}

          {live.map((h) => {
            const on = doneOn(log, target, h.id);
            const quality = trackingMode(h) === "quality";
            const mark = markOn(log, target, h.id);
            // A legacy tick on a quality habit has no recorded quality, so it
            // shows as a plain check rather than claiming it was on time.
            const shade = quality && mark && mark !== true ? mark : null;
            const due = dueMap[h.id];
            // A time that's been and gone unanswered is worth flagging, but only
            // for today — earlier days are already spelled out in the grid.
            const missed = due && isToday && now && now > due && mark === null;
            const name = (
              <div key="n" style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                <button onClick={() => onToggle(h.id, target)}
                  aria-label={markAria(h, mark, quality)} aria-pressed={on}
                  title={shade ? MARKS[shade].label : undefined}
                  style={{ width: 19, height: 19, borderRadius: "50%", flexShrink: 0, padding: 0, cursor: "pointer",
                    display: "flex", alignItems: "center", justifyContent: "center", lineHeight: 1, fontSize: 11,
                    border: `1.5px solid ${shade ? markColor(C, shade) : on ? C.accent : C.border}`,
                    background: shade ? markColor(C, shade) : on ? C.accent : "transparent",
                    color: C.accentInk }}>
                  {shade ? MARKS[shade].glyph : on ? "✓" : ""}
                </button>
                <span style={{ fontSize: 15, flexShrink: 0 }}>{h.icon}</span>
                <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 1 }}>
                  <span style={{ minWidth: 0, fontSize: 14, fontWeight: 500,
                    textDecoration: on ? "line-through" : "none", color: on ? C.muted : C.ink,
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{h.name}</span>
                  {due && (
                    <span style={{ fontSize: 10, lineHeight: 1.2, fontVariantNumeric: "tabular-nums",
                      color: missed ? C.amber : C.muted, whiteSpace: "nowrap" }}>
                      {fmtTime(due)}
                      {(h.reminders?.length || 0) > 0 && <span style={{ opacity: 0.8 }}> · 🔔{h.reminders.length}</span>}
                    </span>
                  )}
                </div>
              </div>
            );

            if (compact) {
              return <div key={h.id} style={{ padding: "9px 0", borderTop: `1px solid ${C.border}` }}>{name}</div>;
            }

            return (
              <div key={h.id} style={{ padding: "5px 0", borderTop: `1px solid ${C.border}` }}>
                {row([
                  name,
                  ...weeks.map((wk, wi) => (
                    <div key={wi} style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 3 }}>
                      {wk.map((k, di) => {
                        const future = k > today;
                        const cellOn = !future && doneOn(log, k, h.id);
                        const cellMark = future ? null : markOn(log, k, h.id);
                        const cellShade = quality && cellMark && cellMark !== true ? cellMark : null;
                        const fill = cellShade ? markColor(C, cellShade) : cellOn ? C.accent : null;
                        return (
                          <button key={k} disabled={future} onClick={() => onToggle(h.id, k)}
                            title={`${h.name} · ${k}${cellShade ? ` · ${MARKS[cellShade].label}` : ""}`}
                            aria-label={`${h.name} on ${k}${cellShade ? `, ${MARKS[cellShade].label}` : ""}`}
                            aria-pressed={cellOn}
                            style={{ width: "100%", maxWidth: 30, aspectRatio: "1 / 1", justifySelf: "center",
                              borderRadius: "50%", padding: 0, fontFamily: font, fontSize: 10,
                              fontWeight: k === today ? 700 : 400,
                              display: "flex", alignItems: "center", justifyContent: "center", lineHeight: 1,
                              cursor: future ? "default" : "pointer",
                              border: future ? `1px dashed ${C.border}` : `1px solid ${fill || C.border}`,
                              background: fill || (di >= 5 ? weekendBg : "transparent"),
                              color: future ? "transparent" : fill ? C.accentInk : C.muted,
                              opacity: future ? 0.45 : 1,
                              boxShadow: k === today ? `0 0 0 1.5px ${C.accent}` : "none" }}>
                            {k.slice(8).replace(/^0/, "")}
                          </button>
                        );
                      })}
                    </div>
                  )),
                ])}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}