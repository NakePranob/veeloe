import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { Keyboard, View } from "react-native";
import { useAgents, type AgentRow } from "../../../entities/agent";
import { useMachines } from "../../../entities/machine";
import { useMachineLink, useMachineStatus } from "../../../features/machine-link";
import { describeError, useT } from "../../../shared/i18n";
import { Empty, Note, Row, Screen, Spinner } from "../../../shared/ui";
import { modelsOf, ProviderModelSections } from "../../../widgets/provider-models";

// The AgentModel board: the Provider and model picker New Agent also uses, saved with the header button.
function Picker({ agent }: { agent: AgentRow }) {
  const t = useT("agent-model");
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
    <Screen title={t("provider.heading")} subtitle={machine ? t("subtitle", { agent: agent.name, machine: machine.name }) : agent.name} right={{ label: t("save"), onPress: save, disabled: !changed || !listed || offline || !!sent }}>
      {/* The board spaces its blocks 14 apart, closer than the Screen's sections. */}
      <View style={{ gap: 14 }}>
        {offline && (
          <Note icon="offline" iconColor="orange">
            {t("needsOnline")}
          </Note>
        )}
        <ProviderModelSections
          status={status}
          provider={provider}
          model={model}
          onProvider={(name) => {
            setProvider(name);
            setModel(name === agent.provider ? agent.model : null);
          }}
          onModel={setModel}
        />
        {sent && <Row title={t("saving")} accessory={<Spinner />} />}
        {tried && status.updateError && !sent && <Note tone="warning">{describeError({ code: status.updateError })}</Note>}
        {/* The board ends on this, as a plain paragraph under the model list. */}
        <Note tone="plain">{t("provider.nextTask")}</Note>
      </View>
    </Screen>
  );
}

export function AgentModelPage() {
  const t = useT("agent-model");
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
