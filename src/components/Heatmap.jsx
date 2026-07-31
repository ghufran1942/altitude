import React, { useMemo } from "react";
import { MONTHS, todayKey } from "../lib/dates.js";
import { counts } from "../lib/tree.js";

export function levelFor(count) {
  if (count <= 0) return 0;
  if (count === 1) return 1;
  if (count <= 3) return 2;
  if (count <= 6) return 3;
  return 4;
}

export function Heatmap({ C, completions }) {
  const counts = useMemo(() => {
    const m = {};
    completions.forEach((k) => { m[k] = (m[k] || 0) + 1; });
    return m;
  }, [completions]);

  const { weeks, monthLabels } = useMemo(() => {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const start = new Date(today);
    start.setDate(start.getDate() - 364);
    start.setDate(start.getDate() - start.getDay()); // back to Sunday
    const wk = [];
    const cursor = new Date(start);
    while (cursor <= today) {
      const col = [];
      for (let d = 0; d < 7; d++) {
        if (cursor > today) col.push(null);
        else col.push({ key: todayKey(cursor), count: counts[todayKey(cursor)] || 0, date: new Date(cursor) });
        cursor.setDate(cursor.getDate() + 1);
      }
      wk.push(col);
    }
    let lastMonth = -1;
    const labels = wk.map((col) => {
      const first = col.find((c) => c);
      if (!first) return "";
      const m = first.date.getMonth();
      if (m !== lastMonth) { lastMonth = m; return MONTHS[m]; }
      return "";
    });
    return { weeks: wk, monthLabels: labels };
  }, [counts]);

  const cell = 12, gap = 3, colW = cell + gap;
  const totalContribs = Object.values(counts).reduce((a, b) => a + b, 0);

  return (
    <div>
      <div style={{ overflowX: "auto", paddingBottom: 6 }}>
        <div style={{ display: "inline-block", minWidth: "min-content" }}>
          {/* month labels */}
          <div style={{ display: "flex", marginLeft: 30, height: 16 }}>
            {monthLabels.map((m, i) => (
              <div key={i} style={{ width: colW, fontSize: 10, color: C.muted, whiteSpace: "nowrap", overflow: "visible", position: "relative" }}>{m}</div>
            ))}
          </div>
          <div style={{ display: "flex" }}>
            {/* day labels */}
            <div style={{ width: 30, display: "flex", flexDirection: "column", gap, paddingTop: 0 }}>
              {["", "Mon", "", "Wed", "", "Fri", ""].map((d, i) => (
                <div key={i} style={{ height: cell, fontSize: 9, color: C.muted, lineHeight: `${cell}px` }}>{d}</div>
              ))}
            </div>
            {/* grid */}
            <div style={{ display: "flex", gap }}>
              {weeks.map((col, wi) => (
                <div key={wi} style={{ display: "flex", flexDirection: "column", gap }}>
                  {col.map((c, di) => {
                    if (!c) return <div key={di} style={{ width: cell, height: cell }} />;
                    const lvl = levelFor(c.count);
                    const bg = lvl === 0 ? C.heatEmpty : C.heatRamp[lvl - 1];
                    return (
                      <div key={di} title={`${c.count} on ${c.date.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" })}`}
                        style={{ width: cell, height: cell, borderRadius: 3, background: bg }} />
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 10, flexWrap: "wrap" }}>
        <span style={{ fontSize: 12, color: C.muted }}>{totalContribs} contribution{totalContribs !== 1 ? "s" : ""} in the last year</span>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 11, color: C.muted }}>Less</span>
        <div style={{ width: cell, height: cell, borderRadius: 3, background: C.heatEmpty }} />
        {C.heatRamp.map((c, i) => <div key={i} style={{ width: cell, height: cell, borderRadius: 3, background: c }} />)}
        <span style={{ fontSize: 11, color: C.muted }}>More</span>
      </div>
    </div>
  );
}
