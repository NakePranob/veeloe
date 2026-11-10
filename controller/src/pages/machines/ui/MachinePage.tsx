import { useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { useAgents } from "../../../entities/agent";
import { useMachines } from "../../../entities/machine";
import { useMachineLink, useMachineStatus } from "../../../features/machine-link";
import { describeError, useT } from "../../../shared/i18n";
import { keySession } from "../../../shared/keystore";
import { formatTokens } from "../../../shared/lib";
import { Button, Empty, Field, inform, Row, Screen, Section } from "../../../shared/ui";
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
  const [addingProvider, setAddingProvider] = useState(false);
  const [providerName, setProviderName] = useState("");
  const [providerUrl, setProviderUrl] = useState("");
  const [providerKey, setProviderKey] = useState("");
  useEffect(() => {
    if (machine) link?.requestStatus(machine);
  }, [machine?.id, link]);

  async function addProvider() {
    if (!link || !machine) return;
    if (!providerName.trim() || !providerUrl.trim() || !providerKey.trim()) return;
    let sig: string | null = null;
    await keySession.withFreshAuthentication(t("provider.prompt", { machine: machine.name }), async () => {
      sig = await link.addProvider(machine, { name: providerName.trim(), url: providerUrl.trim(), key: providerKey });
    });
    if (!sig) return inform(t("provider.failed"), t("provider.failedBody"));
    setProviderKey("");
    setAddingProvider(false);
  }
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
        {addingProvider ? (
          <>
            <Field label={t("provider.name")} value={providerName} onChangeText={setProviderName} placeholder="main" mono />
            <Field label={t("provider.url")} value={providerUrl} onChangeText={setProviderUrl} placeholder="https://api.example.com" mono />
            <Field label={t("provider.key")} value={providerKey} onChangeText={setProviderKey} secure mono />
            <Row icon="add" title={t("provider.save")} onPress={() => void addProvider()} />
            <Row title={t("provider.cancel")} onPress={() => setAddingProvider(false)} />
          </>
        ) : (
          <Row icon="add" title={t("provider.add")} onPress={() => setAddingProvider(true)} />
        )}
        {status.providerError && <Row icon="warning" iconColor="orange" title={t("provider.failed")} detail={describeError({ code: status.providerError })} />}
      </Section>

      <EgressSection machine={machine} agentNames={agents.map((agent) => agent.name)} />
    </Screen>
  );
}
