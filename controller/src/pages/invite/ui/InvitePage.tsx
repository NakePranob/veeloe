import { parseInvitationLink, type GrantLevel } from "@veeloe/protocol-ts";
import { useEffect, useState } from "react";
import { Share, View } from "react-native";
import { useAgents } from "../../../entities/agent";
import { groupBodies, useGroups } from "../../../entities/device";
import { ownsAny, useMachines } from "../../../entities/machine";
import { AgentLevelRow, AgentLevelSelect } from "../../../widgets/agent-level";
import { useMachineLink, useMachineStatuses } from "../../../features/machine-link";
import { useDatabase, useLiveQuery } from "../../../shared/db";
import { deviceName } from "../../../shared/device-name";
import { describeError, useLanguage, useT } from "../../../shared/i18n";
import { keySession } from "../../../shared/keystore";
import { when } from "../../../shared/lib";
import { Button, Card, confirm, Empty, Field, inform, Note, Row, Screen, Section, Select, space, Text } from "../../../shared/ui";
import { addJoined, closeInvitation, draftInvitation, grantsOf, INVITATION_TOPIC, joinedOf, LIST_INVITATIONS, letIn, markClosed, openInvitation, saveInvitation, takeRequest, type Ask, type Grant, type Invitation } from "../model/invite";

const TOPICS = [INVITATION_TOPIC];
const PEOPLE = [1, 2, 3, 5, 10, 20] as const;
const HOURS = [1, 24, 168] as const;
type Choice = GrantLevel | "none";

// Inviting people to Agents with one link (ADR 0059): choose the Agents and each one's level, how many people
// and for how long, then share the link. Everyone who opens it asks in here, and the inviter compares each one's
// short code before letting them in. Laid out as the Files page: one Select a value, a section per question.
export function InvitePage() {
  const t = useT("invite");
  const invitations = useLiveQuery<Invitation>(LIST_INVITATIONS, [], TOPICS);
  const [drafting, setDrafting] = useState(false);
  // The latest one stays on screen while it is still live or just filled up, so whoever was let in shows.
  const latest = invitations?.[0];
  const open = latest && latest.closed_at === null && Date.now() < latest.expires_at * 1000 ? latest : undefined;
  if (!invitations) return <Screen title={t("title")}>{null}</Screen>;
  if (open && !drafting) return <OpenInvitation key={open.id} invitation={open} onNew={() => setDrafting(true)} />;
  return <DraftInvitation onOpened={() => setDrafting(false)} />;
}

