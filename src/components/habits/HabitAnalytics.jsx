import React from "react";
import { WD_FULL, sinceLabel } from "../../lib/dates.js";
import { habitStats } from "../../lib/habits.js";

export function WeekdayStrip({ C, wd, size = 14 }) {
  return (
    <div style={{ display: "flex", gap: 2 }}>
      {wd.map((v, i) => (
        <div key={i} title={`${WD_FULL[i]} · ${Math.round(v * 100)}%`}
          style={{ width: size, height: size, borderRadius: 3, background: C.accent, opacity: 0.14 + v * 0.8 }} />
      ))}
    </div>
  );
}

export function Momentum({ C, value }) {
  if (value === null) return <span style={{ color: C.muted }}>—</span>;
  const pts = Math.round(value * 100);
  if (Math.abs(pts) < 5) return <span style={{ color: C.muted }}>steady</span>;
  return <span style={{ color: pts > 0 ? C.accent : C.amber }}>{pts > 0 ? "↑" : "↓"} {Math.abs(pts)} pts</span>;
}

export function HabitAnalytics({ C, font, display, habits, log, isPhone }) {
  const s = habitStats(habits, log);
  if (!s.rows.length) return <div style={{ fontSize: 13, color: C.muted }}>No habits yet.</div>;
  if (s.span < 3) {
    return <div style={{ fontSize: 13, color: C.muted, lineHeight: 1.6 }}>
      Not enough history yet — check a few days off and this fills in. You can also load a demo history from “Edit habits”.
    </div>;
  }

  const card = { background: C.bg, borderRadius: 10, padding: "12px 14px" };
  const label = { fontSize: 12, color: C.muted, marginBottom: 4 };
  const value = { fontSize: 16, fontWeight: 600 };
  const pctOf = (r) => Math.round(r.rate * 100);
  const atRisk = s.rows.filter((r) => r.atRisk);

  const cards = (
    <div style={{ display: "grid", gridTemplateColumns: isPhone ? "1fr" : "repeat(3, 1fr)", gap: 12, marginBottom: 18 }}>
      <div style={card}>
        <div style={label}>Most consistent</div>
        <div style={value}>{s.best.habit.icon} {s.best.habit.name} · {pctOf(s.best)}%</div>
      </div>
      {s.worst && (
        <div style={card}>
          <div style={label}>Most missed</div>
          <div style={value}>{s.worst.habit.icon} {s.worst.habit.name} · {pctOf(s.worst)}%</div>
        </div>
      )}
      <div style={card}>
        <div style={label}>Longest streak</div>
        <div style={value}>{s.longest.best} {s.longest.best === 1 ? "day" : "days"} · {s.longest.habit.name}</div>
      </div>
    </div>
  );

  const prose = (
    <div style={{ fontSize: 13, color: C.muted, lineHeight: 1.7, marginBottom: 18 }}>
      {s.spread >= 0.08
        ? <>Across every habit you're strongest on <strong style={{ color: C.ink }}>{WD_FULL[s.bestDay]}s</strong> and
          weakest on <strong style={{ color: C.ink }}>{WD_FULL[s.worstDay]}s</strong>.</>
        : <>Your completion is even across the week — no weekday stands out.</>}
      {atRisk.length > 0 && (
        <> {atRisk.map((r) => r.habit.name).join(" and ")} {atRisk.length > 1 ? "have" : "has"} slipped
          noticeably in the last 30 days.</>
      )}
    </div>
  );

  if (isPhone) {
    return (
      <div>
        {cards}{prose}
        {s.ranked.map((r) => (
          <div key={r.habit.id} style={{ padding: "12px 0", borderTop: `1px solid ${C.border}` }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
              <span style={{ fontSize: 14 }}>{r.habit.icon}</span>
              <span style={{ flex: 1, minWidth: 0, fontSize: 14, fontWeight: 500, overflow: "hidden",
                textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.habit.name}</span>
              {r.atRisk && <span style={{ fontSize: 11, color: C.amber, border: `1px solid ${C.amber}`,
                borderRadius: 5, padding: "1px 6px" }}>at risk</span>}
              <span style={{ fontSize: 13, fontWeight: 600 }}>{pctOf(r)}%</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 12, color: C.muted }}>
              <span>{r.streak}d streak</span>
              <span>best {r.best}d</span>
              <Momentum C={C} value={r.momentum} />
              <div style={{ flex: 1 }} />
              <WeekdayStrip C={C} wd={r.wd} size={12} />
            </div>
          </div>
        ))}
      </div>
    );
  }

  const th = { textAlign: "left", fontSize: 11, fontWeight: 600, color: C.muted, padding: "0 10px 8px 0" };
  const td = { padding: "10px 10px 10px 0", fontSize: 13, borderTop: `1px solid ${C.border}` };

  return (
    <div>
      {cards}{prose}
      <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: font }}>
        <thead>
          <tr>
            <th style={th}>Habit</th><th style={th}>90-day rate</th><th style={th}>Streak</th>
            <th style={th}>Best</th><th style={th}>Last done</th><th style={th}>30d vs prior</th>
            <th style={{ ...th, paddingRight: 0 }}>By weekday (Mon–Sun)</th>
          </tr>
        </thead>
        <tbody>
          {s.ranked.map((r) => (
            <tr key={r.habit.id}>
              <td style={td}>
                <span style={{ marginRight: 7 }}>{r.habit.icon}</span>{r.habit.name}
                {r.atRisk && <span style={{ marginLeft: 8, fontSize: 11, color: C.amber,
                  border: `1px solid ${C.amber}`, borderRadius: 5, padding: "1px 6px" }}>at risk</span>}
              </td>
              <td style={td}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <div style={{ width: 70, height: 5, borderRadius: 3, background: C.ringTrack, overflow: "hidden" }}>
                    <div style={{ width: `${pctOf(r)}%`, height: "100%", background: C.accent }} />
                  </div>
                  <span style={{ color: C.muted }}>{pctOf(r)}%</span>
                </div>
              </td>
              <td style={td}>{r.streak}d</td>
              <td style={{ ...td, color: C.muted }}>{r.best}d</td>
              <td style={{ ...td, color: C.muted }}>{sinceLabel(r.lastKey)}</td>
              <td style={td}><Momentum C={C} value={r.momentum} /></td>
              <td style={{ ...td, paddingRight: 0 }}><WeekdayStrip C={C} wd={r.wd} /></td>
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ fontSize: 12, color: C.muted, marginTop: 12 }}>
        Weekday cells run Monday to Sunday — darker means you complete it more often that day.
      </div>
    </div>
  );
}
