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

// No fixed level names any more — nesting is unlimited and depth is derived from the parent chain.
const INDENT = 22; // px of indent per depth step in the tree
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
  const now = new Date();
  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (d.toDateString() === now.toDateString()) return time; // today → just "1:30 PM"
  const day = d.toLocaleDateString([], {
    month: "short", day: "numeric",
    ...(d.getFullYear() !== now.getFullYear() ? { year: "numeric" } : {}),
  });
  return `${day}, ${time}`;
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

const isHeading = (n) => n?.type === "heading";

/* A childless heading is a divider, not a unit of work, so it shouldn't drag a
   parent's bar down. Once it holds items it counts as one child like anything else. */
function counts(n, kidsOf) {
  return !isHeading(n) || (kidsOf.get(n.id) || []).length > 0;
}

/* After any check or structural change: a parent is done iff every one of its
   counting children is done. Also returns the list in depth-first display order,
   so array position always mirrors the tree — drag and drop leans on that. */
function rollUp(list) {
  const kidsOf = new Map();
  list.forEach((n) => {
    if (!kidsOf.has(n.parentId)) kidsOf.set(n.parentId, []);
    kidsOf.get(n.parentId).push(n);
  });
  const out = new Map(list.map((n) => [n.id, { ...n }]));
  const order = [];
  (function visit(id) {
    const kids = kidsOf.get(id) || [];
    kids.forEach((k) => { order.push(k.id); visit(k.id); });
    if (id === null) return;
    const counting = kids.filter((k) => counts(k, kidsOf));
    if (counting.length) out.get(id).done = counting.every((k) => out.get(k.id).done);
  })(null);
  const seen = new Set(order);
  list.forEach((n) => { if (!seen.has(n.id)) order.push(n.id); }); // keep orphans rather than lose them
  return order.map((id) => out.get(id));
}

/* Older saves carried `collapsed` (so, expanded by default) plus a now-dead
   `level` field. The tree is condensed by default now, so the flag is inverted. */
function migrateNodes(list) {
  return list.map(({ collapsed, level, ...n }) => ({
    ...n,
    ...(collapsed === false ? { expanded: true } : {}),
  }));
}

/* Index just past the node at `i` and all of its descendants. Relies on the
   list being in depth-first order, which rollUp guarantees. */
function endOfSubtree(list, i) {
  const own = new Set([list[i].id]);
  let at = i + 1;
  while (at < list.length && own.has(list[at].parentId)) { own.add(list[at].id); at++; }
  return at;
}

