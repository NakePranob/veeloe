import { randomUUID } from "expo-crypto";
import * as DocumentPicker from "expo-document-picker";
import { useState } from "react";
import { Keyboard } from "react-native";
import type { TaskEventRow } from "../../../entities/task";
import { MAX_ATTACHMENT_BYTES, type useMachineLink } from "../../../features/machine-link";
import { useT } from "../../../shared/i18n";
import { confirm } from "../../../shared/ui";
import { redirectOf, steeringOf } from "./approval";
import type { Item } from "./items";
import { busyOf, stopStateOf } from "./screen";
import type { useTaskScreen } from "./use-task-screen";

type Options = {
  task: string;
  /** Null while the Agent and Machine lists load: nothing can be sent or stopped yet. */
  screen: ReturnType<typeof useTaskScreen>;
  link: ReturnType<typeof useMachineLink>;
  /** Undefined while the log loads. */
  events: readonly TaskEventRow[] | undefined;
  /** The log as drawn, so steering ends the moment its Approval is answered or times out. */
  log?: readonly Item[];
  /** Called as a message goes out, so the log can jump to its end to show it. */
  onSend?: () => void;
};

/** What the composer holds and does: the words and files to send, Send, Attach and the Stop brake. */
export function useComposer({ task, screen, link, events, log, onSend }: Options) {
  const t = useT("task");
  const [text, setText] = useState("");
  const [attachments, setAttachments] = useState<{ name: string; uri: string }[]>([]);
  const [problem, setProblem] = useState<string | null>(null);
  // Set before the first await, so a second tap while files upload cannot send twice.
  const [sending, setSending] = useState(false);
  // Set when the Stop went out, so the brake can say it is working on it until the Turn ends.
  const [stopAsked, setStopAsked] = useState(false);
  // "Tell it what to do instead": the Approval Send answers in place of sending a message (issue #55).
  const [steer, setSteer] = useState<string | null>(null);
  const steering = steeringOf(log ?? [], steer);
  const message = text.trim();
  const agent = screen?.agent;
  const machine = screen?.machine;
  const readOnly = screen?.readOnly ?? true;
  const busy = busyOf(events);
  const brake = stopStateOf(stopAsked, busy, screen?.status.stopError);
  if (stopAsked && !brake.asked) setStopAsked(false);
  const stopping = brake.stopping;

  async function send(words = message) {
    if (steering) return redirect(steering, words);
    if ((!words && attachments.length === 0) || !link || !machine || !agent || readOnly || sending) return;
    const files = attachments;
    Keyboard.dismiss();
    setProblem(null);
    setSending(true);
    onSend?.();
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

  function redirect(request: string, words: string) {
    const answer = redirectOf(words);
    if (!answer || !link || !machine || !agent || readOnly) return;
    setProblem(null);
    if (!link.answerApproval(machine, { agent: agent.id, task, request, ...answer })) {
      setProblem("hub.machine_offline");
      return;
    }
    Keyboard.dismiss();
    onSend?.();
    setText("");
    setSteer(null);
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
    if (!link || !machine || !agent || readOnly) return;
    const ok = await confirm({ title: t("stop.title"), message: t("stop.message", { agent: agent.name }), action: t("stop.action"), cancel: t("stop.cancel"), destructive: true });
    if (!ok) return;
    Keyboard.dismiss();
    if (link.stopTurn(machine, { agent: agent.id, task, id: randomUUID() })) setStopAsked(true);
  }

  const remove = (uri: string) => setAttachments((current) => current.filter((item) => item.uri !== uri));
  return { text, setText, message, attachments, remove, problem, sending, busy, stopping, steering, steer: setSteer, send, attach, stop };
}

export type ComposerState = ReturnType<typeof useComposer>;
