import { matchesAllowlist, splitCommand, TaskEventKind, type ApprovalDecision } from "@veeloe/protocol";
import type { ToWorker } from "../../ipc";
import { conversation } from "./conversation";
import { LlmError, type EventStore, type Llm, type SupervisorLink, type ToolRunner } from "./ports";

/** How many times one Turn may go back to the LLM, so a tool loop cannot run all night. */
export const MAX_ROUNDS = 50;

/** The tools that read and write the Workdir: the sandbox holds them, never the Allowlist (`file-tools`, ADR 0030). */
const FILE_TOOL_NAMES = new Set(["read", "write", "edit", "glob", "grep"]);

/** How long one Approval waits for an answer before it counts as denied (ADR 0030 proposes an hour). */
export const APPROVAL_TIMEOUT_MS = 3_600_000;

type ToolUse = { type: "tool_use"; id: string; name: string; input: unknown };

export type AgentCore = ReturnType<typeof createAgentCore>;

/**
 * One Agent: one Turn at a time (ADR 0011), each in the name of the Member who
 * sent its message (ADR 0010). Everything it does is an event in the log first,
 * and every event goes to the Member who started the Task.
 */
export function createAgentCore({
  name,
  store,
  llm,
  tools,
  link,
  allowlist: initialAllowlist = [],
  approvalTimeoutMs = APPROVAL_TIMEOUT_MS,
}: {
  name: string;
  store: EventStore;
  llm: Llm;
  tools: ToolRunner;
  link: SupervisorLink;
  allowlist?: string[];
  approvalTimeoutMs?: number;
}) {
  let running: Promise<void> | undefined;
  let current = name;
  let allowlist = [...initialAllowlist];
  let timeoutMs = approvalTimeoutMs;
  let approvals = 0;
  type Waiter = { task: string; starter: string; resolve: (answer: { decision: ApprovalDecision; message?: string }) => void; timer: ReturnType<typeof setTimeout> };
  const waiting = new Map<string, Waiter>();

  function append(task: string, starter: string, kind: string, body: unknown, messageId?: string) {
    const event = store.append(task, kind, body, messageId);
    link.send({ kind: "event", task, starter, event });
  }

  /**
   * A tool call outside the Allowlist waits for an Approval first. `bash`
   * matches by command prefix; any other tool (a Connector's, in v0.2) matches
   * by its exact name. The file tools never wait: the sandbox holds them
   * already (`file-tools`, ADR 0008, 0030).
   */
  async function runTool(task: string, starter: string, toolName: string, input: unknown): Promise<unknown> {
    if (toolName === "bash") {
      const command = (input ?? {}) as { command?: unknown };
      if (typeof command.command !== "string" || matchesAllowlist(command.command, allowlist)) return tools.run(toolName, input);
      const answer = await askApproval(task, starter, command.command, splitCommand(command.command));
      if (answer.decision === "approve") return tools.run(toolName, input);
      throw denial(answer);
    }
    if (FILE_TOOL_NAMES.has(toolName) || allowlist.includes(toolName)) return tools.run(toolName, input);
    const answer = await askApproval(task, starter, toolName, [toolName]);
    if (answer.decision === "approve") return tools.run(toolName, input);
    throw denial(answer);
  }

  type Answer = { request: string; decision: ApprovalDecision; message?: string };

  async function askApproval(task: string, starter: string, command: string, parts: string[]): Promise<Answer> {
    const request = `ap_${Date.now().toString(36)}_${((approvals += 1)).toString(36)}_${Math.floor(Math.random() * 0xffffff).toString(36)}`;
    const expiresAt = Date.now() + timeoutMs;
    append(task, starter, TaskEventKind.ApprovalRequested, { request, command, parts, expiresAt });
    return new Promise<Answer>((resolve) => {
      const timer = setTimeout(() => {
        if (!waiting.has(request)) return;
        waiting.delete(request);
        append(task, starter, TaskEventKind.ApprovalAnswered, { request, decision: "deny", message: "expired without an answer" });
        resolve({ request, decision: "deny", message: "expired without an answer" });
      }, timeoutMs);
      waiting.set(request, { task, starter, resolve: (answer) => resolve({ request, ...answer }), timer });
    });
  }

  function denial(answer: Answer): Error {
    if (answer.decision === "redirect") return new Error(`the owner did not approve this${answer.message ? ` and asked for something else instead: ${answer.message}` : ""}, so it did not run (approval ${answer.request})`);
    if (answer.message === "expired without an answer") return new Error(`approval ${answer.request} expired without an answer, so it did not run`);
    return new Error(`the owner denied approval ${answer.request}, so it did not run`);
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
          results.push({ type: "tool_result", tool_use_id: use.id, content: await runTool(task, starter, use.name, use.input) });
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
      if (message.kind === "approval") {
        const waiter = waiting.get(message.request);
        // Answered too late, never asked, or asked by another Task: the Turn already moved on.
        if (!waiter || (message.task !== undefined && waiter.task !== message.task)) {
          link.send({ kind: "error", member: message.member, ref: message.ref, code: "approval.unknown" });
          return;
        }
        waiting.delete(message.request);
        clearTimeout(waiter.timer);
        append(waiter.task, waiter.starter, TaskEventKind.ApprovalAnswered, {
          request: message.request,
          member: message.member,
          decision: message.decision,
          ...(message.message !== undefined && { message: message.message }),
        });
        waiter.resolve({ decision: message.decision, ...(message.message !== undefined && { message: message.message }) });
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
    /** The Allowlist from the supervisor: the next tool call uses it, a running wait keeps its own. */
    setAllowlist(next: string[] = []) {
      allowlist = [...next];
    },
    /** The Approval timeout from the supervisor: the next wait uses it, a running wait keeps its own. */
    setApprovalTimeoutMs(ms: number) {
      if (Number.isFinite(ms) && ms > 0) timeoutMs = ms;
    },
    /** Resolves when the Turn running now, if any, has ended. */
    idle: () => running ?? Promise.resolve(),
  };
}