function DraftInvitation({ onOpened }: { onOpened: () => void }) {
  const t = useT("invite");
  const database = useDatabase();
  const machines = useMachines();
  const agents = useAgents();
  const statuses = useMachineStatuses();
  const link = useMachineLink();
  // One Hub per link: the first Machine that is online, as Linking picks one.
  const first = machines?.find((m) => statuses[m.id]?.online === true) ?? machines?.[0];
  const here = machines?.filter((m) => m.hub_url === first?.hub_url) ?? [];
  const onHub = agents?.filter((agent) => here.some((m) => m.id === agent.machine_id)) ?? [];
  // Only where this Member may grant (ADR 0093): an Owner holds Manage everywhere, anyone else where they manage.
  // A Grant elsewhere would let the person in and then be refused by the Machine.
  // Only an Owner attaches Agents; a group admin brings people into their group alone (ADR 0093).
  const owner = ownsAny(machines ?? undefined);
  const ours = owner ? onHub.filter((agent) => agent.level === "manage") : [];
  const [levels, setLevels] = useState<Record<string, Choice>>({});
  // A group this device's Member may add people to: an Owner's every group, an admin's own (ADR 0091).
  const me = new Set(machines?.map((m) => m.member_id));
  const groups = useGroups()?.filter((group) => owner || group.admins.some((m) => me.has(m))) ?? [];
  const [group, setGroup] = useState("");
  const [title, setTitle] = useState("");
  const [people, setPeople] = useState<number>(1);
  const [hours, setHours] = useState<number>(24);
  const [from, setFrom] = useState(deviceName);
  const [busy, setBusy] = useState(false);
  const grants: Grant[] = ours.flatMap((agent) => {
    const level = levels[agent.id] ?? "none";
    return level === "none" ? [] : [{ machine: agent.machine_id, agent: agent.id, level }];
  });

  if (!first || !link) {
    return (
      <Screen title={t("title")}>
        <Empty icon="agent" title={t("none.title")} detail={t("none.body")} />
      </Screen>
    );
  }
  // Someone who is neither an Owner nor a group admin brings nobody in (ADR 0093).
  if (!owner && groups.length === 0) {
    return (
      <Screen title={t("title")}>
        <Empty icon="share" title={t("cannotInvite.title")} detail={t("cannotInvite.body")} />
      </Screen>
    );
  }
  const hub = first;

  async function create() {
    if (!from.trim()) return inform(t("cannot"), t("from.empty"));
    if ((grants.length === 0 && !group) || !link) return;
    setBusy(true);
    const { link: invitation, text } = draftInvitation({ hub: hub.hub_url, ownKey: link.ownKey, from, hours });
    const answer = await openInvitation((use) => keySession.withFreshAuthentication(t("prompt.open", { count: people }), use), { link: invitation, max: people, machine: hub });
    setBusy(false);
    if (answer === null) return;
    if (!answer.ok) return inform(t("cannot"), describeError({ code: answer.code }));
    await saveInvitation(database, {
      id: invitation.id,
      hub_url: hub.hub_url,
      workspace_id: hub.workspace_id,
      member_id: hub.member_id,
      secret: invitation.secret,
      link: text,
      max_members: people,
      expires_at: invitation.expires,
      grants: JSON.stringify(grants),
      group_id: group || null,
      title: title.trim() || null,
      created_at: Date.now(),
    });
    onOpened();
  }

  const levelLabel = (level: Choice) => t(`level.${level}`);
  return (
    <Screen title={t("title")} bottom={<Button size="large" variant="primary" label={t("create")} disabled={(grants.length === 0 && !group) || busy} onPress={() => void create()} />}>
      {owner && (
        <Section title="Agent" footer={t("agents.footer")}>
          {ours.length === 0 && <Row title={onHub.length === 0 ? t("agents.empty") : t("agents.noneToGrant")} />}
          {ours.map((agent) => (
            <AgentLevelSelect
              key={agent.id}
              agent={agent}
              machine={machines?.find((m) => m.id === agent.machine_id)?.name ?? ""}
              value={levels[agent.id] ?? "none"}
              cancel={t("cancel")}
              options={(["none", "use", "approve", "manage"] as const).map((level) => ({ value: level, label: levelLabel(level) }))}
              onChange={(level) => setLevels((was) => ({ ...was, [agent.id]: level }))}
            />
          ))}
        </Section>
      )}
      {groups.length > 0 && (
        <Section title={t("group.heading")} footer={t("group.footer")}>
          <Select label={t("group.label")} value={group} cancel={t("cancel")} options={[{ value: "", label: t("group.none") }, ...groups.map((g) => ({ value: g.id, label: g.name }))]} onChange={setGroup} />
        </Section>
      )}
      <Field label={t("role.label")} value={title} onChangeText={setTitle} placeholder={t("role.placeholder")} footer={t("role.footer")} />
      <Section title={t("link.heading")} footer={t("link.footer")}>
        <Select label={t("people.label")} value={String(people)} cancel={t("cancel")} options={PEOPLE.map((count) => ({ value: String(count), label: t("people.count", { count }) }))} onChange={(count) => setPeople(Number(count))} />
        <Select label={t("hours.label")} value={String(hours)} cancel={t("cancel")} options={HOURS.map((value) => ({ value: String(value), label: t(`hours.${value}`) }))} onChange={(value) => setHours(Number(value))} />
      </Section>
      <Field label={t("from.label")} value={from} onChangeText={setFrom} footer={t("from.footer")} />
    </Screen>
  );
}

