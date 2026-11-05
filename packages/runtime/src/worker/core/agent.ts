import { TaskEventKind } from "@veeloe/protocol";
import type { ToWorker } from "../../ipc";
import { conversation } from "./conversation";
import { LlmError, type EventStore, type Llm, type SupervisorLink, type ToolRunner } from "./ports";

/** How many times one Turn may go back to the LLM, so a tool loop cannot run all night. */
export const MAX_ROUNDS = 50;

type ToolUse = { type: "tool_use"; id: string; name: string; input: unknown };

export type AgentCore = ReturnType<typeof createAgentCore>;

/**
 * One Agent: one Turn at a time (ADR 0011), each in the name of the Member who
 * sent its message (ADR 0010). Everything it does is an event in the log first,
 * and every event goes to the Member who started the Task.
 */
export function createAgentCore({ name, store, llm, tools, link }: { name: string; store: EventStore; llm: Llm; tools: ToolRunner; link: SupervisorLink }) {
  let running: Promise<void> | undefined;
  let current = name;

  function append(task: string, starter: string, kind: string, body: unknown, messageId?: string) {
    const event = store.append(task, kind, body, messageId);
    link.send({ kind: "event", task, starter, event });
  }

  async function runTurn(task: string, starter: string, member: string) {
    // Once per Turn: a rename reaches the next Turn, never one halfway through (`agent-settings`).
    const system = `You are ${current}, an Agent that runs on its owner's own machine through Veeloe. Answer in the language the person writes in.`;
    append(task, starter, TaskEventKind.TurnStarted, { member });
    const available = new Set(tools.definitions().map((t) => t.name));
    for (let round = 0; round < MAX_ROUNDS; round++) {
      let reply;
      try {
        reply = await llm.send({ task, system, messages: conversation(store.events(task)), tools: tools.definitions() });
      } catch (err) {
        append(task, starter, TaskEventKind.TurnEnded, { reason: "error", code: err instanceof LlmError ? err.code : "provider.failed" });
        return;
      }
      append(task, starter, TaskEventKind.LlmMessage, { content: reply.content });
      const uses = reply.content.filter((block): block is ToolUse => (block as { type?: string }).type === "tool_use");
      if (reply.stopReason !== "tool_use" || uses.length === 0) {
        append(task, starter, TaskEventKind.TurnEnded, { reason: "done" });
        return;
      }
      const results = [];
      for (const use of uses) {
        try {
          if (!available.has(use.name)) throw new Error(`there is no tool named ${use.name}`);
          results.push({ type: "tool_result", tool_use_id: use.id, content: await tools.run(use.name, use.input) });
        } catch (err) {
          results.push({ type: "tool_result", tool_use_id: use.id, content: (err as Error).message, is_error: true });
        }
      }
      append(task, starter, TaskEventKind.ToolResult, { content: results });
    }
    append(task, starter, TaskEventKind.TurnEnded, { reason: "error", code: "turn.too_many_rounds" });
  }

  return {
    /** Synchronous up to the start of a Turn, so two messages can never both find the Agent free. */
    receive(message: Exclude<ToWorker, { kind: "llm.response" | "agent" }>) {
      if (message.kind === "list") {
        link.send({ kind: "tasks", member: message.member, tasks: store.tasksStartedBy(message.member) });
        return;
      }
      const starter = store.starterOf(message.task);
      if (starter !== undefined && starter !== message.member) {
        link.send({ kind: "error", member: message.member, ref: message.ref, code: "task.not_found", task: message.task });
        return;
      }
      if (message.kind === "sync") {
        if (starter === undefined) link.send({ kind: "error", member: message.member, ref: message.ref, code: "task.not_found", task: message.task });
        else link.send({ kind: "events", task: message.task, member: message.member, events: store.events(message.task, message.after) });
        return;
      }
      if (store.hasMessage(message.id)) return; // a resend: it is in the log already
      if (running) {
        link.send({ kind: "error", member: message.member, ref: message.ref, code: "agent.busy", task: message.task });
        return;
      }
      const owner = starter ?? message.member;
      if (starter === undefined) store.createTask(message.task, owner);
      append(message.task, owner, TaskEventKind.MemberMessage, { member: message.member, id: message.id, text: message.text }, message.id);
      running = runTurn(message.task, owner, message.member).finally(() => {
        running = undefined;
      });
    },
    rename(name: string) {
      current = name;
    },
    /** Resolves when the Turn running now, if any, has ended. */
    idle: () => running ?? Promise.resolve(),
  };
}
