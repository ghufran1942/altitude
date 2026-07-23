import { createClient } from "@supabase/supabase-js";

// Read from Vite env. Copy .env.example to .env and fill these in to turn on
// cross-device sync. If they're missing, the app runs perfectly well in
// local-only mode (data stays on the device, no account needed).
const url = import.meta.env.VITE_SUPABASE_URL;
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase =
  url && anon
    ? createClient(url, anon, {
        auth: { persistSession: true, autoRefreshToken: true },
      })
    : null;

export const cloudEnabled = !!supabase;
