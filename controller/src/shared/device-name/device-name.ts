import * as Device from "expo-device";

/**
 * A name to start this device's entry with, such as "Nake's iPhone" or "Chrome macOS".
 * It is a name, not a sentence, so it has no words to translate; the Owner can change it.
 */
export function deviceName(): string {
  if (process.env.EXPO_OS !== "web") return (Device.deviceName ?? Device.modelName ?? Device.osName ?? "").slice(0, 80);
  const agent = navigator.userAgent;
  const browser = /Edg\//.test(agent) ? "Edge" : /Firefox\//.test(agent) ? "Firefox" : /Chrome\//.test(agent) ? "Chrome" : /Safari\//.test(agent) ? "Safari" : "Browser";
  return [browser, Device.osName].filter(Boolean).join(" ").slice(0, 80);
}
