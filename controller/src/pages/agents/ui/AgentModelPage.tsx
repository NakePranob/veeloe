import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, Keyboard } from "react-native";
import { useAgents, type AgentRow } from "../../../entities/agent";
import { useMachines } from "../../../entities/machine";
import { useMachineLink, useMachineStatus } from "../../../features/machine-link";
import { describeError, useT } from "../../../shared/i18n";
import { Empty, Note, Row, Screen, useColors } from "../../../shared/ui";
import { modelsOf } from "../model/providers";
import { ProviderModelSections } from "./ProviderModelSections";

// The Provider and model sections of New Agent, saved with the header button as New Agent creates with
// it. Stands in for the prototype's two menus on the Agent page (agent-settings design).
function Picker({ agent }: { agent: AgentRow }) {
  const t = useT("agents");
  const colors = useColors();
  const link = useMachineLink();
  const machine = useMachines()?.find((m) => m.id === agent.machine_id);
  const status = useMachineStatus(agent.machine_id);
  const [provider, setProvider] = useState(agent.provider);
  const [model, setModel] = useState<string | null>(agent.model);
  const [sent, setSent] = useState<{ provider: string; model: string } | null>(null);
  const [tried, setTried] = useState(false);
  const [notSent, setNotSent] = useState(false);
  const offline = status.online === false || !link || notSent;
  const listed = modelsOf(status.providers?.find((p) => p.name === provider)).some((m) => m.id === model);
  const changed = provider !== agent.provider || model !== agent.model;

  // Back to the Agent once the Machine lists the new values (ADR 0006), and stays on an error.
  useEffect(() => {
    if (sent && agent.provider === sent.provider && agent.model === sent.model) router.back();
  }, [sent, agent.provider, agent.model]);
  useEffect(() => {
    if (status.updateError) setSent(null);
  }, [status.updateError]);

  function save() {
    if (!link || !machine || !model) return;
    Keyboard.dismiss();
    // A model belongs to its Provider, so a new Provider goes with its model; a model alone is checked against the current one.
    const body = provider !== agent.provider ? { id: agent.id, provider, model } : { id: agent.id, model };
    setTried(true);
    if (!link.updateAgent(machine, body)) return setNotSent(true);
    setSent({ provider, model });
  }

  return (
    <Screen title={t("provider.heading")} right={{ label: t("save"), onPress: save, disabled: !changed || !listed || offline || !!sent }}>
      {offline && (
        <Note icon="offline" iconColor="orange">
          {t("needsOnline")}
        </Note>
      )}
      <ProviderModelSections
        status={status}
        provider={provider}
        model={model}
        footer={t("provider.nextTask")}
        onProvider={(name) => {
          setProvider(name);
          setModel(name === agent.provider ? agent.model : null);
        }}
        onModel={setModel}
      />
      {sent && <Row title={t("saving")} accessory={<ActivityIndicator color={colors.secondaryLabel} />} />}
      {tried && status.updateError && !sent && (
        <Note icon="warning" iconColor="orange">
          {describeError({ code: status.updateError })}
        </Note>
      )}
    </Screen>
  );
}

export function AgentModelPage() {
  const t = useT("agents");
  const { agent: id } = useLocalSearchParams<{ agent: string }>();
  const agent = useAgents()?.find((a) => a.id === id);
  if (!agent) {
    return (
      <Screen title={t("provider.heading")}>
        <Empty icon="agent" title={t("missing.title")} detail={t("missing.body")} />
      </Screen>
    );
  }
  return <Picker key={agent.id} agent={agent} />;
}
