import React, { useState, useMemo } from "react";
import { Modal } from "./Modal.jsx";
import { defaultDeadlineStr } from "../lib/dates.js";
import { isHeading } from "../lib/tree.js";

export function ShrinkModal({ C, font, task, onClose, onAdd }) {
  const [steps, setSteps] = useState([""]);
  const canSave = steps.some((s) => s.trim());
  return (
    <Modal C={C} title={`Shrink: ${task.title}`} onClose={onClose}>
      <div style={{ fontSize: 14, lineHeight: 1.6, marginBottom: 14, color: C.muted }}>
        Big tasks stall because the first move is fuzzy. Use the <b style={{ color: C.ink }}>2-minute rule</b>:
        what is the <i>smallest physical action</i> you could do right now? “Open the file.” “Write one sentence.”
        “Name the test.” Don't plan the whole thing — just list the next few tiny moves. Then just start.
      </div>
      {steps.map((s, i) => (
        <input key={i} autoFocus={i === steps.length - 1} value={s}
          placeholder={i === 0 ? "Smallest next physical action…" : "Then maybe…"}
          onChange={(e) => setSteps((x) => x.map((y, j) => (j === i ? e.target.value : y)))}
          onKeyDown={(e) => { if (e.key === "Enter" && s.trim() && i === steps.length - 1) setSteps((x) => [...x, ""]); }}
          style={{ width: "100%", padding: "9px 11px", borderRadius: 8, fontSize: 14, marginBottom: 8,
            border: `1px solid ${C.border}`, background: C.bg, color: C.ink, fontFamily: font }} />
      ))}
      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
        <button disabled={!canSave} onClick={() => onAdd(steps.filter((s) => s.trim()))}
          style={{ fontFamily: font, fontSize: 13, fontWeight: 600, cursor: canSave ? "pointer" : "not-allowed",
            padding: "9px 16px", borderRadius: 8, border: `1px solid ${C.accent}`,
            background: canSave ? C.accent : C.border, color: canSave ? C.accentInk : C.muted, flex: 1 }}>
          Add micro-tasks & open them
        </button>
        <button onClick={onClose} style={{ fontFamily: font, fontSize: 13, fontWeight: 600, cursor: "pointer",
          padding: "9px 16px", borderRadius: 8, border: `1px solid ${C.border}`, background: C.surface, color: C.ink }}>Cancel</button>
      </div>
    </Modal>
  );
}

export function DeadlineModal({ C, font, node, onClose, onSave, onRemove, notifState, onEnableReminders }) {
  const [val, setVal] = useState(node.deadline || defaultDeadlineStr());
  return (
    <Modal C={C} title={`Deadline: ${node.title}`} onClose={onClose}>
      <div style={{ fontSize: 13, color: C.muted, lineHeight: 1.6, marginBottom: 14 }}>
        You'll get a reminder when it's within 24 hours, and again if it slips past due.
      </div>
      <input type="datetime-local" value={val} onChange={(e) => setVal(e.target.value)}
        style={{ width: "100%", padding: "10px 12px", borderRadius: 8, fontSize: 14, marginBottom: 14,
          border: `1px solid ${C.border}`, background: C.bg, color: C.ink, fontFamily: font }} />

      {notifState !== "granted" && notifState !== "unsupported" && (
        <div style={{ fontSize: 12, color: C.muted, marginBottom: 14, display: "flex", gap: 8, alignItems: "center" }}>
          <button onClick={onEnableReminders} style={{ fontFamily: font, fontSize: 12, fontWeight: 600, cursor: "pointer",
            padding: "6px 10px", borderRadius: 8, border: `1px solid ${C.accent}`, background: "transparent", color: C.accent }}>
            Enable desktop reminders
          </button>
          <span>otherwise you'll still get in-app alerts.</span>
        </div>
      )}

      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        {node.deadline && (
          <button onClick={onRemove} style={{ fontFamily: font, fontSize: 13, fontWeight: 600, cursor: "pointer",
            padding: "9px 16px", borderRadius: 8, border: `1px solid ${C.border}`, background: C.surface, color: C.danger, marginRight: "auto" }}>
            Remove deadline
          </button>
        )}
        <button onClick={onClose} style={{ fontFamily: font, fontSize: 13, fontWeight: 600, cursor: "pointer",
          padding: "9px 16px", borderRadius: 8, border: `1px solid ${C.border}`, background: C.surface, color: C.ink }}>Cancel</button>
        <button onClick={() => val && onSave(val)} style={{ fontFamily: font, fontSize: 13, fontWeight: 600, cursor: "pointer",
          padding: "9px 16px", borderRadius: 8, border: `1px solid ${C.accent}`, background: C.accent, color: C.accentInk }}>Save</button>
      </div>
    </Modal>
  );
}

export function MoveModal({ C, font, node, nodes, descendantsOf, onClose, onMove }) {
  const desc = descendantsOf(node.id);
  // every node outside this one's own subtree is a legal parent — there's no depth ceiling
  const candidates = useMemo(() => {
    const kidsOf = new Map();
    nodes.forEach((n) => {
      if (!kidsOf.has(n.parentId)) kidsOf.set(n.parentId, []);
      kidsOf.get(n.parentId).push(n);
    });
    const out = [];
    (function walk(pid, d) {
      (kidsOf.get(pid) || []).forEach((n) => {
        if (desc.has(n.id)) return; // skip the moving node and everything under it
        out.push({ n, d });
        walk(n.id, d + 1);
      });
    })(null, 0);
    return out;
  }, [nodes, desc]);
  const [sel, setSel] = useState("TOP");
  return (
    <Modal C={C} title={`Move: ${node.title}`} onClose={onClose}>
      <div style={{ fontSize: 13, color: C.muted, lineHeight: 1.6, marginBottom: 14 }}>
        Pick a new parent. The item and everything under it moves as a block.
      </div>
      <select value={sel} onChange={(e) => setSel(e.target.value)}
        style={{ width: "100%", padding: "10px 12px", borderRadius: 8, fontSize: 14, marginBottom: 16,
          border: `1px solid ${C.border}`, background: C.bg, color: C.ink, fontFamily: font }}>
        <option value="TOP">Top level</option>
        {candidates.map(({ n: c, d }) => (
          <option key={c.id} value={c.id}>{"— ".repeat(d)}{c.title}{isHeading(c) ? " (heading)" : ""}</option>
        ))}
      </select>
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button onClick={onClose} style={{ fontFamily: font, fontSize: 13, fontWeight: 600, cursor: "pointer",
          padding: "9px 16px", borderRadius: 8, border: `1px solid ${C.border}`, background: C.surface, color: C.ink }}>Cancel</button>
        <button onClick={() => onMove(sel === "TOP" ? null : sel)} style={{ fontFamily: font, fontSize: 13, fontWeight: 600, cursor: "pointer",
          padding: "9px 16px", borderRadius: 8, border: `1px solid ${C.accent}`, background: C.accent, color: C.accentInk }}>Move here</button>
      </div>
    </Modal>
  );
}
