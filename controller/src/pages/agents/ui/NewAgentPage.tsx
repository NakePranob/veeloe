import { randomUUID } from "expo-crypto";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator } from "react-native";
import { useAgents } from "../../../entities/agent";
import { useMachines } from "../../../entities/machine";
import { useMachineLink, useMachineStatuses } from "../../../features/machine-link";
import { describeError, useT } from "../../../shared/i18n";
import { Field, Icon, Note, Row, Screen, Section, useColors } from "../../../shared/ui";

// ponytail: a gateway can list hundreds of models, so only the first matches show; add paging if people miss theirs.
const SHOWN = 30;

type Model = { id: string; name?: string };
// The schemas are loose (ADR 0023), so `in` alone does not narrow them.
const modelsOf = (p: unknown): Model[] => (Array.isArray((p as { models?: unknown } | undefined)?.models) ? (p as { models: Model[] }).models : []);
const errorOf = (p: unknown): string | null => {
  const error = (p as { error?: unknown } | undefined)?.error;
  return typeof error === "string" ? error : null;
};

// controller-prototype's NewAgentPage, with what this version sends: a name, a Machine, a Provider and a model.
// ponytail: no Character, description, instructions or Allowlist yet; each comes with the change that uses it.
// The prototype picks Provider and model from a menu (@expo/ui); this app has no @expo/ui yet, so they are ticked rows like the language.
export function NewAgentPage() {
  const t = useT("agents");
  const colors = useColors();
  const machines = useMachines() ?? [];
  const statuses = useMachineStatuses();
  const link = useMachineLink();
  const agents = useAgents();
  const [name, setName] = useState("");
  const [machineId, setMachineId] = useState<string | null>(null);
  const [provider, setProvider] = useState<string | null>(null);
  const [model, setModel] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [creating, setCreating] = useState<string | null>(null);

  const ready_machine = machines.find((m) => statuses[m.id]?.online && statuses[m.id]?.providers?.length) ?? machines[0];
  const machine = machines.find((m) => m.id === machineId) ?? ready_machine;
  const status = machine ? statuses[machine.id] : undefined;
  const providers = status?.providers ?? [];
  const chosen = providers.find((p) => p.name === (provider ?? providers[0]?.name));
  const models = modelsOf(chosen);
  const query = filter.trim().toLowerCase();
  const matching = models.filter((m) => !query || m.id.toLowerCase().includes(query) || m.name?.toLowerCase().includes(query)).slice(0, SHOWN);
  const ready = !!machine && !!name.trim() && !!chosen && !!model && models.some((m) => m.id === model) && !creating && !!link;

  // Done when the Machine lists the new Agent; its first Task opens in place of this page, as in the prototype.
  useEffect(() => {
    if (creating && agents?.some((a) => a.id === creating)) router.replace({ pathname: "/tasks/[task]", params: { task: randomUUID(), agent: creating } });
  }, [creating, agents]);
  useEffect(() => {
    if (status?.createError) setCreating(null);
  }, [status?.createError]);

  function create() {
    if (!ready || !link || !machine || !chosen || !model) return;
    setCreating(link.createAgent(machine, { name: name.trim(), provider: chosen.name, model }));
  }

  const tick = <Icon name="check" size="md" color="label" weight="semibold" />;
  return (
    <Screen title={t("new")} right={{ label: t("createShort"), onPress: create, disabled: !ready }}>
      <Section>
        <Field label={t("name")} value={name} onChangeText={setName} placeholder={t("namePlaceholder")} />
      </Section>

      <Section title={t("machine.heading")} footer={t("machine.footer")}>
        {machines.map((m) => (
          <Row
            key={m.id}
            icon="machine"
            iconColor={statuses[m.id]?.online ? "green" : "tertiaryLabel"}
            title={m.name}
            value={statuses[m.id]?.online === false ? t("offline") : undefined}
            onPress={() => {
              setMachineId(m.id);
              setProvider(null);
              setModel(null);
            }}
            accessory={m.id === machine?.id ? tick : undefined}
          />
        ))}
      </Section>

      <Section title={t("provider.heading")} footer={t("provider.footer")}>
        {status?.online === false ? (
          <Row icon="machine" title={t("machine.offline")} />
        ) : !status?.providers ? (
          <Row title={t("asking")} accessory={<ActivityIndicator color={colors.secondaryLabel} />} />
        ) : providers.length === 0 ? (
          <Row icon="key" title={t("provider.none")} detail={t("provider.command")} />
        ) : (
          providers.map((p) => (
            <Row
              key={p.name}
              icon="key"
              title={p.name}
              detail={errorOf(p) ? describeError({ code: errorOf(p)! }) : undefined}
              onPress={() => {
                setProvider(p.name);
                setModel(null);
              }}
              accessory={p.name === chosen?.name ? tick : undefined}
            />
          ))
        )}
      </Section>

      {models.length > 0 && (
        <Section title="model">
          {models.length > 8 && <Field label={t("modelFilter")} value={filter} onChangeText={setFilter} mono />}
          {matching.map((m) => (
            <Row key={m.id} title={m.name ?? m.id} detail={m.name ? m.id : undefined} onPress={() => setModel(m.id)} accessory={m.id === model ? tick : undefined} />
          ))}
          {matching.length === 0 && <Row title={t("noMatch")} />}
        </Section>
      )}

      {creating && <Row title={t("creating")} accessory={<ActivityIndicator color={colors.secondaryLabel} />} />}
      {status?.createError && (
        <Note icon="warning" iconColor="orange">
          {describeError({ code: status.createError })}
        </Note>
      )}
    </Screen>
  );
}
