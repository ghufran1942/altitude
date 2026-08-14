# Altitude

A focus tool: a Pomodoro timer, a zoomable project hierarchy (Year → Milestone → Project → Task → Micro), and an anti-procrastination toolkit (task-shrink / 2-minute rule, streaks, distraction log, motivational quotes), plus deadlines with reminders, a habit tracker with scheduled times and prayer-time reminders, and a GitHub-style activity heatmap.

It runs three ways from one codebase:

- **Local-only web app** — no accounts, data lives in the browser. Works out of the box.
- **Synced web app (PWA)** — sign in, and your plans sync across every device in real time via Supabase. Installable to the home screen on iOS/iPadOS/Android and to the desktop on Windows/macOS.
- **Native apps** — wrapped with Capacitor for real iOS and Android builds (with native local-notification reminders).

---

## 1. Run it locally

```bash
npm install
npm run dev
```

Open the printed URL. With no Supabase keys set, it starts in **local-only** mode — everything works, data just stays on that device.

---

## 2. Turn on cross-device sync (Supabase)

1. Create a free project at https://supabase.com.
2. In the dashboard: **SQL Editor → New query**, paste the contents of `supabase/schema.sql`, and **Run**. This creates the `app_state` table, locks it down with row-level security (each user sees only their own data), and enables realtime.
3. **Project Settings → API**: copy the **Project URL** and the **anon public** key.
4. Copy `.env.example` to `.env` and paste them in:
   ```
   VITE_SUPABASE_URL=https://YOUR-PROJECT.supabase.co
   VITE_SUPABASE_ANON_KEY=YOUR-ANON-PUBLIC-KEY
   ```
5. Restart `npm run dev`. You'll now get a sign-in screen. Create an account on each device with the **same email/password** and they share one synced workspace.

Auth uses email + password. In Supabase → **Authentication → Providers**, you can turn email confirmation on or off; for a personal tool it's fine to leave it off so accounts work instantly. (You can also enable magic links or Google there later — no app code changes needed for the basic flow.)

**How sync works:** the whole workspace is stored as one JSON row per user and pushed (debounced) on every change; other devices receive it over Supabase realtime and update live. It's last-write-wins, which is ideal for a single person on a few devices. Every device also keeps a local copy, so the app still works offline and re-syncs when it reconnects.

---

## 3. Deploy the web app / PWA

Build first:

```bash
npm run build      # outputs to dist/
```

Then pick a host (all have free tiers):

- **Netlify / Cloudflare Pages** — drag the `dist/` folder onto their dashboard, or connect the git repo (build command `npm run build`, publish dir `dist`). `netlify.toml` is included.
- **Vercel** — import the repo; `vercel.json` is included. Add the two `VITE_SUPABASE_*` values as Environment Variables in the host's settings (so the built site can reach Supabase).
- **GitHub Pages** — works too, but if it's a project site under `/<repo>/`, set `base: "/<repo>/"` in `vite.config.js` first.

### Install it as an app
- **iPhone / iPad (Safari):** open the URL → Share → **Add to Home Screen**.
- **Android (Chrome) / Windows / macOS (Chrome or Edge):** an **Install** icon appears in the address bar.

It then launches full-screen with its own icon and works offline.

---

## 4. Build the native iOS / Android apps (Capacitor)

Prerequisites: **Xcode** (for iOS, macOS only) and/or **Android Studio** (for Android).

```bash
# generate app icons + splash from resources/ (one-time, and after art changes)
npx capacitor-assets generate

# add a platform (runs a build first)
npm run cap:add:ios       # or: npm run cap:add:android

# after any web change, rebuild + copy into the native project
npm run cap:sync

# open the native IDE to run on a simulator/device or archive for the store
npm run cap:ios           # or: npm run cap:android
```

Notes:
- Set your own bundle id in `capacitor.config.ts` (`appId`) before publishing.
- Reminders use **native local notifications** on device (via `@capacitor/local-notifications`) and the browser Notification API on the web — the app picks the right one automatically.
- `ios/` and `android/` are generated folders and are gitignored by default; commit them if you prefer checking native projects in.

---

## Habit schedules, reminders and prayer times

Open **Edit habits** and expand the ⏰ row under any habit to say when it's due:

