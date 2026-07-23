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
