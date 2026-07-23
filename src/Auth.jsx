import React, { useState } from "react";
import { supabase } from "./supabaseClient.js";

/* Sign-in / sign-up gate. On success, Root's onAuthStateChange takes over.
   "Continue offline" drops straight into local-only mode. */
export default function Auth({ onLocal }) {
  const [mode, setMode] = useState("signin"); // signin | signup
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [err, setErr] = useState(null);

  const C = {
    bg: "#101820", surface: "#18222C", ink: "#E9EEF2", muted: "#8CA0AE",
    border: "#2A3743", accent: "#35B597", accentInk: "#0B1B17", danger: "#E07A6B",
  };
  const font = "'Inter', system-ui, -apple-system, sans-serif";
  const input = {
    width: "100%", padding: "11px 13px", borderRadius: 9, fontSize: 14, marginBottom: 10,
    border: `1px solid ${C.border}`, background: "#0F1720", color: C.ink, fontFamily: font,
  };

  async function submit() {
    setErr(null); setMsg(null);
    if (!email || !password) { setErr("Enter an email and password."); return; }
    setBusy(true);
    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        setMsg("Account created. If email confirmation is on, check your inbox, then sign in.");
        setMode("signin");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        // Root's auth listener will swap to the app.
      }
    } catch (e) {
      setErr(e.message || "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ minHeight: "100vh", background: C.bg, color: C.ink, fontFamily: font,
      display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Archivo:wght@700;800&family=Inter:wght@400;500;600;700&display=swap');
        ::placeholder { color: ${C.muted}; opacity: .7 }
        input:focus-visible, button:focus-visible { outline: 2px solid ${C.accent}; outline-offset: 2px }`}</style>
      <div style={{ width: "100%", maxWidth: 380 }}>
        <div style={{ fontFamily: "'Archivo', sans-serif", fontWeight: 800, fontSize: 26, letterSpacing: "-0.02em", marginBottom: 4 }}>
          ALTITUDE
        </div>
        <div style={{ fontSize: 13, color: C.muted, marginBottom: 22 }}>
          Sign in to sync your plans across every device.
        </div>

        <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14, padding: 20 }}>
          <div style={{ display: "flex", gap: 6, marginBottom: 16 }}>
            {[["signin", "Sign in"], ["signup", "Create account"]].map(([m, label]) => (
              <button key={m} onClick={() => { setMode(m); setErr(null); setMsg(null); }}
                style={{ flex: 1, padding: "8px", borderRadius: 8, cursor: "pointer", fontFamily: font, fontWeight: 600, fontSize: 13,
                  border: `1px solid ${mode === m ? C.accent : "transparent"}`,
                  background: mode === m ? C.accent : "transparent", color: mode === m ? C.accentInk : C.muted }}>
                {label}
              </button>
            ))}
          </div>

          <input type="email" placeholder="you@email.com" value={email} autoComplete="email"
            onChange={(e) => setEmail(e.target.value)} style={input} />
          <input type="password" placeholder="Password" value={password}
            autoComplete={mode === "signup" ? "new-password" : "current-password"}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()} style={input} />

          {err && <div style={{ color: C.danger, fontSize: 13, marginBottom: 10 }}>{err}</div>}
          {msg && <div style={{ color: C.accent, fontSize: 13, marginBottom: 10 }}>{msg}</div>}

          <button disabled={busy} onClick={submit}
            style={{ width: "100%", padding: "11px", borderRadius: 9, cursor: busy ? "wait" : "pointer",
              fontFamily: font, fontWeight: 700, fontSize: 14, border: `1px solid ${C.accent}`,
              background: C.accent, color: C.accentInk, marginBottom: 12 }}>
            {busy ? "…" : mode === "signup" ? "Create account" : "Sign in"}
          </button>

          <button onClick={onLocal}
            style={{ width: "100%", padding: "10px", borderRadius: 9, cursor: "pointer",
              fontFamily: font, fontWeight: 600, fontSize: 13, border: `1px solid ${C.border}`,
              background: "transparent", color: C.muted }}>
            Continue offline (local only)
          </button>
        </div>
      </div>
    </div>
  );
}
