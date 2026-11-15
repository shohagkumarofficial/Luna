import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.shohag.luna",
  appName: "Luna",
  webDir: "dist",
  backgroundColor: "#0b0b0f",
  server: { androidScheme: "https" },
};

export default config;
