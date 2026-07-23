import { supabase } from "./supabaseClient.js";

const LOCAL_KEY = "altitude-app-v2";

// A per-tab id so realtime updates that originate from THIS device can be
// ignored (otherwise we'd echo our own writes back into state).
export const writerId = Math.random().toString(36).slice(2);

/* ---------------- local cache (always used) ---------------- */
export function loadLocal() {
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
export function saveLocal(state) {
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(state));
  } catch (e) {
    console.error("local save failed", e);
  }
}

/* ---------------- cloud (only when signed in) -------------- */
export async function loadCloud(userId) {
  if (!supabase || !userId) return null;
  const { data, error } = await supabase
    .from("app_state")
    .select("data")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) {
    console.error("cloud load failed", error);
    return null;
  }
  return data?.data ?? null;
}

export async function saveCloud(userId, state) {
  if (!supabase || !userId) return;
  const { error } = await supabase.from("app_state").upsert(
    {
      user_id: userId,
      data: state,
      writer_id: writerId,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" }
  );
  if (error) console.error("cloud save failed", error);
}

// Subscribe to realtime changes for this user's row. onRemote(data) fires when
// ANOTHER device writes. Returns an unsubscribe function.
export function subscribeCloud(userId, onRemote) {
  if (!supabase || !userId) return () => {};
  const channel = supabase
    .channel(`app_state:${userId}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "app_state", filter: `user_id=eq.${userId}` },
      (payload) => {
        const row = payload.new;
        if (!row || row.writer_id === writerId) return; // ignore our own echo
        if (row.data) onRemote(row.data);
      }
    )
    .subscribe();
  return () => supabase.removeChannel(channel);
}
