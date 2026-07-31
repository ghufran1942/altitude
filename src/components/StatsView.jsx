import React from "react";
import { todayKey } from "../lib/dates.js";
import { counts } from "../lib/tree.js";

export function StatsView({ C, sessions, nodeById, streak }) {
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(); d.setDate(d.getDate() - (6 - i));
    const key = todayKey(d);
    return { key, label: d.toLocaleDateString([], { weekday: "short" }), count: sessions.filter((s) => s.dateKey === key).length };
  });
  const max = Math.max(1, ...days.map((d) => d.count));
  const byTask = new Map();
  sessions.forEach((s) => { if (s.taskId) byTask.set(s.taskId, (byTask.get(s.taskId) || 0) + 1); });
  const top = [...byTask.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);

  return (
    <div>
      <div style={{ fontSize: 13, color: C.muted, marginBottom: 8 }}>Pomodoros, last 7 days</div>
      <div style={{ display: "flex", gap: 8, alignItems: "flex-end", height: 100, marginBottom: 6 }}>
        {days.map((d) => (
          <div key={d.key} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
            <div style={{ fontSize: 11, color: C.muted }}>{d.count || ""}</div>
            <div style={{ width: "100%", borderRadius: "4px 4px 0 0", background: C.accent,
              height: `${(d.count / max) * 70}px`, minHeight: d.count ? 4 : 1, opacity: d.count ? 1 : 0.15 }} />
          </div>
        ))}
      </div>
      <div style={{ display: "flex", gap: 8, marginBottom: 18 }}>
        {days.map((d) => <div key={d.key} style={{ flex: 1, textAlign: "center", fontSize: 11, color: C.muted }}>{d.label}</div>)}
      </div>

      <div style={{ fontSize: 13, color: C.muted, marginBottom: 8 }}>Most-focused tasks</div>
      {top.length === 0 ? (
        <div style={{ fontSize: 13, color: C.muted }}>Link a task to the timer and the leaderboard fills in.</div>
      ) : (
        top.map(([id, c]) => (
          <div key={id} style={{ display: "flex", justifyContent: "space-between", fontSize: 14, padding: "6px 0", borderBottom: `1px solid ${C.border}` }}>
            <span>{nodeById.get(id)?.title || "(deleted task)"}</span><b>{c}</b>
          </div>
        ))
      )}
      <div style={{ marginTop: 18, fontSize: 13, color: C.muted }}>
        Streak: <b style={{ color: C.amber }}>{streak.current} days</b> · best {streak.best}.
        A streak survives on one pomodoro or one checked-off item — small counts.
      </div>
    </div>
  );
}
