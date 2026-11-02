import { useSyncExternalStore } from "react";

// ponytail: an in-memory store for the Demo Workspace; a reload starts it over.
export function createStore<T>(initial: T) {
  let state = initial;
  const listeners = new Set<() => void>();
  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };
  const get = () => state;
  return {
    get,
    subscribe,
    set(next: T | ((current: T) => T)) {
      state = typeof next === "function" ? (next as (current: T) => T)(state) : next;
      listeners.forEach((listener) => listener());
    },
    use: () => useSyncExternalStore(subscribe, get, get),
  };
}
