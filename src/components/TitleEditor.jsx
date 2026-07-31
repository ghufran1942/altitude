import React, { useState, useEffect, useRef } from "react";

/* The title editor is mounted only while a row is being edited, so its draft
   state resets naturally as focus moves from row to row. */
export function TitleEditor({ C, font, initial, seq, heading, onCommit, onKey }) {
  const [v, setV] = useState(initial);
  const ref = useRef(null);
  // pull focus back after an indent/outdent has re-rendered the row
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    const end = el.value.length;
    el.setSelectionRange(end, end);
  }, [seq]);
  return (
    <input ref={ref} autoFocus value={v}
      onChange={(e) => setV(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => onKey(e, v, setV)}
      onBlur={() => onCommit(v)}
      style={{ flex: 1, minWidth: 0, width: "100%", padding: "4px 6px", borderRadius: 6,
        fontFamily: font, background: C.bg, color: C.ink, border: `1px solid ${C.accent}`,
        fontSize: heading ? 12 : 14, fontWeight: heading ? 700 : 500,
        letterSpacing: heading ? ".07em" : 0, textTransform: heading ? "uppercase" : "none" }} />
  );
}
