import React from "react";

/* small inline glyphs for the deadline line */
export const CalGlyph = ({ c }) => (
  <svg width="12" height="12" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0 }} aria-hidden="true">
    <rect x="1.5" y="2.5" width="13" height="12" rx="2" stroke={c} strokeWidth="1.5" />
    <path d="M1.5 6.5h13" stroke={c} strokeWidth="1.5" />
  </svg>
);

export const AlarmGlyph = ({ c }) => (
  <svg width="12" height="12" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0 }} aria-hidden="true">
    <circle cx="8" cy="9" r="5.25" stroke={c} strokeWidth="1.5" />
    <path d="M8 6.5V9l1.75 1.25M2.5 3.25l2-1.75M13.5 3.25l-2-1.75" stroke={c} strokeWidth="1.5" strokeLinecap="round" />
  </svg>
);