function seedNodes() {
  return [{ id: uid(), parentId: null, title: "2026", done: false, deadline: null }];
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
  const [addChildTo, setAddChildTo] = useState(null);
  const [dragId, setDragId] = useState(null);
  const [dropAt, setDropAt] = useState(null); // { id, pos }
  // the live drag is mirrored in a ref: pointerup must not read stale state
  const drag = useRef({ id: null, drop: null, spring: null, springId: null });

  // undo/redo: each entry is the tree plus the completion log, which move together
  const [undoStack, setUndoStack] = useState([]);
  const [redoStack, setRedoStack] = useState([]);

  const [editingId, setEditingId] = useState(null);
  const [editSeq, setEditSeq] = useState(0); // bumped to pull focus back after a structural edit
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
    // rollUp on load reconciles older saves, where parents carried their own
    // independent done flag, with the new "done iff all children are done" rule
    setNodes(rollUp(migrateNodes(s?.nodes?.length ? s.nodes : seedNodes())));
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

  /* Progress counts DIRECT children only — a half-finished subtree still reads
     as one unchecked child. Leaves get no bar at all. */
  const progressOf = useCallback(
    (id) => {
      const kids = (byParent.get(id) || []).filter((k) => counts(k, byParent));
      if (!kids.length) return null;
      return { done: kids.filter((k) => k.done).length, total: kids.length };
    },
    [byParent]
  );

  /* The tree, flattened to rows in display order. Depth is derived from the
     parent chain, so nesting has no ceiling. Collapsed nodes hide their subtree. */
  const visibleRows = useMemo(() => {
    const rows = [];
    (function walk(parentId, depth) {
      (byParent.get(parentId) || []).forEach((n) => {
        rows.push({ n, depth });
        if (n.expanded) walk(n.id, depth + 1); // condensed by default — open on demand
      });
    })(focusId, 0);
    return rows;
  }, [byParent, focusId]);

  const zoomOut = useCallback(
    () => setFocusId((f) => (f ? nodeById.get(f)?.parentId ?? null : null)),
    [nodeById]
  );

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

  /* ---------- undo ---------- */
  // Snapshot before a change, never after. Expand/collapse and zoom are view
  // state, so they deliberately don't land on the stack.
  const snapshot = useCallback(
    (label) => {
      setUndoStack((s) => [...s.slice(-49), { nodes, completions, label }]);
      setRedoStack([]);
    },
    [nodes, completions]
  );
  function undo() {
    if (!undoStack.length) return;
    const prev = undoStack[undoStack.length - 1];
    setRedoStack((r) => [...r, { nodes, completions, label: prev.label }]);
    setNodes(prev.nodes);
    setCompletions(prev.completions);
    setUndoStack((s) => s.slice(0, -1));
    setEditingId(null);
  }
  function redo() {
    if (!redoStack.length) return;
    const next = redoStack[redoStack.length - 1];
    setUndoStack((s) => [...s.slice(-49), { nodes, completions, label: next.label }]);
    setNodes(next.nodes);
    setCompletions(next.completions);
    setRedoStack((r) => r.slice(0, -1));
    setEditingId(null);
  }
  // kept in a ref so the global key handler doesn't need to re-subscribe every render
  const history = useRef({});
  history.current = { undo, redo };

  function addNodes(parentId, titles, type = "item") {
    const clean = titles.map((t) => t.trim()).filter(Boolean);
    if (!clean.length) return;
    snapshot(clean.length > 1 ? "add items" : "add");
    const made = clean.map((t) => ({ id: uid(), parentId, title: t, done: false, deadline: null,
      ...(type === "heading" ? { type: "heading" } : {}) }));
    // adding an open item under a finished parent re-opens the parent, via rollUp
    setNodes((ns) => rollUp([...ns.map((n) => (n.id === parentId ? { ...n, expanded: true } : n)), ...made]));
  }
  function addNode(parentId, title, type = "item") {
    addNodes(parentId, [title], type);
  }
  function toggleExpand(id, deep = false) {
    const next = !nodeById.get(id)?.expanded;
    const scope = deep ? descendantsOf(id) : new Set([id]);
    setNodes((ns) => ns.map((n) => (scope.has(n.id) ? { ...n, expanded: next } : n)));
  }
  function renameNode(id, title) {
    if (nodeById.get(id)?.title === title) return;
    snapshot("rename");
    setNodes((ns) => ns.map((n) => (n.id === id ? { ...n, title } : n)));
  }
  function deleteNode(id, quiet = false) {
    const toKill = descendantsOf(id);
    if (!quiet) snapshot(toKill.size > 1 ? "delete branch" : "delete");
    setNodes((ns) => rollUp(ns.filter((n) => !toKill.has(n.id))));
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
    const sub = descendantsOf(id); // includes id itself
    snapshot(newDone ? "check" : "uncheck");

    /* The heatmap should measure work, not clicks. Only leaf items that actually
       flip state count — parents are containers, and headings aren't work. Each
       one carries a doneAt so unchecking can retract the right day's entry. */
    const flipped = [...sub]
      .map((k) => nodeById.get(k))
      .filter((x) => x && !isHeading(x) && !(byParent.get(x.id) || []).length && !!x.done !== newDone);
    const flippedIds = new Set(flipped.map((x) => x.id));
    const stamp = new Date().toISOString();

    setNodes((ns) => rollUp(ns.map((x) => {
      if (!sub.has(x.id)) return x;
      if (!flippedIds.has(x.id)) return { ...x, done: newDone };
      return newDone ? { ...x, done: true, doneAt: stamp } : { ...x, done: false, doneAt: null };
    })));

    if (newDone) {
      const key = todayKey();
      setCompletions((c) => [...c, ...flipped.map(() => key)]);
    } else if (flipped.length) {
      // retract one entry per item, on the day it was actually completed
      const owed = {};
      flipped.forEach((x) => {
        if (!x.doneAt) return; // pre-doneAt data: nothing reliable to retract
        const k = todayKey(new Date(x.doneAt));
        owed[k] = (owed[k] || 0) + 1;
      });
      setCompletions((c) => c.filter((k) => (owed[k] ? (owed[k]--, false) : true)));
    }
    setReminded((r) => { const c = { ...r }; sub.forEach((k) => delete c[k]); return c; }); // allow re-remind if reopened
  }
  function setDeadline(id, iso) {
    snapshot("deadline");
    setNodes((ns) => ns.map((n) => (n.id === id ? { ...n, deadline: iso } : n)));
    setReminded((r) => { const c = { ...r }; delete c[id]; return c; });
  }
  function reparentNode(id, newParentId) {
    if (newParentId === id) return;
    const desc = descendantsOf(id);
    if (newParentId && desc.has(newParentId)) return; // can't move a node inside itself
    snapshot("move");
    // depth is derived, so the whole subtree just comes along — nothing to shift
    setNodes((ns) => rollUp(ns.map((n) => (n.id === id ? { ...n, parentId: newParentId } : n))));
  }

  /* Drag/drop move. pos is "before" | "after" (reorder as a sibling of target)
     or "inside" (become target's last child). The whole subtree travels along. */
  function moveNode(dragId, targetId, pos) {
    if (!dragId || !targetId || dragId === targetId) return;
    const sub = descendantsOf(dragId);
    if (sub.has(targetId)) return; // can't drop a node into its own subtree
    setNodes((ns) => {
      const moving = ns.filter((n) => sub.has(n.id)); // already in tree order
      const rest = ns.filter((n) => !sub.has(n.id));
      const ti = rest.findIndex((n) => n.id === targetId);
      if (ti < 0) return ns;
      const newParent = pos === "inside" ? targetId : rest[ti].parentId;
      let at = ti;
      if (pos !== "before") {
        // step past the target's own descendants so we land below them
        const own = new Set([targetId]);
        at = ti + 1;
        while (at < rest.length && own.has(rest[at].parentId)) { own.add(rest[at].id); at++; }
      }
      const moved = moving.map((n) => (n.id === dragId ? { ...n, parentId: newParent } : n));
      const merged = [...rest.slice(0, at), ...moved, ...rest.slice(at)];
      return rollUp(pos === "inside" ? merged.map((n) => (n.id === targetId ? { ...n, expanded: true } : n)) : merged);
    });
  }
  /* Pointer-based drag rather than HTML5 drag events, so the same code path
     works with a mouse and with touch in the Capacitor build. */
  function startDrag(id, e) {
    if (e.button != null && e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    drag.current.id = id;
    drag.current.drop = null;
    setDragId(id);

    const clearSpring = () => { clearTimeout(drag.current.spring); drag.current.springId = null; };

    const onMove = (ev) => {
      const el = document.elementFromPoint(ev.clientX, ev.clientY)?.closest?.("[data-node-id]");
      const overId = el?.getAttribute("data-node-id");
      if (!overId || overId === drag.current.id) { drag.current.drop = null; setDropAt(null); clearSpring(); return; }
      const r = el.getBoundingClientRect();
      const rel = (ev.clientY - r.top) / r.height;
      const pos = rel < 0.28 ? "before" : rel > 0.72 ? "after" : "inside";
      drag.current.drop = { id: overId, pos };
      setDropAt((d) => (d && d.id === overId && d.pos === pos ? d : { id: overId, pos }));
      // hovering "inside" a closed parent springs it open, so you can reach into it
      if (pos === "inside") {
        if (drag.current.springId !== overId) {
          clearSpring();
          drag.current.springId = overId;
          drag.current.spring = setTimeout(
            () => setNodes((ns) => ns.map((n) => (n.id === overId ? { ...n, expanded: true } : n))),
            550
          );
        }
      } else clearSpring();
    };

    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      clearSpring();
      const d = drag.current.drop;
      if (d) { snapshot("move"); moveNode(drag.current.id, d.id, d.pos); }
      drag.current.id = null;
      drag.current.drop = null;
      setDragId(null);
      setDropAt(null);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  }

  /* ---------- outliner editing ---------- */
  /* New sibling directly below `afterId`, below its subtree, opened for typing. */
  function addSiblingAfter(afterId) {
    const src = nodeById.get(afterId);
    if (!src) return;
    const node = { id: uid(), parentId: src.parentId, title: "", done: false, deadline: null };
    snapshot("add");
    setNodes((ns) => {
      const i = ns.findIndex((x) => x.id === afterId);
      if (i < 0) return ns;
      const at = endOfSubtree(ns, i);
      return rollUp([...ns.slice(0, at), node, ...ns.slice(at)]);
    });
    setEditingId(node.id);
  }

  /* Tab: become a child of the sibling above. Shift+Tab: become the next
     sibling of the parent. Both keep the row in edit mode. */
  function indentNode(id) {
    const n = nodeById.get(id);
    if (!n) return;
    const sibs = byParent.get(n.parentId) || [];
    const prev = sibs[sibs.indexOf(n) - 1];
    if (!prev) return; // nothing above to nest under
    snapshot("indent");
    moveNode(id, prev.id, "inside");
    setEditSeq((s) => s + 1);
  }
  function outdentNode(id) {
    const n = nodeById.get(id);
    if (!n?.parentId) return; // already at the top
    if (n.parentId === focusId) return; // don't escape the zoomed-in root
    snapshot("outdent");
    moveNode(id, n.parentId, "after");
    setEditSeq((s) => s + 1);
  }

  /* Arrow keys walk the rows as they're displayed, skipping collapsed subtrees. */
  function moveEditFocus(fromId, delta) {
    const i = visibleRows.findIndex((r) => r.n.id === fromId);
    const next = visibleRows[i + delta];
    if (next) setEditingId(next.n.id);
  }

  /* Committing an empty title removes the row — that's how a stray new row
     disappears, and how Backspace on an empty row deletes it. */
  function commitEdit(id, text) {
    const n = nodeById.get(id);
    if (!n) return;
    const t = text.trim();
    if (t) { renameNode(id, t); return; }
    if ((byParent.get(id) || []).length) return; // has children — keep the old title
    const prev = visibleRows[visibleRows.findIndex((r) => r.n.id === id) - 1];
    deleteNode(id, n.title === ""); // a row that never got a name isn't worth an undo entry
    if (editingId === id) setEditingId(prev ? prev.n.id : null);
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
      const mod = e.metaKey || e.ctrlKey;
      if (mod && (e.key === "z" || e.key === "Z")) {
        // inside a text field the browser's own text undo is the right behaviour
        const t = document.activeElement?.tagName;
        if (t === "INPUT" || t === "TEXTAREA") return;
        e.preventDefault();
        e.shiftKey ? history.current.redo() : history.current.undo();
        return;
      }
      const tag = document.activeElement?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (mod) return;
      if (e.code === "Space") { e.preventDefault(); running ? pauseTimer() : startTimer(); }
      else if (e.key === "d") { e.preventDefault(); distractRef.current?.focus(); }
      else if (e.key === "n") { e.preventDefault(); addRef.current?.focus(); }
      else if (e.key === "Escape") { zoomOut(); } // the only way back up, now that the breadcrumb is gone
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [running, remaining, endsAt, zoomOut]); // eslint-disable-line

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
        .row:hover .grip { opacity: 1; }
        .grip { opacity: 0; transition: opacity .15s; }
        .grip:active { cursor: grabbing; }
        @media (hover: none) { .rowActions, .grip { opacity: 1; } }
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
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12, minHeight: 32 }}>
            {focusId && (
              <button onClick={zoomOut} title="Back up one level (Esc)"
                style={{ ...btn(), padding: "6px 12px", minWidth: 0, overflow: "hidden",
                  textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                ◀ {nodeById.get(nodeById.get(focusId)?.parentId)?.title ?? "All plans"}
              </button>
            )}
            <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
              {undoStack.length > 0 && (
                <button onClick={undo} title="Undo (⌘Z)"
                  style={{ ...btn(), padding: "6px 10px", fontSize: 12, color: C.muted }}>
                  ↶ Undo {undoStack[undoStack.length - 1].label}
                </button>
              )}
              {redoStack.length > 0 && (
                <button onClick={redo} title="Redo (⇧⌘Z)"
                  style={{ ...btn(), padding: "6px 10px", fontSize: 12, color: C.muted }}>↷</button>
              )}
            </div>
          </div>

          <QuickAdd inputRef={addRef} C={C} font={font}
            placeholder="New item — type and press Enter"
            onAdd={(t) => addNode(focusId, t)}
            onAddHeading={(t) => addNode(focusId, t, "heading")} />

          {visibleRows.length === 0 && (
            <div style={{ color: C.muted, fontSize: 14, padding: "24px 4px", lineHeight: 1.6 }}>
              Nothing here yet. Add an item above — one line is enough, and you can
              nest it as deep as you like later.
            </div>
          )}
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {visibleRows.map(({ n, depth }) => (
              <React.Fragment key={n.id}>
                <NodeRow n={n} C={C} font={font} depth={depth}
                  hasKids={(byParent.get(n.id) || []).length > 0}
                  p={progressOf(n.id)}
                  isActive={n.id === activeTaskId}
                  remindersOn={notifState === "granted"}
                  dragging={dragId === n.id}
                  dropPos={dropAt && dropAt.id === n.id ? dropAt.pos : null}
                  onDragStart={(e) => startDrag(n.id, e)}
                  editing={editingId === n.id}
                  editSeq={editSeq}
                  onStartEdit={() => setEditingId(n.id)}
                  onCommitEdit={(text) => { commitEdit(n.id, text); if (editingId === n.id) setEditingId(null); }}
                  onEditKey={(e, text) => {
                    const has = !!text.trim();
                    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); commitEdit(n.id, text); toggleDone(n.id); return; }
                    if (e.metaKey || e.ctrlKey) return; // leave native text editing alone
                    if (e.key === "Enter") {
                      e.preventDefault(); commitEdit(n.id, text);
                      has ? addSiblingAfter(n.id) : setEditingId(null); // Enter on a blank row ends the run
                    } else if (e.key === "Tab") {
                      e.preventDefault();
                      if (!has) return; // nothing to indent — the blank row is about to vanish
                      commitEdit(n.id, text);
                      e.shiftKey ? outdentNode(n.id) : indentNode(n.id);
                    } else if (e.key === "Escape") {
                      e.preventDefault(); commitEdit(n.id, text); setEditingId(null);
                    } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
                      e.preventDefault(); commitEdit(n.id, text);
                      if (has) moveEditFocus(n.id, e.key === "ArrowDown" ? 1 : -1);
                    } else if (e.key === "Backspace" && !text) {
                      e.preventDefault(); commitEdit(n.id, ""); // deletes the row, focus falls to the one above
                    }
                  }}
                  menuOpen={openMenuId === n.id}
                  onToggleMenu={(e) => { e.stopPropagation(); setOpenMenuId(openMenuId === n.id ? null : n.id); }}
                  onZoomIn={() => setFocusId(n.id)}
                  onToggleExpand={(deep) => toggleExpand(n.id, deep)}
                  onAddChild={() => setAddChildTo(addChildTo === n.id ? null : n.id)}
                  onToggle={() => toggleDone(n.id)}
                  onRequestDelete={() => { setOpenMenuId(null); setConfirmDelete(n); }}
                  onActivate={() => setActiveTaskId(n.id === activeTaskId ? null : n.id)}
                  onShrink={() => setShrinkTarget(n)}
                  onSetDeadline={() => { setOpenMenuId(null); setDeadlineTarget(n); }}
                  onMove={() => { setOpenMenuId(null); setMoveTarget(n); }} />
                {addChildTo === n.id && (
                  <div style={{ marginLeft: (depth + 1) * INDENT }}>
                    <QuickAdd C={C} font={font} autoFocus
                      placeholder={`New item under “${n.title}” — Enter to add, Esc to close`}
                      onAdd={(t) => addNode(n.id, t)}
                      onAddHeading={(t) => addNode(n.id, t, "heading")}
                      onEscape={() => setAddChildTo(null)} />
                  </div>
                )}
              </React.Fragment>
            ))}
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
            addNodes(shrinkTarget.id, titles);
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

