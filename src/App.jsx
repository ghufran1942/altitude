import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { supabase, cloudEnabled } from "./supabaseClient.js";
import {
  loadLocal, saveLocal, loadCloud, saveCloud, subscribeCloud,
} from "./store.js";
import {
  requestNotifPermission, currentNotifState, fireNotification, isNative,
} from "./notifications.js";
import Auth from "./Auth.jsx";

/* ============================================================
   Altitude — focus tool
   Pomodoro + zoomable hierarchy + anti-procrastination toolkit
   + deadlines/reminders + activity heatmap
   + cross-device sync (Supabase) + native builds (Capacitor)
   ============================================================ */

const LEVELS = ["Year", "Milestone", "Project", "Task", "Micro"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const QUOTES = [
  "Starting badly beats not starting.",
  "You don't need motivation to begin. Beginning creates it.",
  "Two minutes. That's the whole ask.",
  "The task is smaller than the dread of it.",
  "Momentum is built one pomodoro at a time.",
  "Done is data. Perfect is a stall tactic.",
  "Shrink it until it's easy, then do the easy thing.",
  "Future-you is watching. Make them nod.",
  "A short session counts. It always counts.",
  "The hardest rep is picking up the timer.",
  "Focus is a practice, not a personality trait.",
  "One small true step beats ten imagined ones.",
];

const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
const todayKey = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

function daysAgoKey(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return todayKey(d);
}

function fmtDeadline(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}
function deadlineState(iso) {
  if (!iso) return null;
  const diff = new Date(iso).getTime() - Date.now();
  if (diff < 0) return "overdue";
  if (diff < 24 * 3600 * 1000) return "soon";
  return "future";
}
function defaultDeadlineStr() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T17:00`;
}

/* ---------- audio alert ---------- */
function chime() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    [0, 0.18, 0.36].forEach((t, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = "sine";
      o.frequency.value = [660, 880, 990][i];
      g.gain.setValueAtTime(0.0001, ctx.currentTime + t);
      g.gain.exponentialRampToValueAtTime(0.18, ctx.currentTime + t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + t + 0.5);
      o.connect(g).connect(ctx.destination);
      o.start(ctx.currentTime + t);
      o.stop(ctx.currentTime + t + 0.55);
    });
  } catch {}
}

function seedNodes() {
  return [{ id: uid(), parentId: null, level: 0, title: "2026", done: false, deadline: null }];
}
const DEFAULT_SETTINGS = { work: 25, short: 5, long: 15, cyclesToLong: 4 };

/* ============================================================
   Root — auth gate. Decides between the sign-in screen, local-only
   mode, and the signed-in synced app.
   ============================================================ */
export default function Root() {
  const [mode, setMode] = useState("loading"); // loading | auth | local | app
  const [session, setSession] = useState(null);

  useEffect(() => {
    if (!cloudEnabled) { setMode("local"); return; }
    let sub;
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setMode(data.session ? "app" : "auth");
    });
    const res = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s);
      setMode(s ? "app" : "auth");
    });
    sub = res.data.subscription;
    return () => sub?.unsubscribe();
  }, []);

  async function signOut() {
    if (supabase) await supabase.auth.signOut();
    setMode("auth");
  }

  if (mode === "loading")
    return (
      <div style={{ minHeight: "100vh", background: "#101820", color: "#8CA0AE",
        fontFamily: "Inter, system-ui, sans-serif", display: "flex", alignItems: "center", justifyContent: "center" }}>
        Loading…
      </div>
    );
  if (mode === "auth") return <Auth onLocal={() => setMode("local")} />;

  const userId = mode === "app" ? session?.user?.id ?? null : null;
  return (
    <AltitudeApp
      userId={userId}
      syncOn={mode === "app" && cloudEnabled}
      accountEmail={session?.user?.email}
      onSignOut={signOut}
      onGoOnline={() => setMode("auth")}
    />
  );
}

/* ============================================================ */

function AltitudeApp({ userId = null, syncOn = false, accountEmail, onSignOut, onGoOnline }) {
  const [loaded, setLoaded] = useState(false);
  const [dark, setDark] = useState(false);

  const [nodes, setNodes] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [completions, setCompletions] = useState([]);
  const [distractions, setDistractions] = useState([]);
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [activeTaskId, setActiveTaskId] = useState(null);
  const [reminded, setReminded] = useState({}); // {nodeId: 'soon'|'overdue'}

  const [focusId, setFocusId] = useState(null);

  // timer
  const [phase, setPhase] = useState("work");
  const [running, setRunning] = useState(false);
  const [endsAt, setEndsAt] = useState(null);
  const [remaining, setRemaining] = useState(DEFAULT_SETTINGS.work * 60);
  const [cycleCount, setCycleCount] = useState(0);
  const [banner, setBanner] = useState(null);

  const [quoteIdx, setQuoteIdx] = useState(() => Math.floor(Math.random() * QUOTES.length));

  // modals / menus
  const [shrinkTarget, setShrinkTarget] = useState(null);
  const [deadlineTarget, setDeadlineTarget] = useState(null);
  const [moveTarget, setMoveTarget] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [openMenuId, setOpenMenuId] = useState(null);
  const [showLog, setShowLog] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showStats, setShowStats] = useState(false);
  const [showDeadlines, setShowDeadlines] = useState(false);

  // reminders
  const [toasts, setToasts] = useState([]);
  const [notifState, setNotifState] = useState(currentNotifState());

  // mobile layout
  const [isPhone, setIsPhone] = useState(false);
  const [mobileTab, setMobileTab] = useState("pomodoro"); // pomodoro | activity | goals
  const [headerMenuOpen, setHeaderMenuOpen] = useState(false);

  const distractRef = useRef(null);
  const addRef = useRef(null);
  const saveTimer = useRef(null);
  const suppressSave = useRef(false); // skip the save that a remote hydrate triggers
  const nodesRef = useRef(nodes);
  const remindedRef = useRef(reminded);
  useEffect(() => { nodesRef.current = nodes; }, [nodes]);
  useEffect(() => { remindedRef.current = reminded; }, [reminded]);

  /* ---------- hydrate / serialize the whole app state ---------- */
  const hydrate = useCallback((s) => {
    setNodes(s?.nodes?.length ? s.nodes : seedNodes());
    setSessions(s?.sessions || []);
    setCompletions(s?.completions || []);
    setDistractions(s?.distractions || []);
    setSettings({ ...DEFAULT_SETTINGS, ...(s?.settings || {}) });
    setActiveTaskId(s?.activeTaskId || null);
    setReminded(s?.reminded || {});
    setDark(!!s?.dark);
    setRemaining((s?.settings?.work || DEFAULT_SETTINGS.work) * 60);
  }, []);

  const serialize = useCallback(
    () => ({ nodes, sessions, completions, distractions, settings, activeTaskId, reminded, dark }),
    [nodes, sessions, completions, distractions, settings, activeTaskId, reminded, dark]
  );

  /* ---------- load: prefer cloud, fall back to local ---------- */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoaded(false);
      let initial = loadLocal();
      if (userId) {
        const cloud = await loadCloud(userId);
        if (cloud) initial = cloud;
        else if (initial) saveCloud(userId, initial); // seed a new account from local data
      }
      if (cancelled) return;
      hydrate(initial);
      suppressSave.current = true; // the hydrate above shouldn't trigger a write-back
      setLoaded(true);
    })();
    return () => { cancelled = true; };
  }, [userId, hydrate]);

  /* ---------- debounced save: local always, cloud when signed in ---------- */
  useEffect(() => {
    if (!loaded) return;
    if (suppressSave.current) { suppressSave.current = false; return; }
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      const s = serialize();
      saveLocal(s);
      if (userId) saveCloud(userId, s);
    }, 500);
    return () => clearTimeout(saveTimer.current);
  }, [nodes, sessions, completions, distractions, settings, activeTaskId, reminded, dark, loaded, userId, serialize]);

  /* ---------- realtime: apply edits made on other devices ---------- */
  useEffect(() => {
    if (!userId) return;
    const unsub = subscribeCloud(userId, (remote) => {
      suppressSave.current = true;
      hydrate(remote);
    });
    return unsub;
  }, [userId, hydrate]);

  /* ---------- page background follows theme ---------- */
  useEffect(() => {
    document.body.style.background = dark ? "#101820" : "#F3F6F8";
  }, [dark]);

  /* ---------- phone detection ---------- */
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 1100px)");
    const on = () => setIsPhone(mq.matches);
    on();
    mq.addEventListener ? mq.addEventListener("change", on) : mq.addListener(on);
    return () => {
      mq.removeEventListener ? mq.removeEventListener("change", on) : mq.removeListener(on);
    };
  }, []);

  /* ---------- timer tick ---------- */
  useEffect(() => {
    if (!running || !endsAt) return;
    const iv = setInterval(() => {
      const left = Math.max(0, Math.round((endsAt - Date.now()) / 1000));
      setRemaining(left);
      if (left <= 0) {
        clearInterval(iv);
        onPhaseEnd();
      }
    }, 250);
    return () => clearInterval(iv);
  }, [running, endsAt]); // eslint-disable-line

  const phaseDuration = useCallback(
    (p) => (p === "work" ? settings.work : p === "short" ? settings.short : settings.long) * 60,
    [settings]
  );

  function startTimer() {
    setBanner(null);
    setEndsAt(Date.now() + remaining * 1000);
    setRunning(true);
  }
  function pauseTimer() { setRunning(false); setEndsAt(null); }
  function resetTimer(p = phase) { setRunning(false); setEndsAt(null); setRemaining(phaseDuration(p)); }
  function switchPhase(p) { setPhase(p); resetTimer(p); }
  function skipPhase() { onPhaseEnd(true); }

  function onPhaseEnd(skipped = false) {
    setRunning(false);
    setEndsAt(null);
    if (!skipped) chime();
    if (phase === "work") {
      if (!skipped) {
        setSessions((s) => [...s, { ts: Date.now(), dateKey: todayKey(), taskId: activeTaskId, minutes: settings.work }]);
        setCompletions((c) => [...c, todayKey()]);
      }
      const nextCycles = cycleCount + 1;
      setCycleCount(nextCycles);
      const nextPhase = nextCycles % settings.cyclesToLong === 0 ? "long" : "short";
      setPhase(nextPhase);
      setRemaining(phaseDuration(nextPhase));
      setBanner({
        kind: "break",
        text:
          nextPhase === "long"
            ? "Long break earned. Genuinely step away — stretch, water, window. The work will be here."
            : "Break earned, no strings attached. Stand up, look far away, breathe. You did the thing.",
      });
    } else {
      setPhase("work");
      setRemaining(phaseDuration("work"));
      setBanner({ kind: "work", text: "Fresh session ready when you are. Smallest next action first." });
      setQuoteIdx((i) => (i + 1) % QUOTES.length);
    }
  }

  /* ---------- hierarchy helpers ---------- */
  const byParent = useMemo(() => {
    const m = new Map();
    nodes.forEach((n) => {
      if (!m.has(n.parentId)) m.set(n.parentId, []);
      m.get(n.parentId).push(n);
    });
    return m;
  }, [nodes]);

  const nodeById = useMemo(() => {
    const m = new Map();
    nodes.forEach((n) => m.set(n.id, n));
    return m;
  }, [nodes]);

  const progressOf = useCallback(
    function prog(id) {
      const kids = byParent.get(id) || [];
      if (kids.length === 0) {
        const n = nodeById.get(id);
        return { done: n?.done ? 1 : 0, total: 1 };
      }
      let done = 0, total = 0;
      kids.forEach((k) => { const p = prog(k.id); done += p.done; total += p.total; });
      return { done, total };
    },
    [byParent, nodeById]
  );

  const breadcrumb = useMemo(() => {
    const trail = [];
    let cur = focusId ? nodeById.get(focusId) : null;
    while (cur) { trail.unshift(cur); cur = cur.parentId ? nodeById.get(cur.parentId) : null; }
    return trail;
  }, [focusId, nodeById]);

  const currentLevel = focusId ? (nodeById.get(focusId)?.level ?? -1) + 1 : 0;
  const shownNodes = byParent.get(focusId) || [];

  const descendantsOf = useCallback((id) => {
    const set = new Set([id]);
    let grew = true;
    while (grew) {
      grew = false;
      nodes.forEach((n) => {
        if (n.parentId && set.has(n.parentId) && !set.has(n.id)) { set.add(n.id); grew = true; }
      });
    }
    return set;
  }, [nodes]);

  function addNode(parentId, level, title) {
    const t = title.trim();
    if (!t) return;
    setNodes((ns) => [...ns, { id: uid(), parentId, level, title: t, done: false, deadline: null }]);
  }
  function renameNode(id, title) {
    setNodes((ns) => ns.map((n) => (n.id === id ? { ...n, title } : n)));
  }
  function deleteNode(id) {
    const toKill = descendantsOf(id);
    setNodes((ns) => ns.filter((n) => !toKill.has(n.id)));
    if (toKill.has(activeTaskId)) setActiveTaskId(null);
    if (toKill.has(focusId)) setFocusId(nodeById.get(id)?.parentId ?? null);
    setReminded((r) => {
      const c = { ...r };
      toKill.forEach((k) => delete c[k]);
      return c;
    });
  }
  function toggleDone(id) {
    const n = nodeById.get(id);
    if (!n) return;
    const newDone = !n.done;
    setNodes((ns) => ns.map((x) => (x.id === id ? { ...x, done: newDone } : x)));
    if (newDone) setCompletions((c) => [...c, todayKey()]);
    setReminded((r) => { const c = { ...r }; delete c[id]; return c; }); // allow re-remind if reopened
  }
  function setDeadline(id, iso) {
    setNodes((ns) => ns.map((n) => (n.id === id ? { ...n, deadline: iso } : n)));
    setReminded((r) => { const c = { ...r }; delete c[id]; return c; });
  }
  function reparentNode(id, newParentId) {
    const parent = newParentId ? nodeById.get(newParentId) : null;
    const newLevel = parent ? parent.level + 1 : 0;
    if (newLevel > 4) return;
    const desc = descendantsOf(id);
    const shift = newLevel - nodeById.get(id).level;
    setNodes((ns) =>
      ns.map((n) =>
        n.id === id
          ? { ...n, parentId: newParentId, level: newLevel }
          : desc.has(n.id)
          ? { ...n, level: Math.min(4, n.level + shift) }
          : n
      )
    );
  }

  /* ---------- streaks ---------- */
  const streak = useMemo(() => {
    const days = new Set(completions);
    let cur = 0;
    let i = days.has(todayKey()) ? 0 : 1;
    if (!days.has(todayKey()) && !days.has(daysAgoKey(1))) i = 0;
    for (; ; i++) { if (days.has(daysAgoKey(i))) cur++; else break; }
    const sorted = [...days].sort();
    let best = 0, run = 0, prev = null;
    sorted.forEach((k) => {
      if (prev) { const a = new Date(prev), b = new Date(k); run = (b - a) / 86400000 === 1 ? run + 1 : 1; }
      else run = 1;
      best = Math.max(best, run);
      prev = k;
    });
    return { current: cur, best: Math.max(best, cur) };
  }, [completions]);

  const pomToday = sessions.filter((s) => s.dateKey === todayKey()).length;
  const pomWeek = useMemo(() => {
    const keys = new Set(Array.from({ length: 7 }, (_, i) => daysAgoKey(i)));
    return sessions.filter((s) => keys.has(s.dateKey)).length;
  }, [sessions]);

  /* ---------- reminders ---------- */
  const pushToast = useCallback((t) => {
    const id = uid();
    setToasts((x) => [...x, { id, ...t }]);
    setTimeout(() => setToasts((x) => x.filter((y) => y.id !== id)), 10000);
  }, []);

  const fireReminder = useCallback(
    (n, st) => {
      const title = st === "overdue" ? `Overdue: ${n.title}` : `Due soon: ${n.title}`;
      pushToast({ kind: st === "overdue" ? "danger" : "amber", title, body: fmtDeadline(n.deadline) });
      fireNotification("Altitude — " + title, fmtDeadline(n.deadline));
    },
    [pushToast]
  );

  useEffect(() => {
    const check = () => {
      const ns = nodesRef.current;
      const rem = { ...remindedRef.current };
      let changed = false;
      const fires = [];
      ns.forEach((n) => {
        if (!n.deadline || n.done) return;
        const st = deadlineState(n.deadline);
        if (st === "overdue" && rem[n.id] !== "overdue") { rem[n.id] = "overdue"; changed = true; fires.push([n, st]); }
        else if (st === "soon" && !rem[n.id]) { rem[n.id] = "soon"; changed = true; fires.push([n, st]); }
      });
      if (changed) { setReminded(rem); fires.forEach(([n, st]) => fireReminder(n, st)); }
    };
    check();
    const iv = setInterval(check, 30000);
    return () => clearInterval(iv);
  }, [fireReminder]);

  async function enableReminders() {
    const p = await requestNotifPermission();
    setNotifState(p);
    if (p === "granted") fireNotification("Altitude", "Deadline reminders are on.");
  }

  const deadlineItems = useMemo(
    () =>
      nodes
        .filter((n) => n.deadline && !n.done)
        .sort((a, b) => new Date(a.deadline) - new Date(b.deadline)),
    [nodes]
  );
  const overdueCount = deadlineItems.filter((n) => deadlineState(n.deadline) === "overdue").length;
  const soonCount = deadlineItems.filter((n) => deadlineState(n.deadline) === "soon").length;

  /* ---------- keyboard ---------- */
  useEffect(() => {
    function onKey(e) {
      const tag = document.activeElement?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.code === "Space") { e.preventDefault(); running ? pauseTimer() : startTimer(); }
      else if (e.key === "d") { e.preventDefault(); distractRef.current?.focus(); }
      else if (e.key === "n") { e.preventDefault(); addRef.current?.focus(); }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [running, remaining, endsAt]); // eslint-disable-line

  // close row menu on outside click
  useEffect(() => {
    if (!openMenuId) return;
    const close = () => setOpenMenuId(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [openMenuId]);

  // close header (hamburger) menu on outside click
  useEffect(() => {
    if (!headerMenuOpen) return;
    const close = () => setHeaderMenuOpen(false);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [headerMenuOpen]);

  /* ---------- distraction ---------- */
  const [distractText, setDistractText] = useState("");
  function logDistraction() {
    const t = distractText.trim();
    if (!t) return;
    setDistractions((d) => [{ id: uid(), ts: Date.now(), text: t }, ...d]);
    setDistractText("");
  }

  /* ---------- derived ---------- */
  const activeTask = activeTaskId ? nodeById.get(activeTaskId) : null;
  const total = phaseDuration(phase);
  const pct = total > 0 ? 1 - remaining / total : 0;
  const mm = String(Math.floor(remaining / 60)).padStart(2, "0");
  const ss = String(remaining % 60).padStart(2, "0");

  if (!loaded)
    return (
      <div style={{ fontFamily: "Inter, system-ui, sans-serif", padding: 40, color: "#5C6B78" }}>
        Loading your workspace…
      </div>
    );

  const C = dark
    ? { bg: "#101820", surface: "#18222C", surface2: "#1F2B37", ink: "#E9EEF2", muted: "#8CA0AE",
        border: "#2A3743", accent: "#35B597", accentInk: "#0B1B17", amber: "#E5B14C",
        danger: "#E07A6B", ringTrack: "#26323E",
        heatEmpty: "#1B2530", heatRamp: ["#0E4429", "#006D32", "#26A641", "#39D353"] }
    : { bg: "#F3F6F8", surface: "#FFFFFF", surface2: "#EDF1F4", ink: "#17242F", muted: "#5C6B78",
        border: "#DDE4E9", accent: "#0F7C66", accentInk: "#FFFFFF", amber: "#C98A12",
        danger: "#B9483A", ringTrack: "#E3E9ED",
        heatEmpty: "#EBEDF0", heatRamp: ["#9BE9A8", "#40C463", "#30A14E", "#216E39"] };

  const font = "'Inter', system-ui, -apple-system, sans-serif";
  const display = "'Archivo', 'Inter', system-ui, sans-serif";

  const btn = (primary = false) => ({
    fontFamily: font, fontSize: 13, fontWeight: 600, cursor: "pointer",
    padding: "8px 14px", borderRadius: 8,
    border: primary ? `1px solid ${C.accent}` : `1px solid ${C.border}`,
    background: primary ? C.accent : C.surface, color: primary ? C.accentInk : C.ink,
  });
  const iconBtn = { ...btn(), padding: "6px 10px", fontSize: 12 };

  // The header action buttons — inline on desktop, stacked in the hamburger on phone.
  const closeMenu = () => setHeaderMenuOpen(false);
  const headerActions = (
    <>
      <button style={{ ...iconBtn, ...(overdueCount ? { borderColor: C.danger, color: C.danger } : soonCount ? { borderColor: C.amber, color: C.amber } : {}) }}
        onClick={() => { setShowDeadlines(true); closeMenu(); }}>
        Deadlines{overdueCount ? ` · ${overdueCount} overdue` : soonCount ? ` · ${soonCount} soon` : ""}
      </button>
      <button style={iconBtn} onClick={() => { setShowStats(true); closeMenu(); }}>Stats</button>
      <button style={iconBtn} onClick={() => { setShowLog(true); closeMenu(); }}>
        Distraction log{distractions.length ? ` (${distractions.length})` : ""}
      </button>
      <button style={iconBtn} onClick={() => { setShowSettings(true); closeMenu(); }}>Timer settings</button>
      <button style={iconBtn} onClick={() => { setDark((d) => !d); closeMenu(); }}>{dark ? "Light" : "Dark"}</button>
      {syncOn ? (
        <span title={accountEmail ? `Synced · ${accountEmail}` : "Synced across your devices"}
          style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6, fontSize: 12, fontWeight: 600, color: C.accent,
            border: `1px solid ${C.accent}`, borderRadius: 999, padding: "5px 10px" }}>
          <span style={{ width: 7, height: 7, borderRadius: 999, background: C.accent }} /> Synced
        </span>
      ) : (
        <span title="Data is stored on this device only"
          style={{ fontSize: 12, color: C.muted, border: `1px solid ${C.border}`, borderRadius: 999, padding: "5px 10px", textAlign: "center" }}>
          Local only
        </span>
      )}
      {syncOn ? (
        <button style={iconBtn} onClick={() => { onSignOut(); closeMenu(); }}>Sign out</button>
      ) : cloudEnabled && onGoOnline ? (
        <button style={iconBtn} onClick={() => { onGoOnline(); closeMenu(); }}>Sign in to sync</button>
      ) : null}
    </>
  );

  return (
    <div style={{ minHeight: "100vh", background: C.bg, color: C.ink, fontFamily: font }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Archivo:wght@600;700;800&family=Inter:wght@400;500;600;700&display=swap');
        * { box-sizing: border-box; }
        input, button, select { outline-offset: 2px; }
        input:focus-visible, button:focus-visible, select:focus-visible { outline: 2px solid ${C.accent}; }
        @media (prefers-reduced-motion: reduce) { * { transition: none !important; animation: none !important; } }
        ::placeholder { color: ${C.muted}; opacity: .7; }
        .row:hover .rowActions { opacity: 1; }
        .rowActions { opacity: 0; transition: opacity .15s; }
        @media (hover: none) { .rowActions { opacity: 1; } }
        @keyframes toastIn { from { transform: translateY(8px); opacity: 0 } to { transform: none; opacity: 1 } }
      `}</style>

      {/* ===== header ===== */}
      <header style={{
        display: "flex", alignItems: "center", gap: 12, padding: "14px 20px",
        borderBottom: `1px solid ${C.border}`, background: C.surface, position: "sticky", top: 0, zIndex: 30,
        flexWrap: "wrap",
      }}>
        <div style={{ fontFamily: display, fontWeight: 800, fontSize: 18, letterSpacing: "-0.02em" }}>ALTITUDE</div>
        {!isPhone && <div style={{ fontSize: 12, color: C.muted }}>zoom out to plan · zoom in to act</div>}
        <div style={{ flex: 1 }} />
        <div title="Consecutive days with at least one completed pomodoro or task"
          style={{ fontSize: 13, fontWeight: 600, color: streak.current > 0 ? C.amber : C.muted }}>
          ⚑ {streak.current}d<span style={{ color: C.muted, fontWeight: 400 }}>{isPhone ? "" : ` streak · best ${streak.best}`}</span>
        </div>

        {isPhone ? (
          <>
            <button aria-label="Menu" aria-expanded={headerMenuOpen}
              style={{ ...iconBtn, fontSize: 18, lineHeight: 1, padding: "4px 10px" }}
              onClick={(e) => { e.stopPropagation(); setHeaderMenuOpen((o) => !o); }}>☰</button>
            {headerMenuOpen && (
              <div onClick={(e) => e.stopPropagation()}
                style={{ position: "absolute", top: "100%", right: 12, marginTop: 8, zIndex: 40,
                  background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12,
                  boxShadow: "0 10px 30px rgba(0,0,0,.22)", padding: 8, minWidth: 210,
                  display: "flex", flexDirection: "column", gap: 6 }}>
                {headerActions}
              </div>
            )}
          </>
        ) : headerActions}
      </header>

      {/* ===== mobile tab bar ===== */}
      {isPhone && (
        <div style={{ display: "flex", gap: 6, padding: "10px 16px", background: C.surface,
          borderBottom: `1px solid ${C.border}`, position: "sticky", top: 57, zIndex: 25 }}>
          {[["pomodoro", "Pomodoro"], ["activity", "Activity"], ["goals", "Goals"]].map(([k, label]) => (
            <button key={k} onClick={() => setMobileTab(k)}
              style={{ flex: 1, padding: "9px 4px", borderRadius: 9, fontFamily: font, fontWeight: 700, fontSize: 13, cursor: "pointer",
                border: `1px solid ${mobileTab === k ? C.accent : C.border}`,
                background: mobileTab === k ? C.accent : "transparent",
                color: mobileTab === k ? C.accentInk : C.muted }}>
              {label}
            </button>
          ))}
        </div>
      )}

      <main style={{
        display: isPhone && mobileTab === "activity" ? "none" : "grid",
        gap: 20, padding: 20, maxWidth: 1200, margin: "0 auto",
        gridTemplateColumns: "minmax(300px, 380px) 1fr",
      }}>
        <style>{`@media (max-width: 1100px) {
          main { grid-template-columns: 1fr !important; }
          .timerPanel { position: static !important; top: auto !important; }
        }`}</style>

        {/* ===== left: timer ===== */}
        <section className="timerPanel" style={{
          background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14,
          padding: 22, alignSelf: "start", position: "sticky", top: 78,
          ...(isPhone ? { display: mobileTab === "pomodoro" ? "block" : "none" } : {}),
        }}>
          <div style={{ display: "flex", gap: 6, marginBottom: 18 }}>
            {[["work", "Focus"], ["short", "Short break"], ["long", "Long break"]].map(([p, label]) => (
              <button key={p} onClick={() => switchPhase(p)}
                style={{
                  ...btn(phase === p), flex: 1, padding: "7px 4px", fontSize: 12,
                  background: phase === p ? C.accent : "transparent",
                  color: phase === p ? C.accentInk : C.muted,
                  border: phase === p ? `1px solid ${C.accent}` : `1px solid transparent`,
                }}>{label}</button>
            ))}
          </div>

          <div style={{ display: "flex", justifyContent: "center", marginBottom: 8 }}>
            <svg width="220" height="220" viewBox="0 0 220 220" role="img" aria-label={`${mm}:${ss} remaining`}>
              <circle cx="110" cy="110" r="96" fill="none" stroke={C.ringTrack} strokeWidth="10" />
              <circle cx="110" cy="110" r="96" fill="none"
                stroke={phase === "work" ? C.accent : C.amber} strokeWidth="10" strokeLinecap="round"
                strokeDasharray={2 * Math.PI * 96} strokeDashoffset={2 * Math.PI * 96 * (1 - pct)}
                transform="rotate(-90 110 110)" style={{ transition: "stroke-dashoffset .3s linear" }} />
              <text x="110" y="104" textAnchor="middle"
                style={{ fontFamily: display, fontWeight: 700, fontSize: 44, fill: C.ink }}>{mm}:{ss}</text>
              <text x="110" y="132" textAnchor="middle" style={{ fontSize: 12, fill: C.muted }}>
                {phase === "work" ? "focus session" : phase === "short" ? "short break" : "long break"}
              </text>
            </svg>
          </div>

          <div style={{ display: "flex", gap: 8, justifyContent: "center", marginBottom: 14 }}>
            <button style={{ ...btn(true), minWidth: 96 }} onClick={running ? pauseTimer : startTimer}>
              {running ? "Pause" : "Start"}
            </button>
            <button style={btn()} onClick={() => resetTimer()}>Reset</button>
            <button style={btn()} onClick={skipPhase}>Skip</button>
          </div>
          <div style={{ fontSize: 11, color: C.muted, textAlign: "center", marginBottom: 14 }}>
            Space start/pause · N new item · D log a distraction
          </div>

          {banner && (
            <div style={{ background: C.surface2, border: `1px solid ${C.border}`, borderRadius: 10,
              padding: "10px 12px", fontSize: 13, marginBottom: 14, lineHeight: 1.5 }}>
              {banner.text}
              <button onClick={() => setBanner(null)} style={{ ...iconBtn, marginLeft: 8, padding: "2px 8px", fontSize: 11 }}>ok</button>
            </div>
          )}

          <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 14, marginBottom: 14 }}>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".08em", color: C.muted, marginBottom: 6 }}>ACTIVE TASK</div>
            {activeTask ? (
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 14, fontWeight: 600, flex: 1 }}>{activeTask.title}</span>
                <button style={iconBtn} onClick={() => setActiveTaskId(null)}>unlink</button>
              </div>
            ) : (
              <div style={{ fontSize: 13, color: C.muted }}>
                No task linked — sessions will still be logged. Pick a task from the tracker →
              </div>
            )}
            <div style={{ fontSize: 12, color: C.muted, marginTop: 8 }}>
              Today: <b style={{ color: C.ink }}>{pomToday}</b> pomodoro{pomToday !== 1 ? "s" : ""} ·
              This week: <b style={{ color: C.ink }}> {pomWeek}</b>
            </div>
          </div>

          <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 14, marginBottom: 14 }}>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".08em", color: C.muted, marginBottom: 6 }}>PARK A DISTRACTION</div>
            <div style={{ display: "flex", gap: 6 }}>
              <input ref={distractRef} value={distractText}
                onChange={(e) => setDistractText(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && logDistraction()}
                placeholder="Type it, drop it, back to work"
                style={{ flex: 1, padding: "8px 10px", borderRadius: 8, fontSize: 13,
                  border: `1px solid ${C.border}`, background: C.bg, color: C.ink, fontFamily: font }} />
              <button style={btn()} onClick={logDistraction}>Park</button>
            </div>
          </div>

          <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 14, fontSize: 13, color: C.muted,
            fontStyle: "italic", display: "flex", gap: 8, alignItems: "center" }}>
            <span style={{ flex: 1 }}>“{QUOTES[quoteIdx]}”</span>
            <button style={{ ...iconBtn, fontStyle: "normal" }} onClick={() => setQuoteIdx((i) => (i + 1) % QUOTES.length)}>↻</button>
          </div>
        </section>

        {/* ===== right: hierarchy ===== */}
        <section style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14, padding: 22, minHeight: 500,
          ...(isPhone ? { display: mobileTab === "goals" ? "block" : "none" } : {}) }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 6 }}>
            <button style={{ ...btn(), padding: "6px 12px" }} disabled={focusId === null}
              onClick={() => setFocusId(nodeById.get(focusId)?.parentId ?? null)} title="Zoom out one level">◀ Zoom out</button>
            <nav style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, flexWrap: "wrap" }}>
              <button onClick={() => setFocusId(null)}
                style={{ background: "none", border: "none", cursor: "pointer", color: focusId ? C.accent : C.ink, fontWeight: 600, fontFamily: font, fontSize: 13, padding: 0 }}>All plans</button>
              {breadcrumb.map((b) => (
                <React.Fragment key={b.id}>
                  <span style={{ color: C.muted }}>›</span>
                  <button onClick={() => setFocusId(b.id)}
                    style={{ background: "none", border: "none", cursor: "pointer", fontFamily: font, fontSize: 13, padding: 0,
                      color: b.id === focusId ? C.ink : C.accent, fontWeight: b.id === focusId ? 700 : 600 }}>{b.title}</button>
                </React.Fragment>
              ))}
            </nav>
          </div>

          <div style={{ display: "flex", gap: 4, marginBottom: 16, flexWrap: "wrap" }}>
            {LEVELS.map((l, i) => (
              <div key={l} style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".06em", padding: "3px 8px", borderRadius: 999,
                background: i === currentLevel ? C.accent : C.surface2, color: i === currentLevel ? C.accentInk : C.muted }}>
                {l.toUpperCase()}{i === currentLevel ? "S" : ""}
              </div>
            ))}
          </div>

          {currentLevel <= 4 && (
            <QuickAdd inputRef={addRef} C={C} font={font}
              placeholder={`New ${LEVELS[currentLevel].toLowerCase()} — type and press Enter`}
              onAdd={(t) => addNode(focusId, currentLevel, t)} />
          )}

          {shownNodes.length === 0 && (
            <div style={{ color: C.muted, fontSize: 14, padding: "24px 4px", lineHeight: 1.6 }}>
              Nothing here yet. Add a {LEVELS[currentLevel].toLowerCase()} above —
              one line is enough, you can zoom in and break it down later.
            </div>
          )}
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {shownNodes.map((n) => {
              const p = progressOf(n.id);
              const hasKids = (byParent.get(n.id) || []).length > 0;
              const pctDone = p.total ? Math.round((100 * p.done) / p.total) : 0;
              return (
                <NodeRow key={n.id} n={n} C={C} font={font}
                  hasKids={hasKids} pctDone={pctDone} p={p}
                  isTaskLike={n.level >= 3} isActive={n.id === activeTaskId}
                  menuOpen={openMenuId === n.id}
                  onToggleMenu={(e) => { e.stopPropagation(); setOpenMenuId(openMenuId === n.id ? null : n.id); }}
                  onZoomIn={() => n.level < 4 && setFocusId(n.id)}
                  onToggle={() => toggleDone(n.id)}
                  onRequestDelete={() => { setOpenMenuId(null); setConfirmDelete(n); }}
                  onRename={(t) => renameNode(n.id, t)}
                  onActivate={() => setActiveTaskId(n.id === activeTaskId ? null : n.id)}
                  onShrink={() => setShrinkTarget(n)}
                  onSetDeadline={() => { setOpenMenuId(null); setDeadlineTarget(n); }}
                  onMove={() => { setOpenMenuId(null); setMoveTarget(n); }} />
              );
            })}
          </div>
        </section>
      </main>

      {/* ===== heatmap band (also the Activity tab on phone) ===== */}
      <div style={{ maxWidth: 1200, margin: "0 auto", padding: "0 20px 28px",
        ...(isPhone ? { display: mobileTab === "activity" ? "block" : "none", paddingTop: 20 } : {}) }}>
        <section style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14, padding: 22 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
            <div style={{ fontFamily: display, fontWeight: 700, fontSize: 15 }}>Activity</div>
            <div style={{ fontSize: 12, color: C.muted }}>
              a square per day — darker green = more pomodoros and tasks finished. The point is to keep the grid alive.
            </div>
          </div>
          <Heatmap C={C} completions={completions} />
          {isPhone && (
            <div style={{ borderTop: `1px solid ${C.border}`, marginTop: 20, paddingTop: 18 }}>
              <StatsView C={C} sessions={sessions} nodeById={nodeById} streak={streak} />
            </div>
          )}
        </section>
      </div>

      {/* ===== modals ===== */}
      {shrinkTarget && (
        <ShrinkModal C={C} font={font} task={shrinkTarget} onClose={() => setShrinkTarget(null)}
          onAdd={(titles) => {
            titles.forEach((t) => addNode(shrinkTarget.id, Math.min(4, shrinkTarget.level + 1), t));
            setShrinkTarget(null);
            setFocusId(shrinkTarget.id);
          }} />
      )}

      {deadlineTarget && (
        <DeadlineModal C={C} font={font} node={deadlineTarget} onClose={() => setDeadlineTarget(null)}
          onSave={(iso) => { setDeadline(deadlineTarget.id, iso); setDeadlineTarget(null); }}
          onRemove={() => { setDeadline(deadlineTarget.id, null); setDeadlineTarget(null); }}
          notifState={notifState} onEnableReminders={enableReminders} />
      )}

      {moveTarget && (
        <MoveModal C={C} font={font} node={moveTarget} nodes={nodes} descendantsOf={descendantsOf}
          onClose={() => setMoveTarget(null)}
          onMove={(pid) => { reparentNode(moveTarget.id, pid); setMoveTarget(null); }} />
      )}

      {confirmDelete && (
        <Modal C={C} title="Delete this item?" onClose={() => setConfirmDelete(null)}>
          <div style={{ fontSize: 14, lineHeight: 1.6, marginBottom: 18 }}>
            “{confirmDelete.title}” and everything nested under it will be removed. This can't be undone.
          </div>
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button style={btn()} onClick={() => setConfirmDelete(null)}>Keep it</button>
            <button style={{ ...btn(), background: C.danger, borderColor: C.danger, color: "#fff" }}
              onClick={() => { deleteNode(confirmDelete.id); setConfirmDelete(null); }}>Delete</button>
          </div>
        </Modal>
      )}

      {showLog && (
        <Modal C={C} title="Distraction log" onClose={() => setShowLog(false)}>
          {distractions.length === 0 ? (
            <div style={{ color: C.muted, fontSize: 14 }}>
              Empty — that's a good sign. Press D during a session to park a stray thought here.
            </div>
          ) : (
            <>
              <div style={{ fontSize: 13, color: C.muted, marginBottom: 12 }}>
                Review these after your session or at end of day. Nothing was lost; nothing derailed you.
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: 320, overflowY: "auto" }}>
                {distractions.map((d) => (
                  <div key={d.id} style={{ display: "flex", gap: 10, alignItems: "baseline", fontSize: 14,
                    borderBottom: `1px solid ${C.border}`, paddingBottom: 8 }}>
                    <span style={{ fontSize: 11, color: C.muted, whiteSpace: "nowrap" }}>
                      {new Date(d.ts).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                    </span>
                    <span style={{ flex: 1 }}>{d.text}</span>
                    <button style={iconBtn} onClick={() => setDistractions((x) => x.filter((y) => y.id !== d.id))}>done</button>
                  </div>
                ))}
              </div>
              <button style={{ ...btn(), marginTop: 12 }} onClick={() => setDistractions([])}>Clear all</button>
            </>
          )}
        </Modal>
      )}

      {showDeadlines && (
        <Modal C={C} title="Deadlines" onClose={() => setShowDeadlines(false)}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
            <div style={{ fontSize: 13, color: C.muted, flex: 1 }}>
              {notifState === "granted"
                ? "Desktop reminders are on. You'll also see in-app alerts here."
                : notifState === "unsupported"
                ? "Desktop notifications aren't available here, but in-app reminders still fire."
                : "Turn on desktop reminders, or rely on the in-app alerts."}
            </div>
            {notifState !== "granted" && notifState !== "unsupported" && (
              <button style={btn(true)} onClick={enableReminders}>Enable reminders</button>
            )}
          </div>
          {deadlineItems.length === 0 ? (
            <div style={{ color: C.muted, fontSize: 14 }}>Nothing scheduled. Open a row's ⋯ menu → “Set deadline”.</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: 360, overflowY: "auto" }}>
              {deadlineItems.map((n) => {
                const st = deadlineState(n.deadline);
                const col = st === "overdue" ? C.danger : st === "soon" ? C.amber : C.muted;
                return (
                  <div key={n.id} style={{ display: "flex", gap: 10, alignItems: "center", fontSize: 14,
                    border: `1px solid ${C.border}`, borderLeft: `3px solid ${col}`, borderRadius: 8, padding: "8px 12px" }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 600 }}>{n.title}</div>
                      <div style={{ fontSize: 12, color: col }}>
                        {st === "overdue" ? "Overdue · " : st === "soon" ? "Due soon · " : ""}{fmtDeadline(n.deadline)}
                      </div>
                    </div>
                    <button style={iconBtn} onClick={() => { setFocusId(n.parentId); setShowDeadlines(false); }}>go</button>
                    <button style={iconBtn} onClick={() => toggleDone(n.id)}>done</button>
                  </div>
                );
              })}
            </div>
          )}
        </Modal>
      )}

      {showSettings && (
        <Modal C={C} title="Timer settings" onClose={() => setShowSettings(false)}>
          {[["work", "Focus length (min)"], ["short", "Short break (min)"], ["long", "Long break (min)"], ["cyclesToLong", "Focus sessions before long break"]].map(
            ([k, label]) => (
              <label key={k} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 14, marginBottom: 12 }}>
                {label}
                <input type="number" min="1" max="180" value={settings[k]}
                  onChange={(e) => {
                    const v = Math.max(1, parseInt(e.target.value) || 1);
                    setSettings((s) => ({ ...s, [k]: v }));
                    if (!running && ((k === "work" && phase === "work") || (k === "short" && phase === "short") || (k === "long" && phase === "long")))
                      setRemaining(v * 60);
                  }}
                  style={{ width: 80, padding: "6px 8px", borderRadius: 8, border: `1px solid ${C.border}`, background: C.bg, color: C.ink, fontFamily: font }} />
              </label>
            )
          )}
        </Modal>
      )}

      {showStats && (
        <Modal C={C} title="Focus stats" onClose={() => setShowStats(false)}>
          <StatsView C={C} sessions={sessions} nodeById={nodeById} streak={streak} />
        </Modal>
      )}

      {/* ===== toasts ===== */}
      <div style={{ position: "fixed", right: 16, bottom: 16, zIndex: 60, display: "flex", flexDirection: "column", gap: 8, maxWidth: 340 }}>
        {toasts.map((t) => {
          const col = t.kind === "danger" ? C.danger : t.kind === "amber" ? C.amber : C.accent;
          return (
            <div key={t.id} style={{ background: C.surface, color: C.ink, border: `1px solid ${C.border}`,
              borderLeft: `4px solid ${col}`, borderRadius: 10, padding: "12px 14px", boxShadow: "0 8px 24px rgba(0,0,0,.18)",
              animation: "toastIn .2s ease" }}>
              <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>{t.title}</div>
                  {t.body && <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>{t.body}</div>}
                </div>
                <button onClick={() => setToasts((x) => x.filter((y) => y.id !== t.id))}
                  style={{ border: "none", background: "none", color: C.muted, cursor: "pointer", fontSize: 16, lineHeight: 1 }}>✕</button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ============================================================
   sub-components
   ============================================================ */

function QuickAdd({ C, font, placeholder, onAdd, inputRef }) {
  const [v, setV] = useState("");
  return (
    <input ref={inputRef} value={v} placeholder={placeholder}
      onChange={(e) => setV(e.target.value)}
      onKeyDown={(e) => { if (e.key === "Enter" && v.trim()) { onAdd(v); setV(""); } }}
      style={{ width: "100%", padding: "10px 12px", borderRadius: 10, fontSize: 14, marginBottom: 14,
        border: `1px dashed ${C.border}`, background: "transparent", color: C.ink, fontFamily: font }} />
  );
}

function NodeRow({ n, C, font, hasKids, pctDone, p, isTaskLike, isActive, menuOpen, onToggleMenu,
  onZoomIn, onToggle, onRequestDelete, onRename, onActivate, onShrink, onSetDeadline, onMove }) {
  const [editing, setEditing] = useState(false);
  const [v, setV] = useState(n.title);
  const done = hasKids ? p.done === p.total && p.total > 0 : n.done;
  const dstate = deadlineState(n.deadline);
  const dcol = dstate === "overdue" ? C.danger : dstate === "soon" ? C.amber : C.muted;

  const smallBtn = { fontFamily: font, fontSize: 11, fontWeight: 600, cursor: "pointer",
    padding: "4px 8px", borderRadius: 6, border: `1px solid ${C.border}`, background: C.surface, color: C.muted };
  const menuItem = { display: "block", width: "100%", textAlign: "left", fontFamily: font, fontSize: 13,
    padding: "8px 12px", background: "none", border: "none", cursor: "pointer", color: C.ink };

  return (
    <div className="row" onDoubleClick={() => n.level < 4 && onZoomIn()}
      style={{ position: "relative", display: "flex", alignItems: "center", gap: 10, padding: "10px 12px",
        border: `1px solid ${isActive ? C.accent : C.border}`, borderRadius: 10,
        background: isActive ? (C.bg === "#101820" ? "#152a25" : "#F0F7F5") : C.surface,
        cursor: n.level < 4 ? "pointer" : "default" }}
      title={n.level < 4 ? "Double-click to zoom in" : undefined}>
      {!hasKids ? (
        <input type="checkbox" checked={!!n.done} onChange={onToggle} onClick={(e) => e.stopPropagation()}
          style={{ width: 16, height: 16, accentColor: C.accent, cursor: "pointer" }} />
      ) : (
        <div style={{ width: 34, height: 6, borderRadius: 3, background: C.ringTrack, overflow: "hidden", flexShrink: 0 }}>
          <div style={{ width: `${pctDone}%`, height: "100%", background: C.accent }} />
        </div>
      )}

      {editing ? (
        <input autoFocus value={v} onChange={(e) => setV(e.target.value)} onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            if (e.key === "Enter") { onRename(v.trim() || n.title); setEditing(false); }
            if (e.key === "Escape") { setV(n.title); setEditing(false); }
          }}
          onBlur={() => { onRename(v.trim() || n.title); setEditing(false); }}
          style={{ flex: 1, fontSize: 14, padding: "4px 6px", borderRadius: 6, border: `1px solid ${C.accent}`, background: C.bg, color: C.ink, fontFamily: font }} />
      ) : (
        <span style={{ flex: 1, fontSize: 14, fontWeight: 500, textDecoration: done ? "line-through" : "none",
          color: done ? C.muted : C.ink, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          {n.title}
          {hasKids && <span style={{ fontSize: 11, color: C.muted }}>{p.done}/{p.total} · {pctDone}%</span>}
          {n.deadline && (
            <button onClick={(e) => { e.stopPropagation(); onSetDeadline(); }}
              style={{ fontSize: 11, fontWeight: 600, color: dcol, background: "none",
                border: `1px solid ${dcol}`, borderRadius: 999, padding: "1px 8px", cursor: "pointer", fontFamily: font }}>
              {dstate === "overdue" ? "⚠ " : ""}{fmtDeadline(n.deadline)}
            </button>
          )}
        </span>
      )}

      <div className="rowActions" style={{ display: "flex", gap: 4, flexShrink: 0, alignItems: "center" }}>
        {isTaskLike && (
          <button style={{ ...smallBtn, ...(isActive ? { background: C.accent, color: C.accentInk, borderColor: C.accent } : {}) }}
            onClick={(e) => { e.stopPropagation(); onActivate(); }} title="Link to the Pomodoro timer">
            {isActive ? "◉ active" : "focus"}
          </button>
        )}
        {n.level >= 2 && n.level <= 3 && (
          <button style={smallBtn} onClick={(e) => { e.stopPropagation(); onShrink(); }} title="Feels too big? Break it into micro-steps">shrink</button>
        )}
        {n.level < 4 && (
          <button style={smallBtn} onClick={(e) => { e.stopPropagation(); onZoomIn(); }}>open ▸</button>
        )}
        <button style={smallBtn} onClick={onToggleMenu} title="More">⋯</button>
      </div>

      {menuOpen && (
        <div onClick={(e) => e.stopPropagation()} style={{ position: "absolute", top: "100%", right: 8, marginTop: 4, zIndex: 15,
          background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, boxShadow: "0 8px 24px rgba(0,0,0,.18)",
          minWidth: 160, overflow: "hidden" }}>
          <button style={menuItem} onClick={() => { setEditing(true); onToggleMenu({ stopPropagation() {} }); }}>Rename</button>
          <button style={menuItem} onClick={onSetDeadline}>{n.deadline ? "Edit deadline" : "Set deadline"}</button>
          <button style={menuItem} onClick={onMove}>Move / re-parent</button>
          <button style={{ ...menuItem, color: C.danger, borderTop: `1px solid ${C.border}` }} onClick={onRequestDelete}>Delete</button>
        </div>
      )}
    </div>
  );
}

function Modal({ C, title, onClose, children }) {
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(10,16,20,.45)", zIndex: 50,
      display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: C.surface, color: C.ink, borderRadius: 14,
        border: `1px solid ${C.border}`, padding: 22, width: "100%", maxWidth: 520, maxHeight: "85vh", overflowY: "auto" }}>
        <div style={{ display: "flex", alignItems: "center", marginBottom: 16 }}>
          <div style={{ fontWeight: 700, fontSize: 16, flex: 1 }}>{title}</div>
          <button onClick={onClose} style={{ border: `1px solid ${C.border}`, background: C.surface, color: C.muted,
            borderRadius: 8, padding: "4px 10px", cursor: "pointer", fontSize: 13 }}>✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

function ShrinkModal({ C, font, task, onClose, onAdd }) {
  const [steps, setSteps] = useState([""]);
  const canSave = steps.some((s) => s.trim());
  return (
    <Modal C={C} title={`Shrink: ${task.title}`} onClose={onClose}>
      <div style={{ fontSize: 14, lineHeight: 1.6, marginBottom: 14, color: C.muted }}>
        Big tasks stall because the first move is fuzzy. Use the <b style={{ color: C.ink }}>2-minute rule</b>:
        what is the <i>smallest physical action</i> you could do right now? “Open the file.” “Write one sentence.”
        “Name the test.” Don't plan the whole thing — just list the next few tiny moves. Then just start.
      </div>
      {steps.map((s, i) => (
        <input key={i} autoFocus={i === steps.length - 1} value={s}
          placeholder={i === 0 ? "Smallest next physical action…" : "Then maybe…"}
          onChange={(e) => setSteps((x) => x.map((y, j) => (j === i ? e.target.value : y)))}
          onKeyDown={(e) => { if (e.key === "Enter" && s.trim() && i === steps.length - 1) setSteps((x) => [...x, ""]); }}
          style={{ width: "100%", padding: "9px 11px", borderRadius: 8, fontSize: 14, marginBottom: 8,
            border: `1px solid ${C.border}`, background: C.bg, color: C.ink, fontFamily: font }} />
      ))}
      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
        <button disabled={!canSave} onClick={() => onAdd(steps.filter((s) => s.trim()))}
          style={{ fontFamily: font, fontSize: 13, fontWeight: 600, cursor: canSave ? "pointer" : "not-allowed",
            padding: "9px 16px", borderRadius: 8, border: `1px solid ${C.accent}`,
            background: canSave ? C.accent : C.border, color: canSave ? C.accentInk : C.muted, flex: 1 }}>
          Add micro-tasks & open them
        </button>
        <button onClick={onClose} style={{ fontFamily: font, fontSize: 13, fontWeight: 600, cursor: "pointer",
          padding: "9px 16px", borderRadius: 8, border: `1px solid ${C.border}`, background: C.surface, color: C.ink }}>Cancel</button>
      </div>
    </Modal>
  );
}

function DeadlineModal({ C, font, node, onClose, onSave, onRemove, notifState, onEnableReminders }) {
  const [val, setVal] = useState(node.deadline || defaultDeadlineStr());
  return (
    <Modal C={C} title={`Deadline: ${node.title}`} onClose={onClose}>
      <div style={{ fontSize: 13, color: C.muted, lineHeight: 1.6, marginBottom: 14 }}>
        You'll get a reminder when it's within 24 hours, and again if it slips past due.
      </div>
      <input type="datetime-local" value={val} onChange={(e) => setVal(e.target.value)}
        style={{ width: "100%", padding: "10px 12px", borderRadius: 8, fontSize: 14, marginBottom: 14,
          border: `1px solid ${C.border}`, background: C.bg, color: C.ink, fontFamily: font }} />

      {notifState !== "granted" && notifState !== "unsupported" && (
        <div style={{ fontSize: 12, color: C.muted, marginBottom: 14, display: "flex", gap: 8, alignItems: "center" }}>
          <button onClick={onEnableReminders} style={{ fontFamily: font, fontSize: 12, fontWeight: 600, cursor: "pointer",
            padding: "6px 10px", borderRadius: 8, border: `1px solid ${C.accent}`, background: "transparent", color: C.accent }}>
            Enable desktop reminders
          </button>
          <span>otherwise you'll still get in-app alerts.</span>
        </div>
      )}

      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        {node.deadline && (
          <button onClick={onRemove} style={{ fontFamily: font, fontSize: 13, fontWeight: 600, cursor: "pointer",
            padding: "9px 16px", borderRadius: 8, border: `1px solid ${C.border}`, background: C.surface, color: C.danger, marginRight: "auto" }}>
            Remove deadline
          </button>
        )}
        <button onClick={onClose} style={{ fontFamily: font, fontSize: 13, fontWeight: 600, cursor: "pointer",
          padding: "9px 16px", borderRadius: 8, border: `1px solid ${C.border}`, background: C.surface, color: C.ink }}>Cancel</button>
        <button onClick={() => val && onSave(val)} style={{ fontFamily: font, fontSize: 13, fontWeight: 600, cursor: "pointer",
          padding: "9px 16px", borderRadius: 8, border: `1px solid ${C.accent}`, background: C.accent, color: C.accentInk }}>Save</button>
      </div>
    </Modal>
  );
}

function MoveModal({ C, font, node, nodes, descendantsOf, onClose, onMove }) {
  const desc = descendantsOf(node.id);
  const candidates = nodes.filter((x) => x.level < 4 && !desc.has(x.id));
  const [sel, setSel] = useState("TOP");
  return (
    <Modal C={C} title={`Move: ${node.title}`} onClose={onClose}>
      <div style={{ fontSize: 13, color: C.muted, lineHeight: 1.6, marginBottom: 14 }}>
        Pick a new parent. The item (and anything under it) shifts to sit one level below whatever you choose.
      </div>
      <select value={sel} onChange={(e) => setSel(e.target.value)}
        style={{ width: "100%", padding: "10px 12px", borderRadius: 8, fontSize: 14, marginBottom: 16,
          border: `1px solid ${C.border}`, background: C.bg, color: C.ink, fontFamily: font }}>
        <option value="TOP">Top level (a Year)</option>
        {candidates.map((c) => (
          <option key={c.id} value={c.id}>{"— ".repeat(c.level)}{c.title} [{LEVELS[c.level]}]</option>
        ))}
      </select>
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button onClick={onClose} style={{ fontFamily: font, fontSize: 13, fontWeight: 600, cursor: "pointer",
          padding: "9px 16px", borderRadius: 8, border: `1px solid ${C.border}`, background: C.surface, color: C.ink }}>Cancel</button>
        <button onClick={() => onMove(sel === "TOP" ? null : sel)} style={{ fontFamily: font, fontSize: 13, fontWeight: 600, cursor: "pointer",
          padding: "9px 16px", borderRadius: 8, border: `1px solid ${C.accent}`, background: C.accent, color: C.accentInk }}>Move here</button>
      </div>
    </Modal>
  );
}

function levelFor(count) {
  if (count <= 0) return 0;
  if (count === 1) return 1;
  if (count <= 3) return 2;
  if (count <= 6) return 3;
  return 4;
}

function Heatmap({ C, completions }) {
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

function StatsView({ C, sessions, nodeById, streak }) {
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(); d.setDate(d.getDate() - (6 - i));
    const key = todayKey(d);
    return { key, label: d.toLocaleDateString([], { weekday: "short" }), count: sessions.filter((s) => s.dateKey === key).length };
  });
  const max = Math.max(1, ...days.map((d) => d.count));
  const byTask = new Map();
  sessions.forEach((s) => { if (s.taskId) byTask.set(s.taskId, (byTask.get(s.taskId) || 0) + 1); });
  const top = [...byTask.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);

  return (
    <div>
      <div style={{ fontSize: 13, color: C.muted, marginBottom: 8 }}>Pomodoros, last 7 days</div>
      <div style={{ display: "flex", gap: 8, alignItems: "flex-end", height: 100, marginBottom: 6 }}>
        {days.map((d) => (
          <div key={d.key} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
            <div style={{ fontSize: 11, color: C.muted }}>{d.count || ""}</div>
            <div style={{ width: "100%", borderRadius: "4px 4px 0 0", background: C.accent,
              height: `${(d.count / max) * 70}px`, minHeight: d.count ? 4 : 1, opacity: d.count ? 1 : 0.15 }} />
          </div>
        ))}
      </div>
      <div style={{ display: "flex", gap: 8, marginBottom: 18 }}>
        {days.map((d) => <div key={d.key} style={{ flex: 1, textAlign: "center", fontSize: 11, color: C.muted }}>{d.label}</div>)}
      </div>

      <div style={{ fontSize: 13, color: C.muted, marginBottom: 8 }}>Most-focused tasks</div>
      {top.length === 0 ? (
        <div style={{ fontSize: 13, color: C.muted }}>Link a task to the timer and the leaderboard fills in.</div>
      ) : (
        top.map(([id, c]) => (
          <div key={id} style={{ display: "flex", justifyContent: "space-between", fontSize: 14, padding: "6px 0", borderBottom: `1px solid ${C.border}` }}>
            <span>{nodeById.get(id)?.title || "(deleted task)"}</span><b>{c}</b>
          </div>
        ))
      )}
      <div style={{ marginTop: 18, fontSize: 13, color: C.muted }}>
        Streak: <b style={{ color: C.amber }}>{streak.current} days</b> · best {streak.best}.
        A streak survives on one pomodoro or one checked-off item — small counts.
      </div>
    </div>
  );
}
