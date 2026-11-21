import type { AgentUpdateBody } from "@veeloe/protocol-ts";
import { useEffect, useRef, useState } from "react";
import type { AgentRow } from "../../../entities/agent";
import { useMachines } from "../../../entities/machine";
import { SAVE_ANSWER_MS, settle } from "./settle";
import { useMachineLink, useMachineStatus } from "./use-machine-links";

type Change = Omit<AgentUpdateBody, "id">;

/**
 * Save a change to an Agent on its Machine and wait for the echo (ADR 0006): nothing shows as changed until
 * the Machine lists it. `landed` says whether the Agent now carries what went; `onLanded`, when given, runs
 * once instead of letting the save go (a page that closes on it keeps its spinner until it is gone).
 */
export function useAgentUpdate<C extends Change>(agent: AgentRow, { landed, onLanded }: { landed: (agent: AgentRow, sent: C) => boolean; onLanded?: () => void }) {
  const link = useMachineLink();
  const machine = useMachines()?.find((m) => m.id === agent.machine_id);
  const { online, updateError } = useMachineStatus(agent.machine_id);
  const [sent, setSent] = useState<{ change: C; at: number } | null>(null);
  const [tried, setTried] = useState(false);
  const [notSent, setNotSent] = useState(false);
  const [, setTick] = useState(0);
  const left = useRef(false);

  // A send that found no link is tried again once the link or the Machine changes.
  useEffect(() => setNotSent(false), [link, online]);
  useEffect(() => {
    if (sent === null) return;
    const age = Date.now() - sent.at;
    const state = settle({ landed: landed(agent, sent.change), error: updateError, online, age });
    if (state === "landed" && onLanded) {
      if (!left.current) {
        left.current = true;
        onLanded();
      }
      return;
    }
    if (state !== "waiting") return setSent(null);
    // Looks again once the answer is overdue.
    const timer = setTimeout(() => setTick((n) => n + 1), Math.max(0, SAVE_ANSWER_MS - age));
    return () => clearTimeout(timer);
  });

  /** False when nothing went: no link, no Machine, or the Hub is not connected. */
  function send(change: C) {
    if (!link || !machine) return false;
    setTried(true);
    if (!link.updateAgent(machine, { id: agent.id, ...change })) {
      setNotSent(true);
      return false;
    }
    setSent({ change, at: Date.now() });
    return true;
  }

  const sending = sent !== null;
  return { send, sending, notSent, offline: online === false || !link || notSent, error: tried && !sending ? updateError : null };
}
