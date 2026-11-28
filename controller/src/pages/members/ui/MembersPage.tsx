import { router, useLocalSearchParams } from "expo-router";
import { useEffect } from "react";
import { useAgents } from "../../../entities/agent";
import { useGrants, useGroups, useMembers } from "../../../entities/device";
import { ownersOf, ownsAny, useMachines } from "../../../entities/machine";
import { AgentLevelSelect } from "../../../widgets/agent-level";
import { useMachineLink, useMachineStatuses } from "../../../features/machine-link";
import { describeError, useLanguage, useT } from "../../../shared/i18n";
import { useLiveQuery } from "../../../shared/db";
import { keySession } from "../../../shared/keystore";
import { when } from "../../../shared/lib";
import { confirm, inform, Row, Screen, Section } from "../../../shared/ui";
import { fromGroups } from "../model/access";
import { removeMember } from "../model/remove";

type Choice = "none" | "use" | "approve" | "manage";

/** An Invitation still taking people, as this device keeps it (the invite page's table). */
type OpenLink = { id: string; group_id: string | null; title: string | null; max_members: number; joined: string; expires_at: number; grants: string };
// ponytail: read straight from the invite page's table; give Invitations an entity when a third screen needs them.
const OPEN_LINKS = "SELECT id, group_id, title, max_members, joined, expires_at, grants FROM invitation WHERE closed_at IS NULL ORDER BY created_at DESC";
const LINK_TOPICS = ["invitation"];

// Everyone in the Workspace on one page (ADR 0093): the Owners, the people let in, then the groups and the links
// still taking people. Laid out as the device list: one row each, a tap opens them. Inviting is the header's.
export function MembersPage() {
  const t = useT("members");
  const language = useLanguage();
  const members = useMembers();
  const machines = useMachines();
  const groups = useGroups();
  const links = useLiveQuery<OpenLink>(OPEN_LINKS, [], LINK_TOPICS);
  if (!members || !machines || !groups) return <Screen title={t("title")}>{null}</Screen>;
  const me = new Set(machines.map((m) => m.member_id));
  const owner = ownsAny(machines);
  const canInvite = owner || groups.some((group) => group.admins.some((m) => me.has(m)));
  const owners = ownersOf(machines);
  const here = members.filter((member) => member.removed_at === null && !owners.includes(member.id));
  const open = (links ?? []).filter((link) => link.expires_at * 1000 > Date.now() && (JSON.parse(link.joined) as unknown[]).length < link.max_members);
  const groupName = (id: string | null) => groups.find((g) => g.id === id)?.name;
  const named = (name: string, title: string | null) => (title ? t("named", { name, title }) : name);

  return (
    <Screen title={t("title")} subtitle={t("subtitle", { count: owners.length + here.length })} right={canInvite ? { label: t("invite"), icon: "add", variant: "chip", onPress: () => router.push("/invite") } : undefined}>
      <Section footer={t("footer")}>
        {/* Owners came by Pairing and have no name a Machine knows: they read as Owner, and you as you. */}
        {owners.map((id) => (
          <Row key={id} title={me.has(id) ? t("you") : t("owner")} value={me.has(id) ? t("ownerRole") : undefined} />
        ))}
        {here.map((member) => (
          <Row
            key={member.id}
            title={me.has(member.id) ? t("youNamed", { name: named(member.name, member.title) }) : named(member.name, member.title)}
            detail={t("joined", { when: when(member.added_at, language) })}
            href={me.has(member.id) ? undefined : `/members/${member.id}`}
          />
        ))}
      </Section>
      <Section title={t("groups.heading")} footer={owner ? t("groups.footer") : undefined}>
        {groups.map((group) => (
          <Row key={group.id} icon="people" title={group.name} value={t("subtitle", { count: group.members.length })} href={`/groups/${group.id}`} />
        ))}
        {owner ? <Row icon="add" title={t("groups.new")} href="/groups" /> : groups.length === 0 && <Row title={t("groups.none")} />}
      </Section>
      {canInvite && open.length > 0 && (
        <Section title={t("links.heading")}>
          {open.map((link) => (
            <Row
              key={link.id}
              icon="share"
              title={groupName(link.group_id) ?? t("links.agents", { count: (JSON.parse(link.grants) as unknown[]).length })}
              detail={t("links.detail", { joined: (JSON.parse(link.joined) as unknown[]).length, count: link.max_members, when: when(link.expires_at * 1000, language) })}
              href={{ pathname: "/invite", params: { id: link.id } }}
            />
          ))}
        </Section>
      )}
    </Screen>
  );
}

