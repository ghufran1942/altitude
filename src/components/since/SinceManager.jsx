import React, { useState } from "react";
import { todayKey } from "../../lib/dates.js";
import { newSinceItem, resetsFor, sinceStats } from "../../lib/since.js";

export function SinceManager({ C, font, items, log, onChange, onAddReset, onRemoveReset }) {
  const [draft, setDraft] = useState("");
  const [kind, setKind] = useState("reset");
  const [openId, setOpenId] = useState(null);   // which item's reset history is expanded
  const [backdate, setBackdate] = useState(todayKey());

  const live = items.filter((i) => i.active).sort((a, b) => a.order - b.order);
  const small = { fontFamily: font, fontSize: 12, fontWeight: 600, cursor: "pointer",
    padding: "4px 8px", borderRadius: 6, border: `1px solid ${C.border}`,
    background: C.surface, color: C.muted };
  const field = { padding: "7px 9px", borderRadius: 8, border: `1px solid ${C.border}`,
    background: C.bg, color: C.ink, fontFamily: font, fontSize: 13 };

  const add = () => {
    const name = draft.trim();
    if (!name) return;
    onChange([...items, { ...newSinceItem(name, kind), order: live.length }]);
    setDraft("");
  };
  const patch = (id, p) => onChange(items.map((i) => (i.id === id ? { ...i, ...p } : i)));
  const swap = (id, dir) => {
    const a = live.findIndex((i) => i.id === id);
    const b = a + dir;
    if (a < 0 || b < 0 || b >= live.length) return;
    const x = live[a], y = live[b];
    onChange(items.map((i) =>
      i.id === x.id ? { ...i, order: y.order } : i.id === y.id ? { ...i, order: x.order } : i));
  };

  return (
    <div>
      {live.map((item, idx) => {
        const s = sinceStats(item, log);
        const resets = resetsFor(log, item.id);
        const open = openId === item.id;
        return (
          <div key={item.id} style={{ padding: "10px 0", borderBottom: `1px solid ${C.border}` }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <input value={item.icon} onChange={(e) => patch(item.id, { icon: e.target.value.slice(0, 2) })}
                aria-label={`Icon for ${item.name}`} style={{ ...field, width: 42, textAlign: "center" }} />
              <input value={item.name} onChange={(e) => patch(item.id, { name: e.target.value })}
                aria-label="Tracker name" style={{ ...field, flex: 1, minWidth: 0 }} />
              <button style={small} onClick={() => swap(item.id, -1)} disabled={idx === 0} aria-label="Move up">↑</button>
              <button style={small} onClick={() => swap(item.id, 1)} disabled={idx === live.length - 1} aria-label="Move down">↓</button>
              <button style={{ ...small, color: C.danger }} onClick={() => patch(item.id, { active: false })}>Retire</button>
            </div>

            {item.kind === "anchor" ? (
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8, paddingLeft: 50 }}>
                <span style={{ fontSize: 12, color: C.muted }}>Counting from</span>
                <input type="date" value={item.anchorDate || todayKey()} max={todayKey()}
                  onChange={(e) => e.target.value && patch(item.id, { anchorDate: e.target.value })}
                  aria-label={`Start date for ${item.name}`} style={{ ...field, fontSize: 12 }} />
                <span style={{ fontSize: 12, color: C.muted }}>{s.days} days</span>
              </div>
            ) : (
              <div style={{ marginTop: 8, paddingLeft: 50 }}>
                <button style={{ ...small, fontSize: 12 }}
                  onClick={() => { setOpenId(open ? null : item.id); setBackdate(todayKey()); }}>
                  {resets.length} reset{resets.length === 1 ? "" : "s"} {open ? "▴" : "▾"}
                </button>
                {open && (
                  <div style={{ marginTop: 8 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                      <input type="date" value={backdate} max={todayKey()}
                        onChange={(e) => setBackdate(e.target.value)}
                        aria-label="Reset date" style={{ ...field, fontSize: 12 }} />
                      <button style={{ ...small, fontSize: 12 }}
                        onClick={() => backdate && onAddReset(item.id, backdate)}>Add reset</button>
                    </div>
                    {resets.length === 0 ? (
                      <div style={{ fontSize: 12, color: C.muted }}>No resets recorded.</div>
                    ) : resets.map((k) => (
                      <div key={k} style={{ display: "flex", alignItems: "center", gap: 8, padding: "3px 0" }}>
                        <span style={{ fontSize: 12, color: C.muted, minWidth: 92 }}>{k}</span>
                        <button style={{ ...small, fontSize: 11, padding: "2px 7px", color: C.danger }}
                          onClick={() => onRemoveReset(item.id, k)}>Remove</button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}

      <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
        <input value={draft} onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") add(); }}
          placeholder="New tracker" style={{ ...field, flex: 1, minWidth: 140 }} />
        <div style={{ display: "flex", gap: 4 }}>
          {[["reset", "Resettable"], ["anchor", "Fixed date"]].map(([k, label]) => (
            <button key={k} onClick={() => setKind(k)}
              style={{ ...small, fontSize: 12,
                border: `1px solid ${kind === k ? C.accent : C.border}`,
                background: kind === k ? C.accent : "transparent",
                color: kind === k ? C.accentInk : C.muted }}>{label}</button>
          ))}
        </div>
        <button onClick={add} style={{ ...small, background: C.accent, color: C.accentInk,
          borderColor: C.accent, fontSize: 13, padding: "7px 14px" }}>Add</button>
      </div>

      <div style={{ fontSize: 12, color: C.muted, marginTop: 12, lineHeight: 1.6 }}>
        A <strong style={{ color: C.ink }}>resettable</strong> tracker counts up until you reset it —
        good for streaks you're protecting. A <strong style={{ color: C.ink }}>fixed date</strong> tracker
        counts from a day that never changes. Retiring keeps the history.
      </div>
    </div>
  );
}
