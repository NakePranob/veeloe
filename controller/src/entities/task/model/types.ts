export type TaskState = "waiting" | "working" | "done" | "idle" | "stopped";

export type Message =
  | { kind: "me"; text: string; queued?: boolean }
  | { kind: "agent"; by: string; text: string }
  | { kind: "delegation"; task: string; agent: string; machine: string; title: string }
  | { kind: "note"; tone: "done" | "danger"; text: string };

export interface Approval {
  command: string;
  summary: string;
  expiresAt: number;
  answer?: "once" | "always" | "denied";
}

export interface Step {
  label: string;
  state: "done" | "live" | "next";
  seconds?: number;
}

export interface Task {
  id: string;
  agent: string;
  title: string;
  when: string;
  state: TaskState;
  parent?: string;
  unread?: boolean;
  messages: Message[];
  approval?: Approval;
  steps?: Step[];
}