// One Member: their level at each Agent this device's Member manages, and, for an Owner, taking them out.
export function MemberPage() {
  const t = useT("members");
  const { member: id } = useLocalSearchParams<{ member: string }>();
  const member = useMembers()?.find((m) => m.id === id);
  const machines = useMachines() ?? [];
  const agents = useAgents() ?? [];
  const grants = useGrants() ?? [];
  const groups = useGroups() ?? [];
  const statuses = useMachineStatuses();
  const link = useMachineLink();
  const managed = agents.filter((agent) => agent.level === "manage");
  const workspaceMachines = machines.filter((machine) => machine.workspace_id === member?.workspace_id);
  const owner = workspaceMachines.find((machine) => machine.owner !== 0);

  // What each Agent's Machine holds now; a Machine that is not connected keeps what was last heard.
  // Asked again once the Agents and Machines have loaded, not on every change of their rows.
  const asked = managed
    .filter((agent) => machines.some((m) => m.id === agent.machine_id))
    .map((agent) => agent.id)
    .join(" ");
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on the ids asked about, not the live-query rows
  useEffect(() => {
    if (!link) return;
    for (const agent of managed) {
      const machine = machines.find((m) => m.id === agent.machine_id);
      if (machine) link.listGrants(machine, agent.id);
    }
  }, [link, id, asked]);

  if (!member) return <Screen title="Member">{null}</Screen>;
  const name = member.name;
  const levelOf = (agent: string): Choice => grants.find((grant) => grant.agent_id === agent && grant.member_id === member.id)?.level ?? "none";

  async function change(agentId: string, machineId: string, level: Choice) {
    const machine = machines.find((m) => m.id === machineId);
    if (!link || !machine) return;
    const result = await keySession.signed(t("prompt.grant", { name, level: t(`level.${level}`) }), () => (link.setGrant(machine, { agent: agentId, member: member?.id ?? "", level }) ? "sent" : null));
    if (result.status === "sent") link.listGrants(machine, agentId);
  }

  async function remove() {
    if (!owner) return;
    if (!(await confirm({ title: t("remove.title", { name }), message: t("remove.body", { name }), action: t("remove.action"), cancel: t("cancel"), destructive: true }))) return;
    const answer = await removeMember((use) => keySession.withFreshAuthentication(t("prompt.remove", { name }), use), { hub: owner.hub_url, workspace: member?.workspace_id ?? "", member: member?.id ?? "" });
    if (answer === null) return;
    if (!answer.ok) return inform(t("remove.cannot"), describeError({ code: answer.code }));
    router.back();
  }

  return (
    <Screen title={name} subtitle={member.removed_at !== null ? t("removed") : (member.title ?? undefined)}>
      {member.removed_at === null && (
        <Section title="Agent" footer={managed.length > 0 ? t("grants.footer") : t("grants.none")}>
          {managed.map((agent) => {
            const given = fromGroups(groups, member.id, agent.id);
            return (
              <AgentLevelSelect
                key={agent.id}
                agent={agent}
                machine={machines.find((m) => m.id === agent.machine_id)?.name ?? ""}
                value={levelOf(agent.id)}
                // Their own Grant is what this row sets; a group may give more, and the Machine goes by the higher (ADR 0093).
                note={given ? t("fromGroup", { group: given.group, level: t(`level.${given.level}`) }) : undefined}
                cancel={t("cancel")}
                disabled={statuses[agent.machine_id]?.online === false}
                options={(["none", "use", "approve", "manage"] as const).map((level) => ({ value: level, label: t(`level.${level}`) }))}
                onChange={(level) => void change(agent.id, agent.machine_id, level)}
              />
            );
          })}
        </Section>
      )}
      {owner && member.removed_at === null && (
        <Section footer={t("remove.footer", { name })}>
          <Row icon="trash" title={t("remove.row", { name })} destructive onPress={() => void remove()} />
        </Section>
      )}
    </Screen>
  );
}
