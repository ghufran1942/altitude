import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  // Change appId to your own reverse-domain identifier before publishing.
  appId: "com.altitude.focus",
  appName: "Altitude",
  webDir: "dist",
  backgroundColor: "#101820",
  plugins: {
    LocalNotifications: {
      smallIcon: "ic_stat_icon_config_sample",
      iconColor: "#0F7C66",
    },
  },
};

export default config;
