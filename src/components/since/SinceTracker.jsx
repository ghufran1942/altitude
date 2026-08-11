import React from "react";
import { todayKey } from "../../lib/dates.js";
import { sinceStats } from "../../lib/since.js";

/** One row: the count, what it's counting from, and the reset control. */
function SinceRow({ C, font, item, log, compact, onReset, pending, onArm, onCancel }) {
  const s = sinceStats(item, log);
  const isAnchor = s.kind === "anchor";

  const chip = { fontFamily: font, fontSize: 12, fontWeight: 600, cursor: "pointer",
    padding: "5px 10px", borderRadius: 8, border: `1px solid ${C.border}`,
    background: C.surface, color: C.muted };

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "14px 0",
      borderTop: `1px solid ${C.border}`, flexWrap: compact ? "wrap" : "nowrap" }}>

      <div style={{ display: "flex", alignItems: "baseline", gap: 8, minWidth: 96 }}>
        <span style={{ fontFamily: font, fontSize: 30, fontWeight: 700, lineHeight: 1,
          color: s.isRecord ? C.accent : C.ink }}>{s.days}</span>
        <span style={{ fontSize: 12, color: C.muted }}>{s.days === 1 ? "day" : "days"}</span>
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 3 }}>
          <span style={{ fontSize: 15, flexShrink: 0 }}>{item.icon}</span>
          <span style={{ fontSize: 14, fontWeight: 500, overflow: "hidden",
            textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.name}</span>
          {s.isRecord && (
            <span style={{ fontSize: 11, fontWeight: 600, color: C.accent, flexShrink: 0,
              border: `1px solid ${C.accent}`, borderRadius: 5, padding: "1px 6px" }}>record</span>
          )}
        </div>
        <div style={{ fontSize: 12, color: C.muted }}>
          {isAnchor ? `since ${s.from}` : s.lastReset ? `since ${s.from}` : `since you started tracking`}
          {!isAnchor && s.best > s.days ? ` · best ${s.best}` : ""}
          {s.toNext !== null ? ` · ${s.toNext} to ${s.next}` : ""}
        </div>
      </div>

      {!isAnchor && (
        pending ? (
          <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
            <button style={{ ...chip, color: C.danger, borderColor: C.danger }}
              onClick={() => onReset(item.id, todayKey())}>Reset to 0</button>
            <button style={chip} onClick={onCancel}>Cancel</button>
          </div>
        ) : (
          <button style={{ ...chip, flexShrink: 0 }} onClick={onArm}>Reset</button>
        )
      )}
    </div>
  );
}

export function SinceTracker({ C, font, display, items, log, onReset, onManage,
  compact, armedId, onArm, onCancelArm }) {
  const live = items.filter((i) => i.active).sort((a, b) => a.order - b.order);
  const chip = { fontFamily: font, fontSize: 12, fontWeight: 600, cursor: "pointer",
    padding: "4px 10px", borderRadius: 8, border: `1px solid ${C.border}`,
    background: C.surface, color: C.muted };

  if (!live.length) {
    return (
      <div>
        <div style={{ fontSize: 13, color: C.muted, padding: "10px 0", lineHeight: 1.6 }}>
          Nothing tracked yet. Add a counter you reset when it happens, or a fixed date to count up from.
        </div>
        <button style={{ ...chip, fontSize: 13, padding: "7px 12px" }} onClick={onManage}>
          Add a tracker
        </button>
      </div>
    );
  }

  return (
    <div>
      {live.map((item) => (
        <SinceRow key={item.id} C={C} font={font} item={item} log={log} compact={compact}
          onReset={onReset} pending={armedId === item.id}
          onArm={() => onArm(item.id)} onCancel={onCancelArm} />
      ))}
    </div>
  );
}