function QuickAdd({ C, font, placeholder, onAdd, onAddHeading, onEscape, inputRef, autoFocus }) {
  const [v, setV] = useState("");
  function submit(asHeading) {
    if (!v.trim()) return;
    (asHeading && onAddHeading ? onAddHeading : onAdd)(v);
    setV("");
  }
  return (
    <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 14 }}>
      <input ref={inputRef} autoFocus={autoFocus} value={v} placeholder={placeholder}
        onChange={(e) => setV(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); submit(e.shiftKey); }
          if (e.key === "Escape") { setV(""); onEscape?.(); }
        }}
        style={{ flex: 1, minWidth: 0, padding: "10px 12px", borderRadius: 10, fontSize: 14,
          border: `1px dashed ${C.border}`, background: "transparent", color: C.ink, fontFamily: font }} />
      {onAddHeading && (
        <button onClick={() => submit(true)} title="Add as a heading (or Shift+Enter)"
          style={{ fontFamily: font, fontSize: 11, fontWeight: 700, letterSpacing: ".04em", cursor: "pointer",
            padding: "9px 10px", borderRadius: 8, border: `1px dashed ${C.border}`, whiteSpace: "nowrap",
            background: "transparent", color: C.muted }}>
          ＋ heading
        </button>
      )}
    </div>
  );
}

