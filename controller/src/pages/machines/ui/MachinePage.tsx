import { useLocalSearchParams } from "expo-router";
import { useEffect } from "react";
import { useAgents } from "../../../entities/agent";
import { useMachines } from "../../../entities/machine";
import { useMachineLink, useMachineStatus } from "../../../features/machine-link";
import { describeError, useT } from "../../../shared/i18n";
import { formatTokens } from "../../../shared/lib";
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
  const link = useMachineLink();
  useEffect(() => {
    if (machine) link?.requestStatus(machine);
  }, [machine?.id, link]);
  const disk = status.diskFreeBytes === null ? undefined : `${(status.diskFreeBytes / 1_000_000_000).toFixed(1)} GB`;
  const budget = status.budgetToday && (status.budgetToday.usedTokens > 0 || status.budgetToday.limitTokens > 0) ? `${formatTokens(status.budgetToday.usedTokens)} / ${formatTokens(status.budgetToday.limitTokens)}` : undefined;

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
        {status.version && <Row icon="info" title={t("status.version")} value={status.version} />}
        {status.features && <Row icon="info" title={t("status.features")} detail={status.features.join(", ")} />}
        {disk && <Row icon="usage" title={t("status.disk")} value={disk} />}
        {budget && <Row icon="usage" title={t("status.budget")} value={budget} />}
        {status.lastError && <Row icon="warning" iconColor="orange" title={t("status.lastError")} value={status.lastError} />}
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
