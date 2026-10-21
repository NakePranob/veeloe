import { createStore, useStore } from "@/src/shared/lib";
import type { Mood } from "@/src/shared/ui";
import { TASKS } from "./fixtures";
import type { Message, Task, TaskState } from "./types";

const store = createStore(TASKS);

export function useTasks() {
  return useStore(store, (tasks) => tasks);
}

export function useTask(id: string) {
  return useStore(store, (tasks) => tasks.find((task) => task.id === id));
}

// Tasks are kept newest first, so the first one is the Agent's latest.
export function tasksOf(tasks: Task[], agentId: string) {
  return tasks.filter((task) => task.agent === agentId);
}

export type AgentState = TaskState | "offline";

const MOOD: Record<AgentState, Mood> = { waiting: "waiting", working: "working", done: "happy", idle: "idle", stopped: "idle", offline: "off" };

export function agentState(tasks: Task[], agentId: string, online: boolean): { state: AgentState; mood: Mood } {
  const mine = tasksOf(tasks, agentId);
  const state: AgentState = !online ? "offline" : mine.some((task) => task.state === "waiting") ? "waiting" : (mine[0]?.state ?? "idle");
  return { state, mood: MOOD[state] };
}

export function preview(task: Task) {
  if (task.state === "waiting" && task.approval && !task.approval.answer) return task.approval.command;
  const last = [...task.messages].reverse().find((message) => message.kind === "me" || message.kind === "agent");
  return last?.text ?? "";
}

function update(id: string, change: (task: Task) => Task) {
  store.set((tasks) => tasks.map((task) => (task.id === id ? change(task) : task)));
}

const say = (by: string, text: string): Message => ({ kind: "agent", by, text });

// ponytail: fake Runtime answers on timers so the flow can be clicked through; the real ones come over the Hub.
export function answerApproval(id: string, answer: "once" | "always" | "denied") {
  update(id, (task) => {
    if (!task.approval) return task;
    const approved = answer !== "denied";
    return {
      ...task,
      state: approved ? "working" : "idle",
      approval: { ...task.approval, answer },
      steps: task.steps?.map((step) => (step.state === "live" ? { ...step, state: "done" } : step)),
      messages: [
        ...task.messages,
        { kind: "note", tone: approved ? "done" : "danger", text: task.approval.command },
        say(task.agent, approved ? "กำลัง deploy ขึ้น production" : "รับทราบ ยังไม่ deploy นะ ถ้าอยากให้ทำอย่างอื่นบอกได้เลย"),
      ],
    };
  });
  if (answer === "denied") return;
  update("build", (task) => ({ ...task, state: "done", messages: [...task.messages.slice(0, -1), say("builder", "build เสร็จ ได้ 4.2 MB ส่งผลกลับให้ deployer แล้ว")] }));
  setTimeout(() => {
    update(id, (task) => ({
      ...task,
      state: "done",
      steps: task.steps?.map((step) => ({ ...step, state: "done" })),
      messages: [...task.messages.map((m) => (m.kind === "me" ? { ...m, queued: false } : m)), say(task.agent, "เสร็จแล้ว production เป็นเวอร์ชัน 2.4.0 health check ผ่านทั้ง 3 เครื่อง")],
    }));
  }, 5000);
}

export function send(id: string, text: string) {
  update(id, (task) => {
    const busy = task.state === "waiting" || task.state === "working";
    return { ...task, messages: [...task.messages, { kind: "me", text, queued: busy }] };
  });
  const task = store.get().find((candidate) => candidate.id === id);
  if (!task || task.state === "waiting" || task.state === "working") return;
  setTimeout(() => update(id, (current) => ({ ...current, messages: [...current.messages, say(current.agent, "ได้เลย กำลังดูให้")] })), 700);
}

export function markRead(id: string) {
  if (store.get().find((task) => task.id === id)?.unread) update(id, (task) => ({ ...task, unread: false }));
}
