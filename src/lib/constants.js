import { Momentum } from "../components/habits/HabitAnalytics.jsx";
import { counts } from "./tree.js";

/* ============================================================
   Altitude — focus tool
   Pomodoro + zoomable hierarchy + anti-procrastination toolkit
   + deadlines/reminders + activity heatmap
   + cross-device sync (Supabase) + native builds (Capacitor)
   ============================================================ */

// No fixed level names any more — nesting is unlimited and depth is derived from the parent chain.
export const INDENT = 22;

export const QUOTES = [
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

export const DEFAULT_SETTINGS = { work: 25, short: 5, long: 15, cyclesToLong: 4 };