- **Anytime** — no time, just a daily tick (the default; nothing changes).
- **At a time** — a fixed clock time, e.g. 08:00 every day.
- **With a prayer** — anchored to Tahajjud, Fajr, sunrise, Zuhr, Asr, Maghrib or Isha, with an optional offset ("20 min after Maghrib"). The time is recomputed each day, so it tracks the sun through the year.

Each habit can carry **any number of reminders**, set as offsets from the due time — 30 min before, at the time, 20 min after, or a custom `±minutes`. Marking a habit cancels the rest of that day's reminders for it, and a time that passes unanswered is flagged in amber on the tracker.

### On time, delayed or missed

Every habit is tracked one of two ways, set per habit under **Track** in the same panel:

- **Done or not** — the original single tick. The default for everything except prayers.
- **On time · delayed · missed** — three marks. The default for prayer-anchored habits.

Tapping cycles through them: nothing → 🟢 on time → 🟡 delayed → 🔴 missed → nothing. The marks carry
distinct shapes as well as colours (✓ / ! / ✕) so they don't rely on colour alone, and they show in both
today's list and the three-week grid, which makes a run of late Fajrs obvious at a glance.

What the marks mean elsewhere in the app:

- **Delayed still counts as done** — you prayed, just late — so it keeps your streak and completion rate.
- **Missed does not count as done**, but it does count as *answered*: it stops that day's remaining
  reminders and it breaks the streak. Recording your misses honestly never inflates your numbers.
- The habit analytics grow an **On time** column: a bar showing the green/amber/red split over 90 days,
  and the share of the prayers you did perform that were on time. Habits tracked with a plain tick show `—`.

Switching a habit between the two modes is non-destructive — existing marks are kept and reappear if you
switch back.

### Prayer times

**Prayer times** in the header sets an approximate location. Pick the nearest city — prayer times shift
by well under a minute across a metro area, so Salt Lake City covers West Valley, Sandy and Provo alike.
"Use my location" is optional and snaps to the nearest listed city rather than storing exact coordinates.

Times are computed **on-device** from the sun's position (no network, no API key, nothing about your location leaves the app), and are shown as instants, so they render correctly in whatever timezone the device is in, DST included. You can pick the calculation method (ISNA, Muslim World League, Umm al-Qura, Karachi, Egyptian, Diyanet and others) and the Asr convention (standard or Hanafi) to match your local masjid. Tahajjud is the last third of the night ending at that morning's Fajr.

**Add the five prayers** creates Fajr, Zuhr, Asr, Maghrib and Isha as habits, each already anchored. If you already track them under any common spelling (Zuhr/Dhuhr, Fajr/Fajar…) it anchors those instead of adding duplicates, and it's safe to press twice.

Above roughly 48° latitude the sun may not cross the horizon at all on some dates; there the app follows the nearest latitude where it does (the *aqrab al-bilad* convention) and says so.

### How reminders are delivered

On the **native iOS/Android builds** the next three days of reminders are handed to the OS in advance, so they arrive with the app closed. On the **web** there's no equivalent for a closed tab, so Altitude checks on a timer while it's open and shows anything that came due in the last few minutes. Either way you need to grant notification permission — the habit editor prompts if reminders are set but permission is off.

---

## Project layout

```
src/
  Altitude.jsx           main app (Root auth-gate + AltitudeApp) — top-level UI & state
  Auth.jsx               sign-in / sign-up / continue-offline screen
  store.js               local cache + Supabase load/save/realtime
  supabaseClient.js      Supabase client (null → local-only mode)
  notifications.js       web + Capacitor notifications, incl. scheduling reminders ahead
  main.jsx               entry; registers the PWA service worker (web only)
  components/            UI, grouped by feature (habits/, since/, budget/)
  lib/
    reminders.js         habit schedules → due times → reminder instants
    prayer/solar.js      sun position: julian day, declination, equation of time
    prayer/prayerTimes.js prayer times for a date + location; methods & madhab
    prayer/cities.js     built-in approximate locations
public/icons/            PWA icons
resources/               1024 icon + splash sources for capacitor-assets
supabase/schema.sql      database + RLS + realtime setup
```

## Reset your data
Local-only: clear the site's storage in the browser, or run `localStorage.removeItem('altitude-app-v2')` in the console. Synced: delete your row in the Supabase `app_state` table.
