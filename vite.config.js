import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

// If you deploy under a sub-path (e.g. GitHub Pages project site at
// https://user.github.io/altitude/), set base to "/altitude/". For Vercel,
// Netlify, Cloudflare Pages, or a custom domain at the root, leave it as "/".
export default defineConfig({
  base: "/",
  plugins: [
    react(),
    VitePWA({
      // We register the service worker manually in main.jsx so we can skip it
      // inside the Capacitor native shell (where a SW isn't wanted).
      injectRegister: null,
      registerType: "autoUpdate",
      includeAssets: ["favicon.png", "icons/apple-touch-icon.png"],
      manifest: {
        name: "Altitude — focus tool",
        short_name: "Altitude",
        description:
          "Pomodoro timer, zoomable project hierarchy, and an anti-procrastination toolkit.",
        theme_color: "#0F7C66",
        background_color: "#101820",
        display: "standalone",
        orientation: "portrait",
        start_url: "/",
        scope: "/",
        icons: [
          { src: "icons/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icons/icon-512.png", sizes: "512x512", type: "image/png" },
          {
            src: "icons/maskable-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,png,svg,woff2}"],
        navigateFallback: "index.html",
      },
    }),
  ],
});
