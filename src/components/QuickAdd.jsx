import React, { useState } from "react";
import { shiftKey } from "../lib/dates.js";

export function QuickAdd({ C, font, placeholder, onAdd, onAddHeading, onEscape, inputRef, autoFocus, compact }) {
  const [v, setV] = useState("");
  function submit(asHeading) {
    if (!v.trim()) return;
    (asHeading && onAddHeading ? onAddHeading : onAdd)(v);
    setV("");
  }
  return (
    <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 14, maxWidth: "100%" }}>
      <input ref={inputRef} autoFocus={autoFocus} value={v} placeholder={placeholder}
        onChange={(e) => setV(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); submit(e.shiftKey); }
          if (e.key === "Escape") { setV(""); onEscape?.(); }
        }}
        style={{ flex: 1, minWidth: 0, padding: "10px 12px", borderRadius: 10, fontSize: 14,
          border: `1px dashed ${C.border}`, background: "transparent", color: C.ink, fontFamily: font }} />
      {onAddHeading && (
        <button onClick={() => submit(true)} title="Add as a heading (or Shift+Enter)"
          style={{ fontFamily: font, fontSize: compact ? 14 : 11, fontWeight: 700, letterSpacing: ".04em",
            cursor: "pointer", padding: compact ? "9px 12px" : "9px 10px", borderRadius: 8, flexShrink: 0,
            border: `1px dashed ${C.border}`, whiteSpace: "nowrap", background: "transparent", color: C.muted }}>
          {compact ? "＃" : "＋ heading"}
        </button>
      )}
    </div>
  );
}
