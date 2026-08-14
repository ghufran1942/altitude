/* A short list of approximate locations.

   Deliberately coarse: prayer times shift by well under a minute across a metro
   area, so "Salt Lake City" is the right answer for anyone in West Valley,
   Sandy or Provo. Picking a nearby city also means never asking for GPS. */

export const CITIES = [
  // United States
  { id: "slc", name: "Salt Lake City", region: "UT, USA", lat: 40.7608, lon: -111.891 },
  { id: "provo", name: "Provo", region: "UT, USA", lat: 40.2338, lon: -111.6585 },
  { id: "logan", name: "Logan", region: "UT, USA", lat: 41.7355, lon: -111.8344 },
  { id: "boise", name: "Boise", region: "ID, USA", lat: 43.615, lon: -116.2023 },
  { id: "denver", name: "Denver", region: "CO, USA", lat: 39.7392, lon: -104.9903 },
  { id: "phoenix", name: "Phoenix", region: "AZ, USA", lat: 33.4484, lon: -112.074 },
  { id: "lasvegas", name: "Las Vegas", region: "NV, USA", lat: 36.1699, lon: -115.1398 },
  { id: "losangeles", name: "Los Angeles", region: "CA, USA", lat: 34.0522, lon: -118.2437 },
  { id: "sanfrancisco", name: "San Francisco", region: "CA, USA", lat: 37.7749, lon: -122.4194 },
  { id: "sandiego", name: "San Diego", region: "CA, USA", lat: 32.7157, lon: -117.1611 },
  { id: "seattle", name: "Seattle", region: "WA, USA", lat: 47.6062, lon: -122.3321 },
  { id: "portland", name: "Portland", region: "OR, USA", lat: 45.5152, lon: -122.6784 },
  { id: "dallas", name: "Dallas", region: "TX, USA", lat: 32.7767, lon: -96.797 },
  { id: "houston", name: "Houston", region: "TX, USA", lat: 29.7604, lon: -95.3698 },
  { id: "austin", name: "Austin", region: "TX, USA", lat: 30.2672, lon: -97.7431 },
  { id: "chicago", name: "Chicago", region: "IL, USA", lat: 41.8781, lon: -87.6298 },
  { id: "minneapolis", name: "Minneapolis", region: "MN, USA", lat: 44.9778, lon: -93.265 },
  { id: "detroit", name: "Detroit", region: "MI, USA", lat: 42.3314, lon: -83.0458 },
  { id: "columbus", name: "Columbus", region: "OH, USA", lat: 39.9612, lon: -82.9988 },
  { id: "atlanta", name: "Atlanta", region: "GA, USA", lat: 33.749, lon: -84.388 },
  { id: "miami", name: "Miami", region: "FL, USA", lat: 25.7617, lon: -80.1918 },
  { id: "newyork", name: "New York", region: "NY, USA", lat: 40.7128, lon: -74.006 },
  { id: "philadelphia", name: "Philadelphia", region: "PA, USA", lat: 39.9526, lon: -75.1652 },
  { id: "boston", name: "Boston", region: "MA, USA", lat: 42.3601, lon: -71.0589 },
  { id: "washingtondc", name: "Washington", region: "DC, USA", lat: 38.9072, lon: -77.0369 },
  // Canada
  { id: "toronto", name: "Toronto", region: "ON, Canada", lat: 43.6532, lon: -79.3832 },
  { id: "montreal", name: "Montreal", region: "QC, Canada", lat: 45.5019, lon: -73.5674 },
  { id: "vancouver", name: "Vancouver", region: "BC, Canada", lat: 49.2827, lon: -123.1207 },
  { id: "calgary", name: "Calgary", region: "AB, Canada", lat: 51.0447, lon: -114.0719 },
  // Europe
  { id: "london", name: "London", region: "UK", lat: 51.5074, lon: -0.1278 },
  { id: "birmingham", name: "Birmingham", region: "UK", lat: 52.4862, lon: -1.8904 },
  { id: "manchester", name: "Manchester", region: "UK", lat: 53.4808, lon: -2.2426 },
  { id: "paris", name: "Paris", region: "France", lat: 48.8566, lon: 2.3522 },
  { id: "berlin", name: "Berlin", region: "Germany", lat: 52.52, lon: 13.405 },
  { id: "amsterdam", name: "Amsterdam", region: "Netherlands", lat: 52.3676, lon: 4.9041 },
  { id: "brussels", name: "Brussels", region: "Belgium", lat: 50.8503, lon: 4.3517 },
  { id: "stockholm", name: "Stockholm", region: "Sweden", lat: 59.3293, lon: 18.0686 },
  { id: "oslo", name: "Oslo", region: "Norway", lat: 59.9139, lon: 10.7522 },
  { id: "madrid", name: "Madrid", region: "Spain", lat: 40.4168, lon: -3.7038 },
  { id: "rome", name: "Rome", region: "Italy", lat: 41.9028, lon: 12.4964 },
  { id: "istanbul", name: "Istanbul", region: "Turkey", lat: 41.0082, lon: 28.9784 },
  { id: "moscow", name: "Moscow", region: "Russia", lat: 55.7558, lon: 37.6173 },
  // Middle East & Africa
  { id: "makkah", name: "Makkah", region: "Saudi Arabia", lat: 21.4225, lon: 39.8262 },
  { id: "madinah", name: "Madinah", region: "Saudi Arabia", lat: 24.5247, lon: 39.5692 },
  { id: "riyadh", name: "Riyadh", region: "Saudi Arabia", lat: 24.7136, lon: 46.6753 },
  { id: "jeddah", name: "Jeddah", region: "Saudi Arabia", lat: 21.4858, lon: 39.1925 },
  { id: "dubai", name: "Dubai", region: "UAE", lat: 25.2048, lon: 55.2708 },
  { id: "abudhabi", name: "Abu Dhabi", region: "UAE", lat: 24.4539, lon: 54.3773 },
  { id: "doha", name: "Doha", region: "Qatar", lat: 25.2854, lon: 51.531 },
  { id: "kuwaitcity", name: "Kuwait City", region: "Kuwait", lat: 29.3759, lon: 47.9774 },
  { id: "amman", name: "Amman", region: "Jordan", lat: 31.9454, lon: 35.9284 },
  { id: "jerusalem", name: "Jerusalem", region: "Palestine", lat: 31.7683, lon: 35.2137 },
  { id: "cairo", name: "Cairo", region: "Egypt", lat: 30.0444, lon: 31.2357 },
  { id: "casablanca", name: "Casablanca", region: "Morocco", lat: 33.5731, lon: -7.5898 },
  { id: "tunis", name: "Tunis", region: "Tunisia", lat: 36.8065, lon: 10.1815 },
  { id: "lagos", name: "Lagos", region: "Nigeria", lat: 6.5244, lon: 3.3792 },
  { id: "nairobi", name: "Nairobi", region: "Kenya", lat: -1.2864, lon: 36.8172 },
  { id: "johannesburg", name: "Johannesburg", region: "South Africa", lat: -26.2041, lon: 28.0473 },
  // South & Central Asia
  { id: "karachi", name: "Karachi", region: "Pakistan", lat: 24.8607, lon: 67.0011 },
  { id: "lahore", name: "Lahore", region: "Pakistan", lat: 31.5204, lon: 74.3587 },
  { id: "islamabad", name: "Islamabad", region: "Pakistan", lat: 33.6844, lon: 73.0479 },
  { id: "peshawar", name: "Peshawar", region: "Pakistan", lat: 34.0151, lon: 71.5249 },
  { id: "delhi", name: "Delhi", region: "India", lat: 28.6139, lon: 77.209 },
  { id: "mumbai", name: "Mumbai", region: "India", lat: 19.076, lon: 72.8777 },
  { id: "hyderabad", name: "Hyderabad", region: "India", lat: 17.385, lon: 78.4867 },
  { id: "dhaka", name: "Dhaka", region: "Bangladesh", lat: 23.8103, lon: 90.4125 },
  { id: "kabul", name: "Kabul", region: "Afghanistan", lat: 34.5553, lon: 69.2075 },
  { id: "tehran", name: "Tehran", region: "Iran", lat: 35.6892, lon: 51.389 },
  // East Asia & Oceania
  { id: "kualalumpur", name: "Kuala Lumpur", region: "Malaysia", lat: 3.139, lon: 101.6869 },
  { id: "singapore", name: "Singapore", region: "Singapore", lat: 1.3521, lon: 103.8198 },
  { id: "jakarta", name: "Jakarta", region: "Indonesia", lat: -6.2088, lon: 106.8456 },
  { id: "tokyo", name: "Tokyo", region: "Japan", lat: 35.6762, lon: 139.6503 },
  { id: "sydney", name: "Sydney", region: "Australia", lat: -33.8688, lon: 151.2093 },
  { id: "melbourne", name: "Melbourne", region: "Australia", lat: -37.8136, lon: 144.9631 },
];

export const cityById = (id) => CITIES.find((c) => c.id === id) || null;

export function searchCities(q, limit = 8) {
  const s = q.trim().toLowerCase();
  if (!s) return [];
  const hits = CITIES.filter(
    (c) => c.name.toLowerCase().includes(s) || c.region.toLowerCase().includes(s)
  );
  // Prefix matches first — typing "sa" should surface Salt Lake City above Jeddah.
  hits.sort((a, b) => {
    const ap = a.name.toLowerCase().startsWith(s) ? 0 : 1;
    const bp = b.name.toLowerCase().startsWith(s) ? 0 : 1;
    return ap - bp || a.name.localeCompare(b.name);
  });
  return hits.slice(0, limit);
}

// Nearest listed city to a lat/lon, for the optional "use my location" button.
// Equirectangular distance is plenty at city scale and avoids the haversine.
export function nearestCity(lat, lon) {
  let best = null, bestD = Infinity;
  for (const c of CITIES) {
    const dx = (c.lon - lon) * Math.cos(((c.lat + lat) / 2) * (Math.PI / 180));
    const dy = c.lat - lat;
    const d = dx * dx + dy * dy;
    if (d < bestD) { bestD = d; best = c; }
  }
  return best;
}
