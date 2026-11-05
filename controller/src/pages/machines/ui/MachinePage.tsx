import { useLocalSearchParams } from "expo-router";
import { useAgents } from "../../../entities/agent";
import { useMachines } from "../../../entities/machine";
import { useMachineStatus } from "../../../features/machine-link";
import { describeError, useT } from "../../../shared/i18n";
import { Empty, Row, Screen, Section } from "../../../shared/ui";
import { EgressSection } from "./EgressSection";

// controller-prototype's MachinePage, with what this version has: status, its Agents, its Providers and its Egress.
// ponytail: logs, updates, release and unpair from the app come with their own changes.
export function MachinePage() {
  const t = useT("machines");
  const { machine: id } = useLocalSearchParams<{ machine: string }>();
  const machine = useMachines()?.find((m) => m.id === id);
  const agents = (useAgents() ?? []).filter((a) => a.machine_id === id);
  const status = useMachineStatus(id);

  if (!machine) {
    return (
      <Screen title="Machine">
        <Empty icon="machine" title={t("missing.title")} detail={t("missing.body")} />
      </Screen>
    );
  }

  return (
    <Screen title={machine.name}>
      <Section title={t("status.heading")}>
        <Row icon="machine" iconColor={status.online ? "green" : "tertiaryLabel"} title={t("status.heading")} value={status.online === null ? t("status.checking") : t(status.online ? "online" : "offline")} />
        <Row icon="info" title="Hub" value={machine.hub_url} />
      </Section>

      <Section title={t("onMachine")}>
        {agents.length === 0 && <Row title={t("noAgent")} />}
        {agents.map((agent) => (
          <Row key={agent.id} icon="agent" title={agent.name} detail={agent.model} href={`/agents/${agent.id}`} />
        ))}
      </Section>

      <Section title="Provider" footer={t("provider.footer")}>
        {status.providers?.length === 0 && <Row icon="key" title={t("provider.none")} detail={t("provider.command")} />}
        {status.providers?.map((provider) => {
          const models = (provider as { models?: unknown[] }).models;
          const error = (provider as { error?: string }).error;
          return <Row key={provider.name} icon="key" title={provider.name} value={models ? t("provider.models", { count: models.length }) : undefined} detail={error ? describeError({ code: error }) : undefined} />;
        })}
      </Section>

      <EgressSection machine={machine} agentNames={agents.map((agent) => agent.name)} />
    </Screen>
  );
}
