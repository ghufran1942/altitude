import { Capacitor } from "@capacitor/core";

export const isNative = () => {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
};

let LN = null;
async function getLocalNotifications() {
  if (!LN) {
    const mod = await import("@capacitor/local-notifications");
    LN = mod.LocalNotifications;
  }
  return LN;
}

// Returns "granted" | "denied" | "default" | "unsupported"
export async function requestNotifPermission() {
  if (isNative()) {
    try {
      const ln = await getLocalNotifications();
      const res = await ln.requestPermissions();
      return res.display === "granted" ? "granted" : "denied";
    } catch {
      return "denied";
    }
  }
  if (typeof Notification !== "undefined") {
    try {
      return await Notification.requestPermission();
    } catch {
      return Notification.permission;
    }
  }
  return "unsupported";
}

export function currentNotifState() {
  if (isNative()) return "default"; // native: unknown until requested
  if (typeof Notification !== "undefined") return Notification.permission;
  return "unsupported";
}

/* ---------------- scheduled reminders ----------------

   On a native build these are handed to the OS ahead of time, so a habit
   reminder fires whether or not the app is running. On the web there is no such
   thing for a closed tab, so Altitude falls back to checking on a timer while
   it's open (see the reminder tick in Altitude.jsx).

   Anything already pending is cancelled first: ids are derived from the habit +
   reminder + day, so re-scheduling replaces rather than duplicates. */

const CHANNEL = "habit-reminders";

export async function scheduleReminders(fires) {
  if (!isNative()) return { scheduled: 0, native: false };
  try {
    const ln = await getLocalNotifications();
    const pending = await ln.getPending();
    const ours = (pending?.notifications || []).filter((n) => n.extra?.kind === "habit");
    if (ours.length) await ln.cancel({ notifications: ours.map((n) => ({ id: n.id })) });

    // The OS caps how many can be pending (iOS allows 64), so take the soonest.
    const batch = fires.slice(0, 60).map((f) => ({
      id: f.id,
      title: f.title,
      body: f.body || "",
      schedule: { at: f.at, allowWhileIdle: true },
      extra: { kind: "habit", habitId: f.habitId, dayKey: f.dayKey },
      ...(isAndroid() ? { channelId: CHANNEL } : {}),
    }));
    if (batch.length) await ln.schedule({ notifications: batch });
    return { scheduled: batch.length, native: true };
  } catch (e) {
    console.error("scheduling reminders failed", e);
    return { scheduled: 0, native: true, error: e };
  }
}

export async function cancelAllReminders() {
  if (!isNative()) return;
  try {
    const ln = await getLocalNotifications();
    const pending = await ln.getPending();
    const ours = (pending?.notifications || []).filter((n) => n.extra?.kind === "habit");
    if (ours.length) await ln.cancel({ notifications: ours.map((n) => ({ id: n.id })) });
  } catch (e) {
    console.error("cancelling reminders failed", e);
  }
}

function isAndroid() {
  try {
    return Capacitor.getPlatform() === "android";
  } catch {
    return false;
  }
}

// Android needs a channel before anything can be delivered to it.
export async function ensureChannel() {
  if (!isAndroid()) return;
  try {
    const ln = await getLocalNotifications();
    await ln.createChannel({
      id: CHANNEL,
      name: "Habit reminders",
      importance: 4,
      visibility: 1,
    });
  } catch (e) {
    console.error("channel setup failed", e);
  }
}

export async function fireNotification(title, body) {
  try {
    if (isNative()) {
      const ln = await getLocalNotifications();
      await ln.schedule({
        notifications: [
          {
            id: Math.floor(Date.now() % 2147483647),
            title,
            body: body || "",
            schedule: { at: new Date(Date.now() + 200) },
          },
        ],
      });
      return;
    }
    if (typeof Notification !== "undefined" && Notification.permission === "granted") {
      new Notification(title, { body: body || "" });
    }
  } catch (e) {
    console.error("notification failed", e);
  }
}
