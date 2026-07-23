# Altitude

A focus tool: a Pomodoro timer, a zoomable project hierarchy (Year → Milestone → Project → Task → Micro), and an anti-procrastination toolkit (task-shrink / 2-minute rule, streaks, distraction log, motivational quotes), plus deadlines with reminders and a GitHub-style activity heatmap.

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

## Project layout

```
src/
  App.jsx            main app (Root auth-gate + AltitudeApp) — all UI & logic
  Auth.jsx           sign-in / sign-up / continue-offline screen
  store.js           local cache + Supabase load/save/realtime
  supabaseClient.js  Supabase client (null → local-only mode)
  notifications.js   web + Capacitor notification abstraction
  main.jsx           entry; registers the PWA service worker (web only)
public/icons/        PWA icons
resources/           1024 icon + splash sources for capacitor-assets
supabase/schema.sql  database + RLS + realtime setup
```

## Reset your data
Local-only: clear the site's storage in the browser, or run `localStorage.removeItem('altitude-app-v2')` in the console. Synced: delete your row in the Supabase `app_state` table.
