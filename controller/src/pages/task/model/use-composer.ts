import { randomUUID } from "expo-crypto";
import * as DocumentPicker from "expo-document-picker";
import { useState } from "react";
import { Keyboard } from "react-native";
import type { AgentRow } from "../../../entities/agent";
import type { Machine } from "../../../entities/machine";
import { latestOf, statusOf, type TaskEventRow } from "../../../entities/task";
import { MAX_ATTACHMENT_BYTES, type useMachineLink } from "../../../features/machine-link";
import { useT } from "../../../shared/i18n";
import { confirm } from "../../../shared/ui";

type Options = {
  task: string;
  agent: AgentRow;
  machine: Machine | undefined;
  link: ReturnType<typeof useMachineLink>;
  readOnly: boolean;
  /** Undefined while the log loads. */
  events: readonly TaskEventRow[] | undefined;
  stopError: string | null | undefined;
};

/** What the composer holds and does: the words and files to send, Send, Attach and the Stop brake. */
export function useComposer({ task, agent, machine, link, readOnly, events, stopError }: Options) {
  const t = useT("task");
  const [text, setText] = useState("");
  const [attachments, setAttachments] = useState<{ name: string; uri: string }[]>([]);
  const [problem, setProblem] = useState<string | null>(null);
  // Set before the first await, so a second tap while files upload cannot send twice.
  const [sending, setSending] = useState(false);
  // Set when the Stop went out, so the brake can say it is working on it until the Turn ends.
  const [stopAsked, setStopAsked] = useState(false);
  const message = text.trim();
  // A Turn is running: the Machine queues a new message until it ends.
  const busy = !!events && statusOf(latestOf(events), true) === "working";
  // The Turn ended (by the Stop or by itself) or the Machine refused: nothing is stopping any more.
  if (stopAsked && (!busy || stopError)) setStopAsked(false);
  const stopping = stopAsked && busy && !stopError;

  async function send(words = message) {
    if ((!words && attachments.length === 0) || !link || !machine || readOnly || sending) return;
    const files = attachments;
    Keyboard.dismiss();
    setProblem(null);
    setSending(true);
    const sent = [];
    try {
      for (const file of files) {
        const attachment = await link.sendAttachment(machine, task, file);
        if (!attachment) throw new Error("hub.machine_offline");
        sent.push(attachment);
      }
    } catch (error) {
      setProblem(error instanceof Error ? error.message : "attachment.invalid");
      setSending(false);
      return;
    }
    setText("");
    setAttachments([]);
    try {
      await link.sendMessage(machine, { agent: agent.id, task, text: words || t("attachedOnly"), attachments: sent });
    } catch (error) {
      setProblem(error instanceof Error ? error.message : "hub.machine_offline");
    } finally {
      setSending(false);
    }
  }

  async function attach() {
    const result = await DocumentPicker.getDocumentAsync({ type: "*/*", copyToCacheDirectory: true, multiple: false });
    const asset = result.assets?.[0];
    if (!asset) return;
    if (asset.size && asset.size > MAX_ATTACHMENT_BYTES) {
      setProblem("attachment.too_large");
      return;
    }
    setProblem(null);
    setAttachments((current) => [...current, { name: asset.name, uri: asset.uri }]);
  }

  // Stop can cut work off halfway, so it asks first and says what stops (ADR 0017).
  async function stop() {
    if (!link || !machine || readOnly) return;
    const ok = await confirm({ title: t("stop.title"), message: t("stop.message", { agent: agent.name }), action: t("stop.action"), cancel: t("stop.cancel"), destructive: true });
    if (!ok) return;
    Keyboard.dismiss();
    if (link.stopTurn(machine, { agent: agent.id, task, id: randomUUID() })) setStopAsked(true);
  }

  const remove = (uri: string) => setAttachments((current) => current.filter((item) => item.uri !== uri));
  return { text, setText, message, attachments, remove, problem, sending, busy, stopping, send, attach, stop };
}

export type ComposerState = ReturnType<typeof useComposer>;
