import React from "react";
import ReactDOM from "react-dom/client";
import "./index.css";
import Root from "./Altitude.jsx";
import { isNative } from "./notifications.js";

// Register the PWA service worker only in a real browser — not inside the
// Capacitor native shell, where the app is served from a local scheme and a
// service worker just gets in the way.
if (!isNative()) {
  import("virtual:pwa-register")
    .then(({ registerSW }) => registerSW({ immediate: true }))
    .catch(() => {});
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>
);
