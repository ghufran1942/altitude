import React, { useState } from "react";
import { todayKey } from "../../lib/dates.js";
import { describeSchedule, hasSchedule } from "../../lib/reminders.js";
import { HabitSchedule } from "./HabitSchedule.jsx";

export function HabitManager({ C, font, habits, onChange, onLoadDemo, onClearHistory, hasHistory,
  allowDemo, isDemo, loc, onNeedLocation }) {
  const [draft, setDraft] = useState("");
  const [confirmClear, setConfirmClear] = useState(false);
  const [openId, setOpenId] = useState(null);
  const live = habits.filter((h) => h.active).sort((a, b) => a.order - b.order);
  const small = { fontFamily: font, fontSize: 12, fontWeight: 600, cursor: "pointer", padding: "4px 8px",
    borderRadius: 6, border: `1px solid ${C.border}`, background: C.surface, color: C.muted };
  const field = { padding: "7px 9px", borderRadius: 8, border: `1px solid ${C.border}`,
    background: C.bg, color: C.ink, fontFamily: font, fontSize: 13 };

  const add = () => {
    const name = draft.trim();
    if (!name) return;
    onChange([...habits, { id: `hb-${Date.now().toString(36)}`, name, icon: "✅",
      order: live.length, active: true, createdAt: todayKey() }]);
    setDraft("");
  };
  const patch = (id, p) => onChange(habits.map((h) => (h.id === id ? { ...h, ...p } : h)));
  const swap = (id, dir) => {
    const i = live.findIndex((h) => h.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= live.length) return;
    const a = live[i], b = live[j];
    onChange(habits.map((h) =>
      h.id === a.id ? { ...h, order: b.order } : h.id === b.id ? { ...h, order: a.order } : h));
  };

  return (
    <div>
      {live.map((h, i) => {
        const open = openId === h.id;
        const summary = describeSchedule(h);
        const nRem = h.reminders?.length || 0;
        return (
          <div key={h.id} style={{ borderBottom: `1px solid ${C.border}` }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 0" }}>
              <input value={h.icon} onChange={(e) => patch(h.id, { icon: e.target.value.slice(0, 2) })}
                aria-label={`Icon for ${h.name}`} style={{ ...field, width: 42, textAlign: "center" }} />
              <input value={h.name} onChange={(e) => patch(h.id, { name: e.target.value })}
                aria-label="Habit name" style={{ ...field, flex: 1, minWidth: 0 }} />
              <button style={small} onClick={() => swap(h.id, -1)} disabled={i === 0} aria-label="Move up">↑</button>
              <button style={small} onClick={() => swap(h.id, 1)} disabled={i === live.length - 1} aria-label="Move down">↓</button>
              <button style={{ ...small, color: C.danger }}
                onClick={() => patch(h.id, { active: false })}>Retire</button>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "0 0 8px 50px", flexWrap: "wrap" }}>
              <button onClick={() => setOpenId(open ? null : h.id)}
                aria-expanded={open}
                style={{ ...small, borderColor: hasSchedule(h) ? C.accent : C.border,
                  color: hasSchedule(h) ? C.accent : C.muted }}>
                {open ? "▾" : "▸"} {summary ? `⏰ ${summary}` : "⏰ Anytime"}
                {nRem ? ` · ${nRem} reminder${nRem > 1 ? "s" : ""}` : ""}
              </button>
            </div>
            {open && (
              <HabitSchedule C={C} font={font} habit={h} loc={loc} onNeedLocation={onNeedLocation}
                onChange={(p) => patch(h.id, p)} />
            )}
          </div>
        );
      })}
      <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
        <input value={draft} onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") add(); }}
          placeholder="New habit" style={{ ...field, flex: 1 }} />
        <button onClick={add} style={{ ...small, background: C.accent, color: C.accentInk,
          borderColor: C.accent, fontSize: 13, padding: "7px 14px" }}>Add</button>
      </div>
      <div style={{ fontSize: 12, color: C.muted, marginTop: 12, lineHeight: 1.6 }}>
        Retiring a habit hides it from today's list but keeps every past check in the history.
      </div>
      <div style={{ borderTop: `1px solid ${C.border}`, marginTop: 18, paddingTop: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
          Demo data{isDemo && <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 600, color: C.amber,
            border: `1px solid ${C.amber}`, borderRadius: 5, padding: "1px 6px" }}>active</span>}
        </div>
        {!allowDemo ? (
          <div style={{ fontSize: 12, color: C.muted, lineHeight: 1.6 }}>
            Off while you're signed in — demo history would sync to your other devices and overwrite
            real data. Sign out and choose “use without an account” to try it.
          </div>
        ) : (<>
        <div style={{ fontSize: 12, color: C.muted, lineHeight: 1.6, marginBottom: 10 }}>
          Fills 120 days of invented history for the habits above, so the analytics have something to
          show. This replaces your real habit history — ⌘Z undoes it. Demo history stays on this
          device and is dropped if you later sign in.
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button style={{ ...small, fontSize: 13, padding: "7px 12px" }} onClick={onLoadDemo}>Load demo history</button>
          {hasHistory && (confirmClear ? (
            <>
              <button style={{ ...small, fontSize: 13, padding: "7px 12px", color: C.danger, borderColor: C.danger }}
                onClick={() => { onClearHistory(); setConfirmClear(false); }}>Yes, clear everything</button>
              <button style={{ ...small, fontSize: 13, padding: "7px 12px" }}
                onClick={() => setConfirmClear(false)}>Cancel</button>
            </>
          ) : (
            <button style={{ ...small, fontSize: 13, padding: "7px 12px", color: C.danger }}
              onClick={() => setConfirmClear(true)}>Clear all history</button>
          ))}
        </div>
        </>)}
      </div>
    </div>
  );
}
