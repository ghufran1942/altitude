import React from "react";
import { WD, threeWeeks, todayKey } from "../../lib/dates.js";
import { dayCount, doneOn } from "../../lib/habits.js";

export function HabitsToday({ C, font, display, habits, log, dateKey, onShift, onToggle, onManage, compact, viewSwitch }) {
  const live = habits.filter((h) => h.active).sort((a, b) => a.order - b.order);
  // No grid on phone, so the stepper is how you reach an earlier day there.
  const target = compact ? dateKey : todayKey();
  const done = dayCount(log, target, live.map((h) => h.id));
  const pct = live.length ? Math.round((100 * done) / live.length) : 0;
  const isToday = target === todayKey();
  const weeks = threeWeeks();
  const today = todayKey();

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
        <div style={{ fontSize: 12, color: C.muted }}>{done} of {live.length} · {pct}%</div>
        <button style={{ ...stepBtn, fontSize: 12, color: C.muted }} onClick={onManage}>Edit habits</button>
      </div>

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
            const name = (
              <div key="n" style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                <button onClick={() => onToggle(h.id, target)}
                  aria-label={on ? `Mark ${h.name} not done` : `Mark ${h.name} done`} aria-pressed={on}
                  style={{ width: 19, height: 19, borderRadius: "50%", flexShrink: 0, padding: 0, cursor: "pointer",
                    display: "flex", alignItems: "center", justifyContent: "center", lineHeight: 1, fontSize: 11,
                    border: `1.5px solid ${on ? C.accent : C.border}`,
                    background: on ? C.accent : "transparent", color: C.accentInk }}>{on ? "✓" : ""}</button>
                <span style={{ fontSize: 15, flexShrink: 0 }}>{h.icon}</span>
                <span style={{ flex: 1, minWidth: 0, fontSize: 14, fontWeight: 500,
                  textDecoration: on ? "line-through" : "none", color: on ? C.muted : C.ink,
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{h.name}</span>
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
                        return (
                          <button key={k} disabled={future} onClick={() => onToggle(h.id, k)}
                            title={`${h.name} · ${k}`} aria-label={`${h.name} on ${k}`} aria-pressed={cellOn}
                            style={{ width: "100%", maxWidth: 30, aspectRatio: "1 / 1", justifySelf: "center",
                              borderRadius: "50%", padding: 0, fontFamily: font, fontSize: 10,
                              fontWeight: k === today ? 700 : 400,
                              display: "flex", alignItems: "center", justifyContent: "center", lineHeight: 1,
                              cursor: future ? "default" : "pointer",
                              border: future ? `1px dashed ${C.border}` : `1px solid ${cellOn ? C.accent : C.border}`,
                              background: cellOn ? C.accent : di >= 5 ? weekendBg : "transparent",
                              color: future ? "transparent" : cellOn ? C.accentInk : C.muted,
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