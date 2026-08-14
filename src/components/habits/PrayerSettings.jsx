import React, { useMemo, useState } from "react";
import { CITIES, nearestCity, searchCities } from "../../lib/prayer/cities.js";
import { METHODS, PRAYERS, fmtTime, prayerTimesFor } from "../../lib/prayer/prayerTimes.js";
import { todayKey } from "../../lib/dates.js";

/* Location and calculation settings for prayer times, with today's result shown
   underneath — the fastest way to tell whether a method matches your masjid. */
export function PrayerSettings({ C, font, prayer, onChange, onAddPrayerHabits, hasPrayerHabits }) {
  const [query, setQuery] = useState("");
  const [geoState, setGeoState] = useState(null); // null | "asking" | "denied" | "unavailable"

  const field = { padding: "7px 9px", borderRadius: 8, border: `1px solid ${C.border}`,
    background: C.bg, color: C.ink, fontFamily: font, fontSize: 13 };
  const btn = (primary) => ({ fontFamily: font, fontSize: 12, fontWeight: 600, cursor: "pointer",
    padding: "6px 11px", borderRadius: 8, border: `1px solid ${primary ? C.accent : C.border}`,
    background: primary ? C.accent : C.surface, color: primary ? C.accentInk : C.muted });

  const results = useMemo(() => searchCities(query), [query]);
  const set = (patch) => onChange({ ...prayer, ...patch });
  const chooseCity = (c) => {
    set({ cityId: c.id, label: c.name, region: c.region, lat: c.lat, lon: c.lon });
    setQuery("");
  };

  const useMyLocation = () => {
    if (!navigator.geolocation) return setGeoState("unavailable");
    setGeoState("asking");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        // Snap to the nearest listed city rather than storing exact coordinates:
        // it's accurate to the minute and nothing precise is ever written down.
        const c = nearestCity(pos.coords.latitude, pos.coords.longitude);
        setGeoState(null);
        if (c) chooseCity(c);
      },
      () => setGeoState("denied"),
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 600000 }
    );
  };

  const loc = prayer?.lat != null ? prayer : null;
  const times = loc ? prayerTimesFor(todayKey(), loc) : null;

  return (
    <div>
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Location</div>
      <div style={{ fontSize: 12, color: C.muted, lineHeight: 1.6, marginBottom: 10 }}>
        Pick the nearest city — that's close enough. Prayer times shift by less than a minute
        across a metro area, so “Salt Lake City” covers West Valley, Sandy and Provo alike.
      </div>

      {loc && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
          <span style={{ fontSize: 13, fontWeight: 600 }}>{prayer.label}</span>
          <span style={{ fontSize: 12, color: C.muted }}>{prayer.region}</span>
          <button style={btn(false)} onClick={() => set({ cityId: null, label: null, region: null, lat: null, lon: null })}>
            Clear
          </button>
        </div>
      )}

      <div style={{ display: "flex", gap: 8, marginBottom: 6, flexWrap: "wrap" }}>
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search a city"
          aria-label="Search for a city" style={{ ...field, flex: 1, minWidth: 160 }} />
        <button style={btn(false)} onClick={useMyLocation}>
          {geoState === "asking" ? "Locating…" : "Use my location"}
        </button>
      </div>
      {geoState === "denied" && (
        <div style={{ fontSize: 12, color: C.muted, marginBottom: 6 }}>
          Location was blocked — searching for your city works just as well.
        </div>
      )}
      {geoState === "unavailable" && (
        <div style={{ fontSize: 12, color: C.muted, marginBottom: 6 }}>
          This device can't share a location. Search for your city instead.
        </div>
      )}

      {!!results.length && (
        <div style={{ border: `1px solid ${C.border}`, borderRadius: 8, overflow: "hidden", marginBottom: 12 }}>
          {results.map((c) => (
            <button key={c.id} onClick={() => chooseCity(c)}
              style={{ display: "block", width: "100%", textAlign: "left", padding: "8px 10px", cursor: "pointer",
                border: "none", borderBottom: `1px solid ${C.border}`, background: C.surface, color: C.ink,
                fontFamily: font, fontSize: 13 }}>
              {c.name} <span style={{ color: C.muted, fontSize: 12 }}>· {c.region}</span>
            </button>
          ))}
        </div>
      )}
      {query.trim() && !results.length && (
        <div style={{ fontSize: 12, color: C.muted, marginBottom: 12 }}>
          No match in the {CITIES.length} built-in cities. Try the nearest larger city.
        </div>
      )}

      <div style={{ borderTop: `1px solid ${C.border}`, marginTop: 14, paddingTop: 14 }}>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Calculation</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <select value={prayer?.method || "isna"} onChange={(e) => set({ method: e.target.value })}
            aria-label="Calculation method" style={{ ...field, flex: 1, minWidth: 200 }}>
            {Object.entries(METHODS).map(([id, m]) => <option key={id} value={id}>{m.label}</option>)}
          </select>
          <select value={prayer?.madhab || "standard"} onChange={(e) => set({ madhab: e.target.value })}
            aria-label="Asr calculation" style={{ ...field }}>
            <option value="standard">Asr: standard</option>
            <option value="hanafi">Asr: Hanafi</option>
          </select>
        </div>
        <div style={{ fontSize: 12, color: C.muted, lineHeight: 1.6, marginTop: 8 }}>
          Methods differ on how far below the horizon the sun sits at Fajr and Isha. If these times
          don't match your local masjid, try another method.
        </div>
      </div>

      {times && (
        <div style={{ borderTop: `1px solid ${C.border}`, marginTop: 14, paddingTop: 14 }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>Today in {prayer.label}</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(88px, 1fr))", gap: 8 }}>
            {PRAYERS.map((p) => (
              <div key={p.id} style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 8,
                padding: "7px 9px" }}>
                <div style={{ fontSize: 11, color: C.muted, marginBottom: 2 }}>{p.label}</div>
                <div style={{ fontSize: 13, fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>
                  {fmtTime(times[p.id])}
                </div>
              </div>
            ))}
          </div>
          {times.approximated && (
            <div style={{ fontSize: 12, color: C.amber, marginTop: 10, lineHeight: 1.5 }}>
              At this latitude the sun doesn't cross the horizon today, so these follow the nearest
              latitude where it does. Check with your local community.
            </div>
          )}
          <div style={{ fontSize: 12, color: C.muted, marginTop: 10, lineHeight: 1.6 }}>
            Calculated on this device from the sun's position — no network, and nothing about your
            location leaves the app. Tahajjud is the last third of the night before Fajr.
          </div>
        </div>
      )}

      <div style={{ borderTop: `1px solid ${C.border}`, marginTop: 14, paddingTop: 14 }}>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>The five daily prayers</div>
        <div style={{ fontSize: 12, color: C.muted, lineHeight: 1.6, marginBottom: 10 }}>
          Adds Fajr, Zuhr, Asr, Maghrib and Isha as habits, each already anchored to its prayer time.
          Any you already track are left alone.
        </div>
        <button style={btn(true)} onClick={onAddPrayerHabits}>
          {hasPrayerHabits ? "Anchor my prayer habits" : "Add the five prayers"}
        </button>
      </div>
    </div>
  );
}
