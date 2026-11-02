import { createStore } from "../../../shared/lib";
import { demoTasks } from "./demo";
import type { EventBody, Task, TaskEvent } from "./types";

// ponytail: a module-level store over the Demo Workspace. Screens move to SQLite
// live queries (ADR 0021) behind these same hooks.
const tasks = createStore<Task[]>(demoTasks(Date.now()));

export const useTasks = tasks.use;
export const getTasks = tasks.get;
export const subscribeTasks = tasks.subscribe;

export function useTask(id: string | undefined) {
  return useTasks().find((task) => task.id === id);
}

export function getTask(id: string) {
  return tasks.get().find((task) => task.id === id);
}

export function eventsOf(id: string): TaskEvent[] {
  return getTask(id)?.events ?? [];
}

// Events are only ever added at the end, numbered in order (ADR 0018).
export function append(id: string, ...bodies: EventBody[]) {
  tasks.set((all) =>
    all.map((task) => {
      if (task.id !== id) return task;
      const seq = task.events.at(-1)?.seq ?? 0;
      return { ...task, events: [...task.events, ...bodies.map((body, i) => ({ ...body, seq: seq + i + 1, at: Date.now() }))] };
    }),
  );
}

export function updateTask(id: string, patch: Partial<Task>) {
  tasks.set((all) => all.map((task) => (task.id === id ? { ...task, ...patch } : task)));
}

let counter = 0;

type NewTask = Pick<Task, "agent" | "title" | "starter"> & Partial<Pick<Task, "source" | "shared" | "origin" | "project" | "team" | "parent" | "worktree" | "readOnly" | "silent">>;

export function createTask(input: NewTask) {
  const task: Task = { source: "app", shared: false, ...input, id: `task-${++counter}`, events: [] };
  tasks.set((all) => [...all, task]);
  return task;
}

export function deleteTasksOf(agentId: string) {
  tasks.set((all) => all.filter((task) => task.agent !== agentId));
}

export function deleteTasks(ids: string[]) {
  tasks.set((all) => all.filter((task) => !ids.includes(task.id)));
}
