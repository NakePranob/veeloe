import { useSyncExternalStore } from "react";
import { demoTasks } from "./demo";
import type { EventBody, TaskEvent } from "./types";

// ponytail: a module-level store over the Demo Workspace. Screens move to SQLite
// live queries (ADR 0021) behind these same hooks.
let tasks = demoTasks(Date.now());
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useTasks() {
  return useSyncExternalStore(subscribe, () => tasks, () => tasks);
}

export function useTask(id: string | undefined) {
  return useTasks().find((task) => task.id === id);
}

export function eventsOf(id: string): TaskEvent[] {
  return tasks.find((task) => task.id === id)?.events ?? [];
}

// Events are only ever added at the end, numbered in order (ADR 0018).
export function append(id: string, ...bodies: EventBody[]) {
  tasks = tasks.map((task) => {
    if (task.id !== id) return task;
    const seq = task.events.at(-1)?.seq ?? 0;
    return { ...task, events: [...task.events, ...bodies.map((body, i) => ({ ...body, seq: seq + i + 1, at: Date.now() }))] };
  });
  listeners.forEach((listener) => listener());
}
