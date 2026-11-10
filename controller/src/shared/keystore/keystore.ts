import "./polyfill";
import { generateSecretKey } from "@veeloe/protocol-ts";
import { useCallback, useEffect, useSyncExternalStore } from "react";
import { AppState } from "react-native";
import { createKeySession } from "./session";
import { vault } from "./vault";

export const keySession = createKeySession({ vault, now: Date.now, generate: generateSecretKey });

export function useKeyStatus() {
  const status = useSyncExternalStore(keySession.subscribe, keySession.status);
  useEffect(() => void keySession.load(), []);
  return status;
}

/** Runs the five-minute clock; returns what to call on a touch. Timers stop in the background, so coming back checks too. */
export function useKeyActivity() {
  useEffect(() => {
    const timer = setInterval(keySession.check, 5000);
    const appState = AppState.addEventListener("change", (state) => {
      if (state === "active") keySession.check();
    });
    const onKey = () => keySession.touch();
    if (process.env.EXPO_OS === "web") window.addEventListener("keydown", onKey, true);
    return () => {
      clearInterval(timer);
      appState.remove();
      if (process.env.EXPO_OS === "web") window.removeEventListener("keydown", onKey, true);
    };
  }, []);
  return useCallback(() => keySession.touch(), []);
}
