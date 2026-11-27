import { randomUUID } from "expo-crypto";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Keyboard, View } from "react-native";
import { useAgents } from "../../../entities/agent";
import { useMachines, type Machine } from "../../../entities/machine";
import { useMachineLink, useMachineStatus, useTriggerStatus } from "../../../features/machine-link";
import { describeError, useLanguage, useT } from "../../../shared/i18n";
import { Button, confirm, DotLabel, Field, HeaderAction, Note, Row, Screen, Section, ToggleRow, space } from "../../../shared/ui";
import { piecesOf, progressOf, settingsOf, withPiece, type Piece } from "../model/idle";
import { deleteList, signList, STATUS } from "./sign";

const newId = () => `i-${randomUUID().slice(0, 8)}`;

/**
 * One piece of an Idle Work list in a sheet over its page (ADR 0056), as a Schedule has its own sheet: what it says,
 * whether it repeats, where it sits, how its last round went, and removing it. `new` writes a new piece and `draft`
 * reads what the Agent proposed. The Machine holds the list as one signed Trigger, so a save signs the whole list as
 * the Machine holds it at that moment, with this one change.
 */
export function IdleWorkSheet() {
  const t = useT("agent-idle-work");
  const { agent: id, piece } = useLocalSearchParams<{ agent: string; piece: string }>();
  const agent = useAgents()?.find((a) => a.id === id);
  const machine = useMachines()?.find((m) => m.id === agent?.machine_id);
  if (!agent || !machine) return <Screen title={t("title")}>{null}</Screen>;
  const props = { agentId: agent.id, agentName: agent.name, machine };
  return piece === "draft" ? <DraftForm {...props} /> : <PieceForm key={piece} {...props} pieceId={piece} />;
}

type Props = { agentId: string; agentName: string; machine: Machine };

/** What both sheets share: the list as the Machine holds it, asked for when the page has not, and how to sign it. */
function useList({ agentId, agentName, machine }: Props) {
  const t = useT("agent-idle-work");
  const link = useMachineLink();
  const online = useMachineStatus(machine.id).online;
  const status = useTriggerStatus(machine.id, agentId);
  const offline = online === false || !link;
  const asked = status.triggers !== null;
  // Opened straight from a link, the page has not asked yet.
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on ids, since a live query hands back a new Machine row on every write
  useEffect(() => {
    if (link && online !== false && !asked) link.requestTriggers(machine, agentId);
  }, [link, machine.id, agentId, online, asked]);
  const list = status.triggers?.find((trigger) => trigger.kind === "idle");
  return { t, status, list, offline, where: link && { link, machine, agentId, agentName, t } };
}

// Where the piece sits: its place in the list, or last for a new one. It is moved by dragging its row.
type Form = Piece & { position: number };

