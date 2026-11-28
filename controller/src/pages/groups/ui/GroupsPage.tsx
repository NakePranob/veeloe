import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { useAgents } from "../../../entities/agent";
import { Character, lookOfJson, moodOf } from "../../../entities/character";
import { groupBodies, type MemberGroup, useGroups, useMembers } from "../../../entities/device";
import { ownsAny, useMachines } from "../../../entities/machine";
import { useMachineLink } from "../../../features/machine-link";
import { useT } from "../../../shared/i18n";
import { keySession } from "../../../shared/keystore";
import { Button, Empty, Field, inform, Row, Screen, Section, Select, ToggleRow } from "../../../shared/ui";

type Choice = "none" | "use" | "approve" | "manage";

/** Sends a changed group to every Machine of its Workspace, signed once (ADR 0091). */
function useSendGroup() {
  const t = useT("groups");
  const machines = useMachines() ?? [];
  const link = useMachineLink();
  return async (group: MemberGroup, prompt: string) => {
    if (!link) return false;
    const bodies = groupBodies(group, machines);
    let unsent = 0;
    const result = await keySession.signed(prompt, () => {
      for (const { machine, body } of bodies) {
        const to = machines.find((m) => m.id === machine);
        if (!to || !link.setGroup(to, body)) unsent++;
      }
      return unsent < bodies.length ? "sent" : null;
    });
    if (result.status === "sent" && unsent > 0) inform(t("unsent.title"), t("unsent.body", { count: unsent }));
    return result.status === "sent";
  };
}

// The groups of the Workspace (ADR 0091), laid out as the Member list; an Owner names a new one at the bottom.
export function GroupsPage() {
  const t = useT("groups");
  const groups = useGroups();
  const machines = useMachines();
  const send = useSendGroup();
  const [name, setName] = useState("");
  const owner = ownsAny(machines ?? undefined);

  async function create() {
    const trimmed = name.trim();
    if (!trimmed) return;
    const id = `g_${Date.now().toString(36)}`;
    if (await send({ id, name: trimmed, version: 0, members: [], admins: [], grants: [] }, t("prompt.create", { name: trimmed }))) setName("");
  }

  return (
    <Screen title={t("title")}>
      {/* An Owner's empty list leaves room for the name below, as the Invite page's empty asks do. */}
      {groups && groups.length === 0 && !owner && <Empty icon="people" title={t("empty.title")} detail={t("empty.body")} />}
      {groups && (groups.length > 0 || owner) && (
        <Section footer={t("footer")}>
          {groups.length === 0 && <Row title={t("empty.title")} detail={t("empty.body")} />}
          {groups.map((group) => (
            <Row key={group.id} title={group.name} detail={t("count", { count: group.members.length })} href={`/groups/${group.id}`} />
          ))}
        </Section>
      )}
      {owner && (
        <>
          <Field label={t("new.label")} value={name} onChangeText={setName} placeholder={t("new.placeholder")} footer={t("new.footer")} />
          <Button label={t("new.action")} variant="primary" disabled={!name.trim()} onPress={() => void create()} />
        </>
      )}
    </Screen>
  );
}

// One group: who is in it, what it grants at each Agent, and who looks after it.
export function GroupPage() {
  const t = useT("groups");
  const { group: id } = useLocalSearchParams<{ group: string }>();
  const group = useGroups()?.find((g) => g.id === id);
  const members = useMembers()?.filter((member) => member.removed_at === null) ?? [];
  const machines = useMachines() ?? [];
  const agents = useAgents() ?? [];
  const send = useSendGroup();
  if (!group) return <Screen title={t("title")}>{null}</Screen>;
  const owner = ownsAny(machines);
  const me = new Set(machines.map((m) => m.member_id));
  const admin = owner || group.admins.some((m) => me.has(m));
  const levelOf = (agent: string): Choice => group.grants.find((grant) => grant.agent === agent)?.level ?? "none";
  const nameOf = (member: string) => members.find((m) => m.id === member)?.name ?? member;

  const toggle = (list: string[], member: string, on: boolean) => (on ? [...list, member] : list.filter((m) => m !== member));
  const setMember = (member: string, on: boolean) => void send({ ...group, members: toggle(group.members, member, on) }, t(on ? "prompt.add" : "prompt.takeOut", { name: nameOf(member), group: group.name }));
  const setAdmin = (member: string, on: boolean) => void send({ ...group, admins: toggle(group.admins, member, on) }, t("prompt.admins", { group: group.name }));
  const setLevel = (agent: string, machine: string, level: Choice) => {
    const grants = group.grants.filter((grant) => grant.agent !== agent);
    void send({ ...group, grants: level === "none" ? grants : [...grants, { machine, agent, level }] }, t("prompt.grant", { group: group.name, level: t(`level.${level}`) }));
  };

  return (
    <Screen title={group.name} subtitle={t("count", { count: group.members.length })}>
      <Section title="Member" footer={admin ? t("members.footer") : undefined}>
        {members.length === 0 && <Row title={t("members.empty")} />}
        {members.map((member) =>
          admin ? (
            <ToggleRow key={member.id} title={member.name} value={group.members.includes(member.id)} onChange={(on) => setMember(member.id, on)} />
          ) : group.members.includes(member.id) ? (
            <Row key={member.id} title={member.name} />
          ) : null,
        )}
      </Section>
      <Section title="Agent" footer={t("grants.footer")}>
        {agents.map((agent) => (
          <Select
            key={agent.id}
            label={agent.name}
            leading={<Character look={lookOfJson(agent.character)} mood={moodOf([], null)} size={32} still />}
            value={levelOf(agent.id)}
            cancel={t("cancel")}
            disabled={agent.level !== "manage"}
            options={(["none", "use", "approve", "manage"] as const).map((level) => ({ value: level, label: t(`level.${level}`) }))}
            onChange={(level) => setLevel(agent.id, agent.machine_id, level)}
          />
        ))}
      </Section>
      {owner && members.length > 0 && (
        <Section title={t("admins.heading")} footer={t("admins.footer")}>
          {members.map((member) => (
            <ToggleRow key={member.id} title={member.name} value={group.admins.includes(member.id)} onChange={(on) => setAdmin(member.id, on)} />
          ))}
        </Section>
      )}
      {!admin && <Button label={t("back")} onPress={() => router.back()} />}
    </Screen>
  );
}
