import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { cloudEnabled, supabase } from "./supabaseClient.js";
import { currentNotifState, fireNotification, requestNotifPermission } from "./notifications.js";
import { loadCloud, loadLocal, saveCloud, saveLocal, subscribeCloud } from "./store.js";
import Auth from "./Auth.jsx";
import { Heatmap } from "./components/Heatmap.jsx";
import { Modal } from "./components/Modal.jsx";
import { NodeRow } from "./components/NodeRow.jsx";
import { QuickAdd } from "./components/QuickAdd.jsx";
import { StatsView } from "./components/StatsView.jsx";
import { DeadlineModal, MoveModal, ShrinkModal } from "./components/TaskModals.jsx";
import { HabitAnalytics } from "./components/habits/HabitAnalytics.jsx";
import { HabitManager } from "./components/habits/HabitManager.jsx";
import { addReset, removeReset } from "./lib/since.js";
import { HabitsToday } from "./components/habits/HabitsToday.jsx";
import { SinceManager } from "./components/since/SinceManager.jsx";
import { SinceTracker } from "./components/since/SinceTracker.jsx";
import { DEFAULT_SETTINGS, INDENT, QUOTES } from "./lib/constants.js";
import { daysAgoKey, deadlineState, fmtDeadline, shiftKey, todayKey } from "./lib/dates.js";
import { demoHabitLog, seedHabits, streakFrom } from "./lib/habits.js";
import { counts, endOfSubtree, isHeading, migrateNodes, rollUp, seedNodes } from "./lib/tree.js";
import { chime, uid } from "./lib/util.js";

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

