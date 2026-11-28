import { router, useLocalSearchParams } from "expo-router";
import { useEffect } from "react";
import { useAgents } from "../../../entities/agent";
import { useGrants, useMembers } from "../../../entities/device";
import { ownsAny, useMachines } from "../../../entities/machine";
import { AgentLevelSelect } from "../../../widgets/agent-level";
import { useMachineLink, useMachineStatuses } from "../../../features/machine-link";
import { describeError, useLanguage, useT } from "../../../shared/i18n";
import { keySession } from "../../../shared/keystore";
import { when } from "../../../shared/lib";
import { Button, confirm, Empty, inform, Row, Screen, Section } from "../../../shared/ui";
import { removeMember } from "../model/remove";

type Choice = "none" | "use" | "approve" | "manage";

// Who else is in the Workspace (ADR 0059), laid out as the device list: one row each, a tap opens them.
export function MembersPage() {
  const t = useT("members");
  const language = useLanguage();
  const members = useMembers();
  const machines = useMachines();
  const here = members?.filter((member) => member.removed_at === null);
  return (
    <Screen title="Member" subtitle={here?.length ? t("subtitle", { count: here.length }) : undefined}>
      {here && here.length === 0 && (
        <Empty icon="share" title={t("empty.title")} detail={t("empty.body")} action={ownsAny(machines ?? undefined) ? <Button label={t("invite")} variant="primary" onPress={() => router.push("/invite")} /> : undefined} />
      )}
      {here && here.length > 0 && (
        <Section footer={t("footer")}>
          {here.map((member) => (
            <Row key={member.id} title={member.title ? t("named", { name: member.name, title: member.title }) : member.name} detail={t("joined", { when: when(member.added_at, language) })} href={`/members/${member.id}`} />
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
          {managed.map((agent) => (
            <AgentLevelSelect
              key={agent.id}
              agent={agent}
              machine={machines.find((m) => m.id === agent.machine_id)?.name ?? ""}
              value={levelOf(agent.id)}
              cancel={t("cancel")}
              disabled={statuses[agent.machine_id]?.online === false}
              options={(["none", "use", "approve", "manage"] as const).map((level) => ({ value: level, label: t(`level.${level}`) }))}
              onChange={(level) => void change(agent.id, agent.machine_id, level)}
            />
          ))}
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
