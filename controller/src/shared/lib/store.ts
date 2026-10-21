import { useSyncExternalStore } from "react";

// ponytail: a module-level store for fixture data. It goes when screens read
// SQLite live queries (ADR 0021); the hooks built on it keep their signatures.
export function createStore<T>(initial: T) {
  let state = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => state,
    set(update: (current: T) => T) {
      state = update(state);
      listeners.forEach((listener) => listener());
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

type Store<T> = ReturnType<typeof createStore<T>>;

// select must return something already in the state, not a new array or object.
export function useStore<T, S>(store: Store<T>, select: (state: T) => S): S {
  return useSyncExternalStore(store.subscribe, () => select(store.get()), () => select(store.get()));
}
