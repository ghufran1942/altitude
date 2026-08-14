/* Prayer times for a date + approximate location, computed on-device.

   No network call and no exact GPS: you pick a nearby city, which is plenty —
   moving a few miles inside a metro shifts these times by well under a minute.

   Everything is computed as a UTC instant. That keeps the timezone question out
   of the maths entirely: the sun is where it is, and the browser renders the
   instant in whatever zone the device is in. Pick Salt Lake City while you're in
   Salt Lake City and you get Salt Lake City wall-clock times, DST included. */

import { asrTime, julianDay, midDay, sunAngleTime } from "./solar.js";

// Fajr/Isha are defined by how far the sun sits below the horizon, and the
// conventions differ by region. `isha: {mins}` means "a fixed gap after maghrib"
// rather than an angle — the Umm al-Qura / Qatar style.
export const METHODS = {
  isna: { label: "ISNA (North America)", fajr: 15, isha: 15 },
  mwl: { label: "Muslim World League", fajr: 18, isha: 17 },
  egypt: { label: "Egyptian General Authority", fajr: 19.5, isha: 17.5 },
  karachi: { label: "Univ. of Islamic Sciences, Karachi", fajr: 18, isha: 18 },
  makkah: { label: "Umm al-Qura, Makkah", fajr: 18.5, isha: { mins: 90 } },
  dubai: { label: "Dubai", fajr: 18.2, isha: 18.2 },
  qatar: { label: "Qatar", fajr: 18, isha: { mins: 90 } },
  kuwait: { label: "Kuwait", fajr: 18, isha: 17.5 },
  singapore: { label: "Singapore / MUIS", fajr: 20, isha: 18 },
  turkey: { label: "Diyanet (Turkey)", fajr: 18, isha: 17 },
  tehran: { label: "Univ. of Tehran", fajr: 17.7, isha: 14 },
};

export const DEFAULT_METHOD = "isna";

// No location until one is chosen — prayer-anchored reminders stay dormant
// rather than guessing at where you are.
export const DEFAULT_PRAYER = {
  cityId: null, label: null, region: null, lat: null, lon: null,
  method: DEFAULT_METHOD, madhab: "standard",
};

// A settings object is only usable once it actually carries coordinates.
export const prayerLoc = (p) =>
  p && Number.isFinite(p.lat) && Number.isFinite(p.lon) ? p : null;

// Ordered through the day. Sunrise isn't a prayer, but it ends the Fajr window
// and is a useful thing to hang a habit on, so it's anchorable like the rest.
export const PRAYERS = [
  { id: "tahajjud", label: "Tahajjud", icon: "🌙" },
  { id: "fajr", label: "Fajr", icon: "🤲" },
  { id: "sunrise", label: "Sunrise", icon: "🌅" },
  { id: "dhuhr", label: "Zuhr", icon: "🤲" },
  { id: "asr", label: "Asr", icon: "🤲" },
  { id: "maghrib", label: "Maghrib", icon: "🤲" },
  { id: "isha", label: "Isha", icon: "🤲" },
];

export const PRAYER_IDS = PRAYERS.map((p) => p.id);
export const prayerLabel = (id) => PRAYERS.find((p) => p.id === id)?.label || id;

/* The sun's disc is above the geometric horizon at "sunrise" because of
   refraction and the observer's height; 0.833° is the standard allowance. */
const HORIZON = 0.833;

const asFraction = (h) => h / 24;

/* Above roughly 48° latitude the sun can stay too high all night for a 15–18°
   Fajr to exist. The usual fix is to give Fajr/Isha a fixed share of the night
   proportional to the method's angle — "angle-based" in the literature. */
function nightPortion(angle, night) {
  return (angle / 60) * night;
}

export function methodAngles(methodId) {
  const m = METHODS[methodId] || METHODS[DEFAULT_METHOD];
  return m;
}

/* Times for one civil date at one location, as a { prayerId: Date } map.

   `dateKey` is a local calendar day ("2026-08-13") — the day whose prayers you
   want. `lat`/`lon` are degrees, east and north positive.

   Returns Date objects, so `toLocaleTimeString` handles the display zone. */