function OpenInvitation({ invitation, onNew }: { invitation: Invitation; onNew: () => void }) {
  const t = useT("invite");
  const language = useLanguage();
  const database = useDatabase();
  const machines = useMachines() ?? [];
  const agents = useAgents() ?? [];
  const link = useMachineLink();
  const group = useGroups()?.find((g) => g.id === invitation.group_id);
  const parsed = parseInvitationLink(invitation.link, 0);
  const grants = grantsOf(invitation);
  const joined = joinedOf(invitation);
  const [asks, setAsks] = useState<Ask[]>([]);
  const [refused, setRefused] = useState<string[]>([]);
  const [problem, setProblem] = useState<string | null>(null);
  const machine = machines.find((m) => m.hub_url === invitation.hub_url && m.workspace_id === invitation.workspace_id);

  // Requests reach this device only while it is connected; whoever asks keeps asking until let in.
  // biome-ignore lint/correctness/useExhaustiveDependencies: joined and refused are read fresh through the setter
  useEffect(() => {
    if (!link || !parsed.ok) return;
    return link.onInvitationRequest((hub, request) => {
      if (hub !== invitation.hub_url) return;
      const ask = takeRequest(parsed.link, request, joinedOf(invitation));
      if (!ask) return;
      setAsks((was) => (was.some((a) => a.key === ask.key) ? was : [...was, ask]));
    });
  }, [link, invitation.id, invitation.joined]);

  if (!parsed.ok || !machine) return <Screen title={t("title")}>{null}</Screen>;
  const inviteLink = parsed.link;
  const waiting = asks.filter((ask) => !refused.includes(ask.key) && !joined.some((person) => person.key === ask.key));

  async function admit(ask: Ask) {
    if (!link || !machine) return;
    // The code is the whole check that this is the person meant (ADR 0059): said before anything is signed.
    if (!(await confirm({ title: t("compare.title", { name: ask.name }), message: t("compare.body", { name: ask.name, code: ask.code }), action: t("compare.action"), cancel: t("cancel") }))) return;
    const result = await letIn((use) => keySession.withFreshAuthentication(t("prompt.admit", { name: ask.name }), use), {
      link: inviteLink,
      ask,
      machine,
      machines,
      grants,
      setGrant: (on, body) => link.setGrant(on, body),
      title: invitation.title,
      alsoOn: group?.grants.map((grant) => grant.machine),
    });
    if (result === null) return;
    if (!result.answer.ok) return setProblem(describeError({ code: result.answer.code }));
    // Into the group on every Machine; one that is not connected counts as a Grant not sent.
    const intoGroup = group
      ? groupBodies({ ...group, members: [...group.members, result.member] }, machines).filter(({ machine: id, body }) => {
          const on = machines.find((m) => m.id === id);
          return !on || !link.setGroup(on, body);
        })
      : [];
    const missed = result.unsent.length + intoGroup.length;
    setProblem(null);
    await addJoined(database, invitation.id, { key: ask.key, member: result.member, name: ask.name });
    if (missed > 0) inform(t("unsent.title"), t("unsent.body", { name: ask.name, count: missed }));
  }

  async function close() {
    if (!machine) return;
    if (!(await confirm({ title: t("close.title"), message: t("close.body"), action: t("close.action"), cancel: t("cancel"), destructive: true }))) return;
    const answer = await closeInvitation((use) => keySession.withFreshAuthentication(t("prompt.close"), use), { link: inviteLink, machine });
    if (answer === null) return;
    // A Hub that cannot be reached still leaves the link closed here; it lapses there when it runs out.
    if (!answer.ok && answer.code !== "pairing.hub_unreachable") return setProblem(describeError({ code: answer.code }));
    await markClosed(database, invitation.id);
  }

  const agentName = (id: string) => agents.find((agent) => agent.id === id)?.name ?? id;
  const full = joined.length >= invitation.max_members;
  return (
    <Screen title={t("title")} subtitle={t("subtitle", { joined: joined.length, count: invitation.max_members })}>
      {problem && <Note tone="warning">{problem}</Note>}
      {full && (
        <Note icon="done" iconColor="green">
          {t("full")}
        </Note>
      )}
      {!full && (
        <Card style={{ gap: space.md }}>
          <Text variant="footnote" tone="secondary">
            {t("share.heading")}
          </Text>
          <Text variant="footnote" mono selectable numberOfLines={3}>
            {invitation.link}
          </Text>
          <Button size="large" leading="share" label={t("share.action")} onPress={() => void Share.share({ message: invitation.link }).catch(() => {})} />
          <Text variant="footnote" tone="secondary">
            {t("share.footer", { when: when(invitation.expires_at * 1000, language) })}
          </Text>
        </Card>
      )}
      {!full && (
        <Section title={t("asks.heading")} footer={t("asks.footer")}>
          {waiting.length === 0 && <Row title={t("asks.empty")} detail={t("asks.emptyDetail")} />}
          {waiting.map((ask) => (
            <Row
              key={ask.key}
              title={ask.name}
              detail={t("asks.code", { code: ask.code })}
              accessory={
                <View style={{ flexDirection: "row", gap: space.sm }}>
                  <Button size="small" label={t("asks.refuse")} onPress={() => setRefused((was) => [...was, ask.key])} />
                  <Button size="small" variant="primary" label={t("asks.admit")} onPress={() => void admit(ask)} />
                </View>
              }
            />
          ))}
        </Section>
      )}
      <Section title={t("grants.heading")}>
        {grants.map((grant) => {
          const agent = agents.find((a) => a.id === grant.agent);
          const key = `${grant.machine}/${grant.agent}`;
          const value = t(`level.${grant.level}`);
          return agent ? <AgentLevelRow key={key} agent={agent} machine={machines.find((m) => m.id === grant.machine)?.name ?? ""} value={value} /> : <Row key={key} title={agentName(grant.agent)} value={value} />;
        })}
        {group && <Row icon="people" title={t("group.label")} value={group.name} />}
        {invitation.title && <Row title={t("role.label")} value={invitation.title} />}
      </Section>
      {joined.length > 0 && (
        <Section title={t("joined.heading")}>
          {joined.map((person) => (
            <Row key={person.key} title={person.name} />
          ))}
        </Section>
      )}
      <View style={{ flexDirection: "row", gap: space.md }}>
        <Button label={t("again")} onPress={onNew} />
        {!full && <Button label={t("close.action")} variant="destructive" onPress={() => void close()} />}
      </View>
    </Screen>
  );
}
