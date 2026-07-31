import React from "react";

export function Modal({ C, title, onClose, children }) {
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(10,16,20,.45)", zIndex: 50,
      display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: C.surface, color: C.ink, borderRadius: 14,
        border: `1px solid ${C.border}`, padding: 22, width: "100%", maxWidth: 520, maxHeight: "85vh", overflowY: "auto" }}>
        <div style={{ display: "flex", alignItems: "center", marginBottom: 16 }}>
          <div style={{ fontWeight: 700, fontSize: 16, flex: 1 }}>{title}</div>
          <button onClick={onClose} style={{ border: `1px solid ${C.border}`, background: C.surface, color: C.muted,
            borderRadius: 8, padding: "4px 10px", cursor: "pointer", fontSize: 13 }}>✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}
