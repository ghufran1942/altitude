/* Solar position maths — the astronomy underneath prayer times.
   Degree-based trig throughout, because every published prayer-time formula is
   written in degrees and translating them to radians inline is how sign errors
   creep in. Follows the low-precision solar model from the US Naval Observatory
   almanac (good to well under a minute for our purposes). */

const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;

export const dsin = (d) => Math.sin(d * D2R);
export const dcos = (d) => Math.cos(d * D2R);
export const dtan = (d) => Math.tan(d * D2R);
export const darcsin = (x) => R2D * Math.asin(x);
export const darccos = (x) => R2D * Math.acos(x);
export const darctan2 = (y, x) => R2D * Math.atan2(y, x);
export const darccot = (x) => R2D * Math.atan2(1, x);

const fix = (a, b) => {
  const r = a - b * Math.floor(a / b);
  return r < 0 ? r + b : r;
};
export const fixAngle = (a) => fix(a, 360);
export const fixHour = (a) => fix(a, 24);

// Julian Day for 00:00 UT of a civil date (Gregorian).
export function julianDay(year, month, day) {
  let y = year, m = month;
  if (m <= 2) { y -= 1; m += 12; }
  const a = Math.floor(y / 100);
  const b = 2 - a + Math.floor(a / 4);
  return Math.floor(365.25 * (y + 4716)) + Math.floor(30.6001 * (m + 1)) + day + b - 1524.5;
}

// Sun's declination and the equation of time (in hours) at a Julian Day.
export function sunPosition(jd) {
  const d = jd - 2451545.0;                                   // days since J2000
  const g = fixAngle(357.529 + 0.98560028 * d);               // mean anomaly
  const q = fixAngle(280.459 + 0.98564736 * d);               // mean longitude
  const l = fixAngle(q + 1.915 * dsin(g) + 0.020 * dsin(2 * g)); // ecliptic longitude
  const e = 23.439 - 0.00000036 * d;                          // obliquity
  const ra = fixHour(darctan2(dcos(e) * dsin(l), dcos(l)) / 15); // right ascension, hours
  return { declination: darcsin(dsin(e) * dsin(l)), equation: q / 15 - ra };
}

// Local solar noon, in hours from 00:00 of the reference day.
export function midDay(jd, t) {
  return fixHour(12 - sunPosition(jd + t).equation);
}

/* Hours from midnight at which the sun's altitude is `angle` degrees below the
   horizon. `dir` "ccw" is the morning side of noon, "cw" the evening side.
   Returns NaN above the polar circles where the sun never reaches the angle —
   callers are expected to fall back (see nightPortionFallback). */
export function sunAngleTime(jd, t, angle, lat, dir) {
  const { declination: decl } = sunPosition(jd + t);
  const noon = midDay(jd, t);
  const cosH = (-dsin(angle) - dsin(decl) * dsin(lat)) / (dcos(decl) * dcos(lat));
  if (cosH > 1 || cosH < -1) return NaN;
  const h = darccos(cosH) / 15;
  return dir === "ccw" ? noon - h : noon + h;
}

/* Asr: the moment an object's shadow equals its own length plus `factor` times
   the shadow it cast at noon. factor 1 = Shafi'i/Maliki/Hanbali, 2 = Hanafi. */
export function asrTime(jd, t, factor, lat) {
  const { declination: decl } = sunPosition(jd + t);
  const angle = -darccot(factor + dtan(Math.abs(lat - decl)));
  return sunAngleTime(jd, t, angle, lat, "cw");
}