export function AltitudeApp({ userId = null, syncOn = false, accountEmail, onSignOut, onGoOnline }) {
  const [loaded, setLoaded] = useState(false);
  const [dark, setDark] = useState(false);

  const [nodes, setNodes] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [completions, setCompletions] = useState([]);
  const [distractions, setDistractions] = useState([]);
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [activeTaskId, setActiveTaskId] = useState(null);
  const [reminded, setReminded] = useState({}); // {nodeId: 'soon'|'overdue'}

  const [habits, setHabits] = useState([]);
  const [habitLog, setHabitLog] = useState({}); // { "2026-03-10": { habitId: true } }
  const [demoHabits, setDemoHabits] = useState(false); // habitLog is invented, not real
  const [sinceItems, setSinceItems] = useState([]);
  const [sinceLog, setSinceLog] = useState({}); // { itemId: ["2026-07-01", ...] }

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
  const [isNarrow, setIsNarrow] = useState(false);
  const [mobileTab, setMobileTab] = useState("pomodoro"); // pomodoro | track | activity | goals
  const [headerMenuOpen, setHeaderMenuOpen] = useState(false);

  const [habitDate, setHabitDate] = useState(todayKey()); // which day the habit list edits
  const [activityView, setActivityView] = useState("focus"); // focus | habits
  const [trackView, setTrackView] = useState("habits");        // habits | since
  const [showHabitManager, setShowHabitManager] = useState(false);
  const [showSinceManager, setShowSinceManager] = useState(false);
  const [armedReset, setArmedReset] = useState(null); // reset is two-step: arm, then confirm

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
    setHabits(s?.habits?.length ? s.habits : seedHabits());
    setHabitLog(s?.habitLog || {});
    setDemoHabits(!!s?.demoHabits);
    setSinceItems(s?.sinceItems || []);
    setSinceLog(s?.sinceLog || {});
    setDark(!!s?.dark);
    setRemaining((s?.settings?.work || DEFAULT_SETTINGS.work) * 60);
  }, []);

  const serialize = useCallback(
    () => ({ nodes, sessions, completions, distractions, settings, activeTaskId, reminded, dark, habits, habitLog, demoHabits }),
    [nodes, sessions, completions, distractions, settings, activeTaskId, reminded, dark, habits, habitLog, demoHabits, sinceItems, sinceLog]
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
        // Seed a new account from local data — but never carry demo history
        // into the cloud, or a first sign-in would pollute the real account.
        else if (initial) saveCloud(userId, initial.demoHabits ? { ...initial, habitLog: {}, demoHabits: false } : initial);
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
  }, [nodes, sessions, completions, distractions, settings, activeTaskId, reminded, dark, habits, habitLog, demoHabits, sinceItems, sinceLog, loaded, userId, serialize]);
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

  /* ---------- breakpoints ---------- */
  useEffect(() => {
    // 1100px switches the page to tabs; 640px is where a tree row runs out of
    // horizontal room and has to fold its buttons into the ⋯ menu
    const wide = window.matchMedia("(max-width: 1100px)");
    const narrow = window.matchMedia("(max-width: 640px)");
    const on = () => { setIsPhone(wide.matches); setIsNarrow(narrow.matches); };
    on();
    [wide, narrow].forEach((mq) =>
      mq.addEventListener ? mq.addEventListener("change", on) : mq.addListener(on));
    return () => {
      [wide, narrow].forEach((mq) =>
        mq.removeEventListener ? mq.removeEventListener("change", on) : mq.removeListener(on));
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
      setUndoStack((s) => [...s.slice(-49), { nodes, completions, habits, habitLog, demoHabits, sinceItems, sinceLog, label }]);
      setRedoStack([]);
    },
    [nodes, completions, habits, habitLog, demoHabits, sinceItems, sinceLog]
  );
  function undo() {
    if (!undoStack.length) return;
    const prev = undoStack[undoStack.length - 1];
    setRedoStack((r) => [...r, { nodes, completions, habits, habitLog, demoHabits, sinceItems, sinceLog, label: prev.label }]);
    setNodes(prev.nodes);
    setCompletions(prev.completions);
    setHabits(prev.habits);
    setHabitLog(prev.habitLog);
    setDemoHabits(!!prev.demoHabits);
    setSinceItems(prev.sinceItems || []);
    setSinceLog(prev.sinceLog || {});
    setUndoStack((s) => s.slice(0, -1));
    setEditingId(null);
  }
  function redo() {
    if (!redoStack.length) return;
    const next = redoStack[redoStack.length - 1];
    setUndoStack((s) => [...s.slice(-49), { nodes, completions, habits, habitLog, demoHabits, sinceItems, sinceLog, label: next.label }]);
    setNodes(next.nodes);
    setCompletions(next.completions);
    setHabits(next.habits);
    setHabitLog(next.habitLog);
    setDemoHabits(!!next.demoHabits);
    setSinceItems(next.sinceItems || []);
    setSinceLog(next.sinceLog || {});
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
  const streak = useMemo(() => streakFrom(new Set(completions)), [completions]);

  const habitStreak = useMemo(
    () => streakFrom(new Set(Object.keys(habitLog).filter((k) => Object.values(habitLog[k] || {}).some(Boolean)))),
    [habitLog]
  );

  function toggleHabit(habitId, dateKey) {
    snapshot("habit");
    setHabitLog((log) => {
      const day = { ...(log[dateKey] || {}) };
      if (day[habitId]) delete day[habitId]; else day[habitId] = true;
      const next = { ...log };
      // drop the day entirely when it empties, so the log doesn't fill with {}
      if (Object.keys(day).length) next[dateKey] = day; else delete next[dateKey];
      return next;
    });
  }

  function shiftHabitDate(delta) {
    setHabitDate((k) => {
      const next = shiftKey(k, delta);
      return next > todayKey() ? k : next; // no stepping into the future
    });
  }

  function loadDemoHabits() {
    snapshot("demo data");
    setHabitLog(demoHabitLog(habits));
    setDemoHabits(true);
  }
  function resetSince(id, dateKey) {
    snapshot("reset counter");
    setSinceLog((log) => addReset(log, id, dateKey));
    setArmedReset(null);
  }
  function removeSinceReset(id, dateKey) {
    snapshot("remove reset");
    setSinceLog((log) => removeReset(log, id, dateKey));
  }

  function clearHabitHistory() {
    snapshot("clear habits");
    setHabitLog({});
    setDemoHabits(false);
  }

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
  // one control, rendered inside whichever panel is showing
  const trackSwitch = (
    <div style={{ display: "flex", gap: 4 }}>
      {[["habits", "Habits"], ["since", "Since"]].map(([k, label]) => (
        <button key={k} onClick={() => { setTrackView(k); setArmedReset(null); }}
          style={{ ...iconBtn, fontWeight: 600,
            border: `1px solid ${trackView === k ? C.accent : C.border}`,
            background: trackView === k ? C.accent : "transparent",
            color: trackView === k ? C.accentInk : C.muted }}>{label}</button>
      ))}
    </div>
  );

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
          {[["pomodoro", "Pomodoro"], ["track", "Track"], ["activity", "Activity"], ["goals", "Goals"]].map(([k, label]) => (
            <button key={k} onClick={() => setMobileTab(k)}
              style={{ flex: 1, padding: "9px 2px", borderRadius: 9, fontFamily: font, fontWeight: 700, fontSize: 12, cursor: "pointer",
                border: `1px solid ${mobileTab === k ? C.accent : C.border}`,
                background: mobileTab === k ? C.accent : "transparent",
                color: mobileTab === k ? C.accentInk : C.muted }}>
              {label}
            </button>
          ))}
        </div>
      )}

      <main style={{
        display: isPhone && (mobileTab === "activity" || mobileTab === "track") ? "none" : "grid",
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
        <section style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14,
          padding: isNarrow ? 14 : 22, minHeight: 500, minWidth: 0, overflowX: "hidden",
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

          <QuickAdd inputRef={addRef} C={C} font={font} compact={isNarrow}
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
                  compact={isNarrow}
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
                  onZoomIn={() => { setOpenMenuId(null); setFocusId(n.id); }}
                  onToggleExpand={(deep) => toggleExpand(n.id, deep)}
                  onAddChild={() => { setOpenMenuId(null); setAddChildTo(addChildTo === n.id ? null : n.id); }}
                  onToggle={() => toggleDone(n.id)}
                  onRequestDelete={() => { setOpenMenuId(null); setConfirmDelete(n); }}
                  onActivate={() => { setOpenMenuId(null); setActiveTaskId(n.id === activeTaskId ? null : n.id); }}
                  onShrink={() => { setOpenMenuId(null); setShrinkTarget(n); }}
                  onSetDeadline={() => { setOpenMenuId(null); setDeadlineTarget(n); }}
                  onMove={() => { setOpenMenuId(null); setMoveTarget(n); }} />
                {addChildTo === n.id && (
                  <div style={{ marginLeft: Math.min(depth + 1, isNarrow ? 4 : 12) * (isNarrow ? 10 : INDENT) }}>
                    <QuickAdd C={C} font={font} autoFocus compact={isNarrow}
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

      {/* ===== track band (also the Track tab on phone) ===== */}
      <div style={{ maxWidth: 1200, margin: "0 auto", padding: "0 20px 20px",
        ...(isPhone ? { display: mobileTab === "track" ? "block" : "none", paddingTop: 20 } : {}) }}>
        {trackView === "habits" ? (
          <HabitsToday C={C} font={font} display={display} habits={habits} log={habitLog}
            dateKey={habitDate} onShift={shiftHabitDate} onToggle={toggleHabit}
            onManage={() => setShowHabitManager(true)} compact={isNarrow}
            viewSwitch={trackSwitch} />
        ) : (
          <section style={{ background: C.surface, border: `1px solid ${C.border}`,
            borderRadius: 14, padding: isNarrow ? 16 : 22 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
              <div style={{ fontFamily: display, fontWeight: 700, fontSize: 15 }}>Track</div>
              {trackSwitch}
              <div style={{ flex: 1 }} />
              <button style={{ fontFamily: font, fontSize: 12, fontWeight: 600, cursor: "pointer",
                padding: "4px 10px", borderRadius: 8, border: `1px solid ${C.border}`,
                background: C.surface, color: C.muted }}
                onClick={() => setShowSinceManager(true)}>Edit trackers</button>
            </div>
            <SinceTracker C={C} font={font} display={display} items={sinceItems} log={sinceLog}
              onReset={resetSince} onManage={() => setShowSinceManager(true)} compact={isNarrow}
              armedId={armedReset} onArm={setArmedReset} onCancelArm={() => setArmedReset(null)} />
          </section>
        )}
      </div>

      {/* ===== activity band (also the Activity tab on phone) ===== */}
      <div style={{ maxWidth: 1200, margin: "0 auto", padding: "0 20px 28px",
        ...(isPhone ? { display: mobileTab === "activity" ? "block" : "none", paddingTop: 20 } : {}) }}>
        <section style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14, padding: 22 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
            <div style={{ fontFamily: display, fontWeight: 700, fontSize: 15 }}>Activity</div>
            <div style={{ display: "flex", gap: 4 }}>
              {[["focus", "Focus"], ["habits", "Habits"]].map(([k, label]) => (
                <button key={k} onClick={() => setActivityView(k)}
                  style={{ ...iconBtn, fontWeight: 600,
                    border: `1px solid ${activityView === k ? C.accent : C.border}`,
                    background: activityView === k ? C.accent : "transparent",
                    color: activityView === k ? C.accentInk : C.muted }}>{label}</button>
              ))}
            </div>
            <div style={{ flex: 1 }} />
            <div style={{ fontSize: 12, color: C.muted }}>
              {activityView === "focus"
                ? "a square per day — darker green = more pomodoros and tasks finished"
                : `⚑ ${habitStreak.current}d habit streak · best ${habitStreak.best}`}
            </div>
          </div>

          {activityView === "focus" ? (
            <>
              <Heatmap C={C} completions={completions} />
              {isPhone && (
                <div style={{ borderTop: `1px solid ${C.border}`, marginTop: 20, paddingTop: 18 }}>
                  <StatsView C={C} sessions={sessions} nodeById={nodeById} streak={streak} />
                </div>
              )}
            </>
          ) : (
            <HabitAnalytics C={C} font={font} display={display} habits={habits} log={habitLog} isPhone={isPhone} />
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

      {showHabitManager && (
        <Modal C={C} title="Edit habits" onClose={() => setShowHabitManager(false)}>
          <HabitManager C={C} font={font} habits={habits}
            onChange={(next) => { snapshot("habits"); setHabits(next); }}
            onLoadDemo={loadDemoHabits} onClearHistory={clearHabitHistory}
            hasHistory={Object.keys(habitLog).length > 0}
            allowDemo={!userId} isDemo={demoHabits} />
        </Modal>
      )}

      {showSinceManager && (
        <Modal C={C} title="Edit trackers" onClose={() => setShowSinceManager(false)}>
          <SinceManager C={C} font={font} items={sinceItems} log={sinceLog}
            onChange={(next) => { snapshot("trackers"); setSinceItems(next); }}
            onAddReset={resetSince} onRemoveReset={removeSinceReset} />
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