/* small inline glyphs for the deadline line */
const CalGlyph = ({ c }) => (
  <svg width="12" height="12" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0 }} aria-hidden="true">
    <rect x="1.5" y="2.5" width="13" height="12" rx="2" stroke={c} strokeWidth="1.5" />
    <path d="M1.5 6.5h13" stroke={c} strokeWidth="1.5" />
  </svg>
);
const AlarmGlyph = ({ c }) => (
  <svg width="12" height="12" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0 }} aria-hidden="true">
    <circle cx="8" cy="9" r="5.25" stroke={c} strokeWidth="1.5" />
    <path d="M8 6.5V9l1.75 1.25M2.5 3.25l2-1.75M13.5 3.25l-2-1.75" stroke={c} strokeWidth="1.5" strokeLinecap="round" />
  </svg>
);

/* The title editor is mounted only while a row is being edited, so its draft
   state resets naturally as focus moves from row to row. */
function TitleEditor({ C, font, initial, seq, heading, onCommit, onKey }) {
  const [v, setV] = useState(initial);
  const ref = useRef(null);
  // pull focus back after an indent/outdent has re-rendered the row
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    const end = el.value.length;
    el.setSelectionRange(end, end);
  }, [seq]);
  return (
    <input ref={ref} autoFocus value={v}
      onChange={(e) => setV(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => onKey(e, v, setV)}
      onBlur={() => onCommit(v)}
      style={{ flex: 1, minWidth: 0, width: "100%", padding: "4px 6px", borderRadius: 6,
        fontFamily: font, background: C.bg, color: C.ink, border: `1px solid ${C.accent}`,
        fontSize: heading ? 12 : 14, fontWeight: heading ? 700 : 500,
        letterSpacing: heading ? ".07em" : 0, textTransform: heading ? "uppercase" : "none" }} />
  );
}

