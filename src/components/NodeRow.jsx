import React from "react";
import { TitleEditor } from "./TitleEditor.jsx";
import { AlarmGlyph, CalGlyph } from "./glyphs.jsx";
import { INDENT } from "../lib/constants.js";
import { deadlineState, fmtDeadline } from "../lib/dates.js";
import { isHeading } from "../lib/tree.js";

export function NodeRow({ n, C, font, depth, hasKids, p, isActive, remindersOn, menuOpen, onToggleMenu,
  onZoomIn, onToggle, onToggleExpand, onAddChild, onRequestDelete, onActivate,
  onShrink, onSetDeadline, onMove, dragging, dropPos, onDragStart,
  editing, editSeq, onStartEdit, onCommitEdit, onEditKey, compact }) {
  const heading = isHeading(n);
  const done = !!n.done;
  const pct = p ? Math.round((100 * p.done) / p.total) : 0;
  const dstate = deadlineState(n.deadline);
  const dcol = dstate === "overdue" ? C.danger : dstate === "soon" ? C.amber : C.accent;

  /* Indentation is tighter on a narrow screen and stops growing after a few
     levels, so a deep branch can't push the row off the side of the phone. */
  const step = compact ? 10 : INDENT;
  const pad = Math.min(depth, compact ? 4 : 12) * step;

  // a line above/below for reordering, a ring for "drop inside"
  const dropStyle =
    dropPos === "before" ? { boxShadow: `0 -2px 0 0 ${C.accent}` }
    : dropPos === "after" ? { boxShadow: `0 2px 0 0 ${C.accent}` }
    : dropPos === "inside" ? { boxShadow: `0 0 0 2px ${C.accent}` }
    : null;

  const smallBtn = { fontFamily: font, fontSize: 11, fontWeight: 600, cursor: "pointer",
    padding: "4px 8px", borderRadius: 6, border: `1px solid ${C.border}`, background: C.surface, color: C.muted };
  const menuItem = { display: "block", width: "100%", textAlign: "left", fontFamily: font, fontSize: 13,
    padding: "8px 12px", background: "none", border: "none", cursor: "pointer", color: C.ink };

  const editor = (
    <TitleEditor C={C} font={font} initial={n.title} seq={editSeq} heading={heading}
      onCommit={onCommitEdit} onKey={onEditKey} />
  );

  const grip = (
    <button className="grip" onPointerDown={onDragStart} onClick={(e) => e.stopPropagation()}
      title="Drag to reorder or re-nest" aria-label="Drag to reorder"
      style={{ width: 14, flexShrink: 0, border: "none", background: "none", padding: 0, lineHeight: 1,
        fontSize: 13, color: C.muted, cursor: "grab", touchAction: "none" }}>⠿</button>
  );

  const caret = (
    <button onClick={(e) => { e.stopPropagation(); onToggleExpand(e.altKey); }}
      title={n.expanded ? "Collapse (alt-click for the whole subtree)" : "Expand (alt-click for the whole subtree)"}
      aria-expanded={hasKids ? !!n.expanded : undefined}
      style={{ width: 14, height: 14, flexShrink: 0, border: "none", background: "none", padding: 0,
        lineHeight: 1, fontSize: 9, color: C.muted, cursor: "pointer",
        visibility: hasKids ? "visible" : "hidden",
        transform: n.expanded ? "none" : "rotate(-90deg)", transition: "transform .12s" }}>▼</button>
  );

  const bar = p && (
    <div title={`${p.done} of ${p.total} direct children done`}
      style={{ width: compact ? 22 : 34, height: 6, borderRadius: 3, background: C.ringTrack,
        overflow: "hidden", flexShrink: 0 }}>
      <div style={{ width: `${pct}%`, height: "100%", background: C.accent }} />
    </div>
  );

  const actions = (
    <div className="rowActions" style={{ display: "flex", gap: 4, flexShrink: 0, alignItems: "center" }}>
      {!compact && !heading && !hasKids && (
        <button style={{ ...smallBtn, ...(isActive ? { background: C.accent, color: C.accentInk, borderColor: C.accent } : {}) }}
          onClick={(e) => { e.stopPropagation(); onActivate(); }} title="Link to the Pomodoro timer">
          {isActive ? "◉ active" : "focus"}
        </button>
      )}
      {!compact && !heading && (
        <button style={smallBtn} onClick={(e) => { e.stopPropagation(); onShrink(); }}
          title="Feels too big? Break it into micro-steps">shrink</button>
      )}
      {!compact && (
        <button style={smallBtn} onClick={(e) => { e.stopPropagation(); onAddChild(); }}
          title="Add something under this">＋</button>
      )}
      {!compact && (
        <button style={smallBtn} onClick={(e) => { e.stopPropagation(); onZoomIn(); }}
          title="Zoom in so this is the only thing on screen">open ▸</button>
      )}
      <button style={{ ...smallBtn, ...(compact && isActive ? { background: C.accent, color: C.accentInk, borderColor: C.accent } : {}) }}
        onClick={onToggleMenu} title="More">⋯</button>
    </div>
  );

  const menu = menuOpen && (
    <div onClick={(e) => e.stopPropagation()} style={{ position: "absolute", top: "100%", right: 8, marginTop: 4, zIndex: 15,
      background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, boxShadow: "0 8px 24px rgba(0,0,0,.18)",
      minWidth: 180, overflow: "hidden" }}>
      {/* on a narrow screen these four live here instead of on the row */}
      {compact && (
        <button style={menuItem} onClick={onZoomIn}>Open ▸</button>
      )}
      {compact && (
        <button style={menuItem} onClick={onAddChild}>Add item inside</button>
      )}
      {compact && !heading && (
        <button style={menuItem} onClick={onShrink}>Break into micro-steps</button>
      )}
      {compact && !heading && !hasKids && (
        <button style={menuItem} onClick={onActivate}>
          {isActive ? "◉ Unlink from timer" : "Link to timer"}
        </button>
      )}
      {compact && <div style={{ borderTop: `1px solid ${C.border}` }} />}
      <button style={menuItem} onClick={() => { onStartEdit(); onToggleMenu({ stopPropagation() {} }); }}>Rename</button>
      {!heading && (
        <button style={menuItem} onClick={onSetDeadline}>{n.deadline ? "Edit deadline" : "Set deadline"}</button>
      )}
      <button style={menuItem} onClick={onMove}>Move / re-parent</button>
      <button style={{ ...menuItem, color: C.danger, borderTop: `1px solid ${C.border}` }} onClick={onRequestDelete}>Delete</button>
    </div>
  );

  /* ---- heading: a Reminders-style section label, no checkbox ---- */
  if (heading) {
    return (
      <div className="row" data-node-id={n.id} onDoubleClick={onZoomIn} title="Double-click to zoom in"
        style={{ position: "relative", display: "flex", alignItems: "center", gap: 8, cursor: "pointer",
          marginLeft: pad, padding: "12px 4px 4px", borderBottom: `1px solid ${C.border}`,
          opacity: dragging ? 0.4 : 1, userSelect: "none", ...dropStyle }}>
        {grip}
        {caret}
        {editing ? editor : (
          <span onClick={(e) => { e.stopPropagation(); onStartEdit(); }}
            onDoubleClick={(e) => e.stopPropagation()} title="Click to edit"
            style={{ flex: 1, minWidth: 0, fontSize: 12, fontWeight: 700, letterSpacing: ".07em",
            textTransform: "uppercase", color: C.muted, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            {n.title}
            {p && <span style={{ fontWeight: 600, letterSpacing: 0 }}>{p.done}/{p.total}</span>}
          </span>
        )}
        {bar}
        {actions}
        {menu}
      </div>
    );
  }

  /* ---- item ---- */
  return (
    <div className="row" data-node-id={n.id} onDoubleClick={onZoomIn} title="Double-click to zoom in"
      style={{ position: "relative", display: "flex", alignItems: "flex-start",
        gap: compact ? 8 : 10, padding: compact ? "10px 8px" : "10px 12px",
        marginLeft: pad, cursor: "pointer", opacity: dragging ? 0.4 : 1, userSelect: "none",
        border: `1px solid ${isActive ? C.accent : C.border}`, borderRadius: 10,
        background: isActive ? (C.bg === "#101820" ? "#152a25" : "#F0F7F5") : C.surface, ...dropStyle }}>
      <div style={{ display: "flex", alignItems: "center", gap: compact ? 6 : 8, paddingTop: 1, flexShrink: 0 }}>
        {grip}
        {caret}
        <button onClick={(e) => { e.stopPropagation(); onToggle(); }}
          aria-label={done ? "Mark not done" : "Mark done"} aria-pressed={done}
          title={hasKids ? "Checking this checks everything under it" : undefined}
          style={{ width: 19, height: 19, borderRadius: "50%", flexShrink: 0, padding: 0, cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center", lineHeight: 1, fontSize: 11,
            border: `1.5px solid ${done ? C.accent : C.border}`,
            background: done ? C.accent : "transparent", color: C.accentInk }}>
          {done ? "✓" : ""}
        </button>
        {bar}
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        {editing ? editor : (
          <div onClick={(e) => { e.stopPropagation(); onStartEdit(); }}
            onDoubleClick={(e) => e.stopPropagation()} title="Click to edit"
            style={{ fontSize: 14, fontWeight: 500, textDecoration: done ? "line-through" : "none",
            color: done ? C.muted : C.ink, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            {n.title}
            {p && <span style={{ fontSize: 11, color: C.muted }}>{p.done}/{p.total} · {pct}%</span>}
          </div>
        )}
        {n.deadline && !editing && (
          <button onClick={(e) => { e.stopPropagation(); onSetDeadline(); }} title="Edit deadline"
            style={{ display: "inline-flex", alignItems: "center", gap: 5, marginTop: 4, padding: 0,
              background: "none", border: "none", cursor: "pointer", fontFamily: font,
              fontSize: 12, fontWeight: 600, color: done ? C.muted : dcol }}>
            <CalGlyph c={done ? C.muted : dcol} />
            {fmtDeadline(n.deadline)}
            {remindersOn && <AlarmGlyph c={done ? C.muted : dcol} />}
          </button>
        )}
      </div>

      {actions}
      {menu}
    </div>
  );
}