export function prayerTimesFor(dateKey, loc = {}, _retried = false) {
  const { lat, lon, method = DEFAULT_METHOD, madhab = "standard" } = loc;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const [y, m, d] = dateKey.split("-").map(Number);
  if (!y || !m || !d) return null;

  const cfg = methodAngles(method);
  const asrFactor = madhab === "hanafi" ? 2 : 1;
  // Shifting the Julian Day by the longitude puts the iteration's reference
  // point at the location's own midnight rather than Greenwich's.
  const jd = julianDay(y, m, d) - lon / (15 * 24);

  // Each time depends on the sun's position at that time, so start from a rough
  // guess and refine. Three passes settle to well under a second. A NaN (polar
  // day/night) is left at its guess so it can't poison the other estimates.
  const ishaAngle = typeof cfg.isha === "object" ? null : cfg.isha;
  let t = { fajr: 5, sunrise: 6, dhuhr: 12, asr: 13, sunset: 18, isha: 18 };
  const keep = (next, prev) => (Number.isFinite(next) ? next : prev);
  for (let pass = 0; pass < 3; pass++) {
    const f = {};
    for (const k of Object.keys(t)) f[k] = asFraction(t[k]);
    t = {
      fajr: keep(sunAngleTime(jd, f.fajr, cfg.fajr, lat, "ccw"), t.fajr),
      sunrise: keep(sunAngleTime(jd, f.sunrise, HORIZON, lat, "ccw"), t.sunrise),
      dhuhr: keep(midDay(jd, f.dhuhr), t.dhuhr),
      asr: keep(asrTime(jd, f.asr, asrFactor, lat), t.asr),
      sunset: keep(sunAngleTime(jd, f.sunset, HORIZON, lat, "cw"), t.sunset),
      isha: ishaAngle === null
        ? keep(sunAngleTime(jd, f.sunset, HORIZON, lat, "cw"), t.sunset) + cfg.isha.mins / 60
        : keep(sunAngleTime(jd, f.isha, ishaAngle, lat, "cw"), t.isha),
    };
  }

  // Re-run the final pass unguarded, so a genuinely unresolvable Fajr/Isha comes
  // back NaN and takes the night-portion fallback instead of keeping its guess.
  const sunrise = sunAngleTime(jd, asFraction(t.sunrise), HORIZON, lat, "ccw");
  const sunset = sunAngleTime(jd, asFraction(t.sunset), HORIZON, lat, "cw");
  const haveSun = Number.isFinite(sunrise) && Number.isFinite(sunset);

  /* Midnight sun / polar night: the sun never crosses the horizon, so sunrise
     and sunset simply don't exist and nothing can be anchored to them. The
     common practice (aqrab al-bilad — "nearest locality") is to borrow the
     timings of the closest latitude where the day does behave normally. */
  if (!haveSun && !_retried && Math.abs(lat) > 48) {
    const near = prayerTimesFor(dateKey, { ...loc, lat: Math.sign(lat) * 48 }, true);
    return near ? { ...near, approximated: true } : null;
  }

  const night = haveSun ? 24 - (sunset - sunrise) : 24;

  let fajr = sunAngleTime(jd, asFraction(t.fajr), cfg.fajr, lat, "ccw");
  if (!Number.isFinite(fajr) && haveSun) fajr = sunrise - nightPortion(cfg.fajr, night);

  let isha;
  if (ishaAngle === null) {
    isha = haveSun ? sunset + cfg.isha.mins / 60 : NaN;
  } else {
    isha = sunAngleTime(jd, asFraction(t.isha), ishaAngle, lat, "cw");
    if (!Number.isFinite(isha) && haveSun) isha = sunset + nightPortion(ishaAngle, night);
  }

  const dhuhr = midDay(jd, asFraction(t.dhuhr));
  const asr = asrTime(jd, asFraction(t.asr), asrFactor, lat);

  /* Tahajjud: the last third of the night. The night in question is the one
     that ENDS at this date's Fajr — i.e. it began at yesterday's sunset — so
     ticking off "Tahajjud" for a day refers to that morning, before Fajr,
     which is what a day-by-day tracker means by it. */
  const prevSunset = sunAngleTime(jd - 1, asFraction(t.sunset), HORIZON, lat, "cw") - 24;
  const nightSpan = Number.isFinite(fajr) && Number.isFinite(prevSunset) ? fajr - prevSunset : NaN;
  const tahajjud = Number.isFinite(nightSpan) ? prevSunset + (nightSpan * 2) / 3 : NaN;

  // `hours` here are hours after 00:00 UTC of dateKey, and may fall outside
  // 0–24 (Isha in Salt Lake City lands the next UTC day). Date maths absorbs it.
  const base = Date.UTC(y, m - 1, d, 0, 0, 0, 0);
  const at = (hours) => {
    if (!Number.isFinite(hours)) return null;
    return new Date(base + (hours - lon / 15) * 3600000);
  };

  return {
    tahajjud: at(tahajjud),
    fajr: at(fajr),
    sunrise: at(sunrise),
    dhuhr: at(dhuhr + 1 / 60), // a minute past the zenith — praying at exact noon is discouraged
    asr: at(asr),
    maghrib: at(sunset),
    isha: at(isha),
  };
}

/* The next prayer at or after `now`, looking into tomorrow if the day is spent. */
export function nextPrayer(now, dateKey, tomorrowKey, loc) {
  const scan = (key) => {
    const times = prayerTimesFor(key, loc);
    if (!times) return null;
    for (const p of PRAYERS) {
      const at = times[p.id];
      if (at && at.getTime() > now.getTime()) return { id: p.id, label: p.label, at };
    }
    return null;
  };
  return scan(dateKey) || scan(tomorrowKey);
}

export const fmtTime = (date) =>
  date ? date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "—";