function NodeRow({ n, C, font, depth, hasKids, p, isActive, remindersOn, menuOpen, onToggleMenu,
  onZoomIn, onToggle, onToggleExpand, onAddChild, onRequestDelete, onActivate,
  onShrink, onSetDeadline, onMove, dragging, dropPos, onDragStart,
  editing, editSeq, onStartEdit, onCommitEdit, onEditKey }) {
  const heading = isHeading(n);
  const done = !!n.done;
  const pct = p ? Math.round((100 * p.done) / p.total) : 0;
  const dstate = deadlineState(n.deadline);
  const dcol = dstate === "overdue" ? C.danger : dstate === "soon" ? C.amber : C.accent;

  // a line above/below for reordering, a ring for "drop inside"
  const dropStyle =
    dropPos === "before" ? { boxShadow: `0 -2px 0 0 ${C.accent}` }
    : dropPos === "after" ? { boxShadow: `0 2px 0 0 ${C.accent}` }
    : dropPos === "inside" ? { boxShadow: `0 0 0 2px ${C.accent}` }
    : null;

  const smallBtn = { fontFamily: font, fontSize: 11, fontWeight: 600, cursor: "pointer",
    padding: "4px 8px", borderRadius: 6, border: `1px solid ${C.border}`, background: C.surface, color: C.muted };
  const menuItem = { display: "block", width: "100%", textAlign: "left", fontFamily: font, fontSize: 13,
    padding: "8px 12px", background: "none", border: "none", cursor: "pointer", color: C.ink };

  const editor = (
    <TitleEditor C={C} font={font} initial={n.title} seq={editSeq} heading={heading}
      onCommit={onCommitEdit} onKey={onEditKey} />
  );

  const grip = (
    <button className="grip" onPointerDown={onDragStart} onClick={(e) => e.stopPropagation()}
      title="Drag to reorder or re-nest" aria-label="Drag to reorder"
      style={{ width: 14, flexShrink: 0, border: "none", background: "none", padding: 0, lineHeight: 1,
        fontSize: 13, color: C.muted, cursor: "grab", touchAction: "none" }}>⠿</button>
  );

  const caret = (
    <button onClick={(e) => { e.stopPropagation(); onToggleExpand(e.altKey); }}
      title={n.expanded ? "Collapse (alt-click for the whole subtree)" : "Expand (alt-click for the whole subtree)"}
      aria-expanded={hasKids ? !!n.expanded : undefined}
      style={{ width: 14, height: 14, flexShrink: 0, border: "none", background: "none", padding: 0,
        lineHeight: 1, fontSize: 9, color: C.muted, cursor: "pointer",
        visibility: hasKids ? "visible" : "hidden",
        transform: n.expanded ? "none" : "rotate(-90deg)", transition: "transform .12s" }}>▼</button>
  );

  const bar = p && (
    <div title={`${p.done} of ${p.total} direct children done`}
      style={{ width: 34, height: 6, borderRadius: 3, background: C.ringTrack, overflow: "hidden", flexShrink: 0 }}>
      <div style={{ width: `${pct}%`, height: "100%", background: C.accent }} />
    </div>
  );

  const actions = (
    <div className="rowActions" style={{ display: "flex", gap: 4, flexShrink: 0, alignItems: "center" }}>
      {!heading && !hasKids && (
        <button style={{ ...smallBtn, ...(isActive ? { background: C.accent, color: C.accentInk, borderColor: C.accent } : {}) }}
          onClick={(e) => { e.stopPropagation(); onActivate(); }} title="Link to the Pomodoro timer">
          {isActive ? "◉ active" : "focus"}
        </button>
      )}
      {!heading && (
        <button style={smallBtn} onClick={(e) => { e.stopPropagation(); onShrink(); }}
          title="Feels too big? Break it into micro-steps">shrink</button>
      )}
      <button style={smallBtn} onClick={(e) => { e.stopPropagation(); onAddChild(); }}
        title="Add something under this">＋</button>
      <button style={smallBtn} onClick={(e) => { e.stopPropagation(); onZoomIn(); }}
        title="Zoom in so this is the only thing on screen">open ▸</button>
      <button style={smallBtn} onClick={onToggleMenu} title="More">⋯</button>
    </div>
  );

  const menu = menuOpen && (
    <div onClick={(e) => e.stopPropagation()} style={{ position: "absolute", top: "100%", right: 8, marginTop: 4, zIndex: 15,
      background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, boxShadow: "0 8px 24px rgba(0,0,0,.18)",
      minWidth: 160, overflow: "hidden" }}>
      <button style={menuItem} onClick={() => { onStartEdit(); onToggleMenu({ stopPropagation() {} }); }}>Rename</button>
      {!heading && (
        <button style={menuItem} onClick={onSetDeadline}>{n.deadline ? "Edit deadline" : "Set deadline"}</button>
      )}
      <button style={menuItem} onClick={onMove}>Move / re-parent</button>
      <button style={{ ...menuItem, color: C.danger, borderTop: `1px solid ${C.border}` }} onClick={onRequestDelete}>Delete</button>
    </div>
  );

  /* ---- heading: a Reminders-style section label, no checkbox ---- */
  if (heading) {
    return (
      <div className="row" data-node-id={n.id} onDoubleClick={onZoomIn} title="Double-click to zoom in"
        style={{ position: "relative", display: "flex", alignItems: "center", gap: 8, cursor: "pointer",
          marginLeft: depth * INDENT, padding: "12px 4px 4px", borderBottom: `1px solid ${C.border}`,
          opacity: dragging ? 0.4 : 1, userSelect: "none", ...dropStyle }}>
        {grip}
        {caret}
        {editing ? editor : (
          <span onClick={(e) => { e.stopPropagation(); onStartEdit(); }}
            onDoubleClick={(e) => e.stopPropagation()} title="Click to edit"
            style={{ flex: 1, minWidth: 0, fontSize: 12, fontWeight: 700, letterSpacing: ".07em",
            textTransform: "uppercase", color: C.muted, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            {n.title}
            {p && <span style={{ fontWeight: 600, letterSpacing: 0 }}>{p.done}/{p.total}</span>}
          </span>
        )}
        {bar}
        {actions}
        {menu}
      </div>
    );
  }

  /* ---- item ---- */
  return (
    <div className="row" data-node-id={n.id} onDoubleClick={onZoomIn} title="Double-click to zoom in"
      style={{ position: "relative", display: "flex", alignItems: "flex-start", gap: 10, padding: "10px 12px",
        marginLeft: depth * INDENT, cursor: "pointer", opacity: dragging ? 0.4 : 1, userSelect: "none",
        border: `1px solid ${isActive ? C.accent : C.border}`, borderRadius: 10,
        background: isActive ? (C.bg === "#101820" ? "#152a25" : "#F0F7F5") : C.surface, ...dropStyle }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, paddingTop: 1 }}>
        {grip}
        {caret}
        <button onClick={(e) => { e.stopPropagation(); onToggle(); }}
          aria-label={done ? "Mark not done" : "Mark done"} aria-pressed={done}
          title={hasKids ? "Checking this checks everything under it" : undefined}
          style={{ width: 19, height: 19, borderRadius: "50%", flexShrink: 0, padding: 0, cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center", lineHeight: 1, fontSize: 11,
            border: `1.5px solid ${done ? C.accent : C.border}`,
            background: done ? C.accent : "transparent", color: C.accentInk }}>
          {done ? "✓" : ""}
        </button>
        {bar}
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        {editing ? editor : (
          <div onClick={(e) => { e.stopPropagation(); onStartEdit(); }}
            onDoubleClick={(e) => e.stopPropagation()} title="Click to edit"
            style={{ fontSize: 14, fontWeight: 500, textDecoration: done ? "line-through" : "none",
            color: done ? C.muted : C.ink, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            {n.title}
            {p && <span style={{ fontSize: 11, color: C.muted }}>{p.done}/{p.total} · {pct}%</span>}
          </div>
        )}
        {n.deadline && !editing && (
          <button onClick={(e) => { e.stopPropagation(); onSetDeadline(); }} title="Edit deadline"
            style={{ display: "inline-flex", alignItems: "center", gap: 5, marginTop: 4, padding: 0,
              background: "none", border: "none", cursor: "pointer", fontFamily: font,
              fontSize: 12, fontWeight: 600, color: done ? C.muted : dcol }}>
            <CalGlyph c={done ? C.muted : dcol} />
            {fmtDeadline(n.deadline)}
            {remindersOn && <AlarmGlyph c={done ? C.muted : dcol} />}
          </button>
        )}
      </div>

      {actions}
      {menu}
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
  // every node outside this one's own subtree is a legal parent — there's no depth ceiling
  const candidates = useMemo(() => {
    const kidsOf = new Map();
    nodes.forEach((n) => {
      if (!kidsOf.has(n.parentId)) kidsOf.set(n.parentId, []);
      kidsOf.get(n.parentId).push(n);
    });
    const out = [];
    (function walk(pid, d) {
      (kidsOf.get(pid) || []).forEach((n) => {
        if (desc.has(n.id)) return; // skip the moving node and everything under it
        out.push({ n, d });
        walk(n.id, d + 1);
      });
    })(null, 0);
    return out;
  }, [nodes, desc]);
  const [sel, setSel] = useState("TOP");
  return (
    <Modal C={C} title={`Move: ${node.title}`} onClose={onClose}>
      <div style={{ fontSize: 13, color: C.muted, lineHeight: 1.6, marginBottom: 14 }}>
        Pick a new parent. The item and everything under it moves as a block.
      </div>
      <select value={sel} onChange={(e) => setSel(e.target.value)}
        style={{ width: "100%", padding: "10px 12px", borderRadius: 8, fontSize: 14, marginBottom: 16,
          border: `1px solid ${C.border}`, background: C.bg, color: C.ink, fontFamily: font }}>
        <option value="TOP">Top level</option>
        {candidates.map(({ n: c, d }) => (
          <option key={c.id} value={c.id}>{"— ".repeat(d)}{c.title}{isHeading(c) ? " (heading)" : ""}</option>
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
