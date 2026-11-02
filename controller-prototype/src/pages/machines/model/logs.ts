import type { Machine } from "../../../entities/agent";
import type { Task } from "../../../entities/task";

// What the Runtime writes to <VEELOE_HOME>/runtime/logs: ids, message type, tool name,
// duration, tokens and error, never message text, tool output or a file name (ADR 0052).
export interface LogLine {
  at: number;
  source: "supervisor" | "worker";
  agent?: string;
  task?: string;
  turn?: string;
  type: string;
  tool?: string;
  ms?: number;
  tokens?: number;
  error?: string;
}

// ponytail: the demo Runtime charges this much per Turn (see demo-runtime), so the log says the same.
const TURN_TOKENS = 40_000;

// The tool is always "bash" here: the command is content and stays out of the log.
export function logLines(machine: Machine, tasks: Task[], agentIds: string[]): LogLine[] {
  const lines: LogLine[] = [];
  if (machine.lastError) lines.push({ at: Date.now(), source: "supervisor", type: "provider_error", error: machine.lastError });
  for (const task of tasks.filter((candidate) => agentIds.includes(candidate.agent))) {
    let turn = 0;
    const calls = new Map<string, number>();
    for (const event of task.events) {
      const line: LogLine = { at: event.at, source: "worker", agent: task.agent, task: task.id, turn: turn ? `t${turn}` : undefined, type: event.type };
      switch (event.type) {
        case "message":
          line.source = "supervisor";
          line.type = "message_in";
          break;
        case "turn_start":
          line.turn = `t${++turn}`;
          break;
        case "tool_call":
          calls.set(event.id, event.at);
          line.tool = "bash";
          break;
        case "tool_result":
          line.tool = "bash";
          line.ms = event.at - (calls.get(event.id) ?? event.at);
          if (!event.ok) line.error = "tool_failed";
          break;
        case "turn_end":
          line.tokens = TURN_TOKENS;
          break;
        case "interrupted":
          line.error = "turn_interrupted";
          break;
        case "budget_out":
          line.error = "budget_exhausted";
          break;
      }
      lines.push(line);
    }
  }
  return lines.sort((a, b) => a.at - b.at).slice(-200);
}

export function formatLine(line: LogLine) {
  const time = new Date(line.at).toTimeString().slice(0, 8);
  const fields = [`agent=${line.agent}`, `task=${line.task}`, `turn=${line.turn}`, `type=${line.type}`, `tool=${line.tool}`, `ms=${line.ms}`, `tokens=${line.tokens}`, `error=${line.error}`];
  return [time, line.source, ...fields.filter((field) => !field.endsWith("=undefined"))].join(" ");
}
