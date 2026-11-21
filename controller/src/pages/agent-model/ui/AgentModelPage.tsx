import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { Keyboard, View } from "react-native";
import { useAgents, type AgentRow } from "../../../entities/agent";
import { useMachines } from "../../../entities/machine";
import { useAgentUpdate, useMachineStatus } from "../../../features/machine-link";
import { describeError, useT } from "../../../shared/i18n";
import { Empty, Note, Row, Screen, space, Spinner } from "../../../shared/ui";
import { modelsOf, ProviderModelSections } from "../../../widgets/provider-models";

// The AgentModel board: the Provider and model picker New Agent also uses, saved with the header button.
function Picker({ agent }: { agent: AgentRow }) {
  const t = useT("agent-model");
  const machine = useMachines()?.find((m) => m.id === agent.machine_id);
  const status = useMachineStatus(agent.machine_id);
  const [provider, setProvider] = useState(agent.provider);
  const [model, setModel] = useState<string | null>(agent.model);
  const save = useAgentUpdate(agent, {
    landed: (row, sent) => (sent.provider === undefined || row.provider === sent.provider) && row.model === sent.model,
    // Back to the Agent once the Machine lists the new values (ADR 0006), and stays on an error.
    onLanded: () => router.back(),
  });
  const offline = save.offline;
  const listed = modelsOf(status.providers?.find((p) => p.name === provider)).some((m) => m.id === model);
  const changed = provider !== agent.provider || model !== agent.model;

  function submit() {
    if (!model) return;
    Keyboard.dismiss();
    // A model belongs to its Provider, so a new Provider goes with its model; a model alone is checked against the current one.
    save.send(provider !== agent.provider ? { provider, model } : { model });
  }

  return (
    <Screen title={t("provider.heading")} subtitle={machine ? t("subtitle", { agent: agent.name, machine: machine.name }) : agent.name} right={{ label: t("save"), onPress: submit, disabled: !changed || !listed || offline || save.sending }}>
      {/* The board spaces its blocks 14 apart, closer than the Screen's sections. */}
      <View style={{ gap: space.inset }}>
        {offline && (
          <Note tone="offline">
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
        {save.sending && <Row title={t("saving")} accessory={<Spinner />} />}
        {save.error && <Note tone="warning">{describeError({ code: save.error })}</Note>}
        {/* The board ends on this, as a plain paragraph under the model list. */}
        <Note tone="plain">{t("provider.nextTask")}</Note>
      </View>
    </Screen>
  );
}

export function AgentModelPage() {
  const t = useT("agent-model");
  const { agent: id } = useLocalSearchParams<{ agent: string }>();
  const agents = useAgents();
  const agent = agents?.find((a) => a.id === id);
  if (!agent) {
    return (
      <Screen title={t("provider.heading")}>
        {agents && <Empty icon="agent" title={t("missing.title")} detail={t("missing.body")} />}
      </Screen>
    );
  }
  return <Picker key={agent.id} agent={agent} />;
}