function PieceForm({ pieceId, ...props }: Props & { pieceId: string }) {
  const { t, status, list, offline, where } = useList(props);
  const language = useLanguage();
  const isNew = pieceId === "new";
  const [id] = useState(() => (isNew ? newId() : pieceId));
  const pieces = piecesOf(list);
  const held = pieces.find((piece) => piece.id === id);
  const progress = list && progressOf(list).find((piece) => piece.id === id);
  const [form, setForm] = useState<Form | null>(null);
  // The form starts from the piece as the Machine holds it, once the list has arrived; a new one goes last.
  useEffect(() => {
    if (form !== null || !status.triggers) return;
    const now = piecesOf(list);
    const at = now.findIndex((piece) => piece.id === id);
    if (at >= 0) setForm({ ...now[at], position: at });
    else if (isNew) setForm({ id, text: "", repeat: false, position: now.length });
  }, [form, status.triggers, list, isNew, id]);
  const [saving, setSaving] = useState(false);
  // ponytail: the iOS toolbar keeps the first onPress it was given, so save reads what it needs through a ref.
  const latest = useRef({ form, list });
  latest.current = { form, list };
  const set = (change: Partial<Form>) => setForm((was) => (was ? { ...was, ...change } : was));

  async function save() {
    const { form, list } = latest.current;
    if (!form || !where || saving) return;
    Keyboard.dismiss();
    setSaving(true);
    try {
      const { position, ...piece } = form;
      if (await signList(where, list, withPiece(piecesOf(list), piece, position), settingsOf(list))) router.back();
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!where || !list || !(await confirm({ title: t("piece.remove.title"), message: t("piece.remove.message"), action: t("piece.remove.action"), cancel: t("cancel"), destructive: true }))) return;
    const rest = piecesOf(list).filter((piece) => piece.id !== id);
    // The last piece out takes the list with it: a list needs at least one piece.
    if (await (rest.length === 0 ? deleteList(where, list) : signList(where, list, rest, settingsOf(list)))) router.back();
  }

  // A piece that did not finish or needed an Approval waits for a person. Signing it under a new id puts it back in
  // line, since the Machine keeps where a piece stands by its id.
  async function retry() {
    const { list } = latest.current;
    if (!where || !list || saving) return;
    const now = piecesOf(list);
    const at = now.findIndex((piece) => piece.id === id);
    if (at < 0) return;
    setSaving(true);
    try {
      if (
        await signList(
          where,
          list,
          withPiece(
            now.filter((piece) => piece.id !== id),
            { ...now[at], id: newId() },
            at,
          ),
          settingsOf(list),
        )
      )
        router.back();
    } finally {
      setSaving(false);
    }
  }

  const locked = offline || status.sending || saving;
  const stuck = progress?.status === "timedOut" || progress?.status === "needsApproval";
  const task = progress?.task;
  const when = (at: number) => new Date(at).toLocaleString(language, { weekday: "short", hour: "2-digit", minute: "2-digit" });
  return (
    <Screen title={isNew ? t("piece.new") : t("piece.edit")} subtitle={props.agentName}>
      <HeaderAction label={t("cancel")} placement="left" onPress={() => router.back()} />
      <HeaderAction label={saving ? t("saving") : t("save")} onPress={() => void save()} disabled={locked || !form?.text.trim()} />
      {offline && <Note tone="offline">{t("offline")}</Note>}
      {status.error && (
        <Note icon="warning" iconColor="orange">
          {describeError({ code: status.error })}
        </Note>
      )}
      {form && (
        <>
          <Section footer={t("piece.footer")}>
            <Field label={t("piece.text")} value={form.text} onChangeText={(text) => set({ text })} placeholder={t("piece.placeholder")} multiline />
          </Section>
          <Section>
            <ToggleRow title={t("piece.repeat")} detail={t("piece.repeatDetail")} value={form.repeat} onChange={(repeat) => set({ repeat })} />
          </Section>
        </>
      )}
      {progress && (
        <Section footer={stuck ? t("piece.retryFooter") : undefined}>
          <Row
            title={t("piece.last")}
            accessory={
              <DotLabel color={STATUS[progress.status].dot} tone="secondary">
                {progress.lastRunAt ? t("piece.lastValue", { status: t(STATUS[progress.status].words), when: when(progress.lastRunAt) }) : t(STATUS[progress.status].words)}
              </DotLabel>
            }
            // The Task takes the sheet's place, as a Schedule's sheet opens its round.
            onPress={task ? () => router.replace({ pathname: "/tasks/[task]", params: { task, agent: props.agentId } }) : undefined}
          />
          {stuck && (
            <View style={{ padding: space.inset }}>
              <Button label={t("piece.retry")} variant="primary" size="large" disabled={locked} onPress={() => void retry()} />
            </View>
          )}
        </Section>
      )}
      {held && (
        <Section>
          <Row icon="trash" title={t("piece.remove.row")} destructive disabled={locked} onPress={() => void remove()} />
        </Section>
      )}
      {!isNew && !held && status.triggers && (
        <Note icon="warning" iconColor="orange">
          {t("piece.missing")}
        </Note>
      )}
    </Screen>
  );
}

type Proposal = { id: string; text: string; take: boolean };

/**
 * What the Agent proposed, read in one sheet: each proposal can be changed and taken or left. Signing the list clears
 * the whole draft on the Machine, so the proposals are read together and the ones left go with it.
 */
function DraftForm(props: Props) {
  const { t, status, list, offline, where } = useList(props);
  const [proposals, setProposals] = useState<Proposal[] | null>(null);
  useEffect(() => {
    if (proposals === null && status.draft) setProposals(status.draft.map((text) => ({ id: newId(), text, take: true })));
  }, [proposals, status.draft]);
  const [saving, setSaving] = useState(false);
  const latest = useRef({ proposals, list });
  latest.current = { proposals, list };
  const set = (id: string, change: Partial<Proposal>) => setProposals((was) => was?.map((one) => (one.id === id ? { ...one, ...change } : one)) ?? was);

  async function save() {
    const { proposals, list } = latest.current;
    if (!proposals || !where || saving) return;
    Keyboard.dismiss();
    setSaving(true);
    try {
      const taken = proposals.filter((one) => one.take).map(({ id, text }) => ({ id, text, repeat: false }));
      // ponytail: with no list yet, leaving every proposal cannot be signed (a list needs a piece), so they wait.
      if (await signList(where, list, [...piecesOf(list), ...taken], settingsOf(list))) router.back();
    } finally {
      setSaving(false);
    }
  }

  const locked = offline || status.sending || saving;
  return (
    <Screen title={t("draft.heading")} subtitle={props.agentName}>
      <HeaderAction label={t("cancel")} placement="left" onPress={() => router.back()} />
      <HeaderAction label={saving ? t("saving") : t("save")} onPress={() => void save()} disabled={locked || !proposals} />
      {offline && <Note tone="offline">{t("offline")}</Note>}
      {proposals?.map((one, index) => (
        <Section key={one.id} footer={index === proposals.length - 1 ? t("draft.sheetFooter") : undefined}>
          <Field label={t("draft.proposal", { n: index + 1 })} value={one.text} onChangeText={(text) => set(one.id, { text })} multiline />
          <ToggleRow title={t("draft.take")} value={one.take} onChange={(take) => set(one.id, { take })} />
        </Section>
      ))}
    </Screen>
  );
}
