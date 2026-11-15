import { Capacitor } from "@capacitor/core";

// Inside the Android app the web files are local, so API calls must go to the Luna server.
// Change this if the server moves.
export const REMOTE_SERVER = "https://luna-1x48.onrender.com";

export const isNativeApp = (): boolean => {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
};

export const apiUrl = (path: string): string => (isNativeApp() ? REMOTE_SERVER + path : path);

export const wsUrl = (path: string): string => {
  if (isNativeApp()) return REMOTE_SERVER.replace(/^http/, "ws") + path;
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}${path}`;
};
