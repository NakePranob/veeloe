import { READ_ONLY_ALLOWLIST } from "@veeloe/protocol";
import { randomUUID } from "expo-crypto";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, View } from "react-native";
import { useAgents } from "../../../entities/agent";
import { Character, lookOfJson, shuffleLook } from "../../../entities/character";
import { useMachines } from "../../../entities/machine";
import { useMachineLink, useMachineStatuses } from "../../../features/machine-link";
import { describeError, useT } from "../../../shared/i18n";
import { Button, Field, Icon, Note, Row, Screen, Section, space, ToggleRow, useColors } from "../../../shared/ui";
import { modelsOf } from "../model/providers";
import { ProviderModelSections } from "./ProviderModelSections";

// controller-prototype's NewAgentPage, with what this version sends: a Character, a name, a Machine, a Provider and a model.
// ponytail: no description, instructions or Allowlist yet; each comes with the change that uses it.
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
  const [creating, setCreating] = useState<string | null>(null);
  // The Machine keeps this look with the Agent (ADR 0006). Shuffling picks a new look, never a new id.
  const others = () => (agents ?? []).map((a) => lookOfJson(a.character));
  const [look, setLook] = useState(() => shuffleLook(others()));
  // Checked entries run without an Approval; the rest asks first (ADR 0030).
  const [allowlist, setAllowlist] = useState<string[]>([...READ_ONLY_ALLOWLIST]);

  const ready_machine = machines.find((m) => statuses[m.id]?.online && statuses[m.id]?.providers?.length) ?? machines[0];
  const machine = machines.find((m) => m.id === machineId) ?? ready_machine;
  const status = machine ? statuses[machine.id] : undefined;
  const providers = status?.providers ?? [];
  const chosen = providers.find((p) => p.name === (provider ?? providers[0]?.name));
  const ready = !!machine && !!name.trim() && !!chosen && !!model && modelsOf(chosen).some((m) => m.id === model) && !creating && !!link;

  // Done when the Machine lists the new Agent; its first Task opens in place of this page, as in the prototype.
  useEffect(() => {
    if (creating && agents?.some((a) => a.id === creating)) router.replace({ pathname: "/tasks/[task]", params: { task: randomUUID(), agent: creating } });
  }, [creating, agents]);
  useEffect(() => {
    if (status?.createError) setCreating(null);
  }, [status?.createError]);

  function create() {
    if (!ready || !link || !machine || !chosen || !model) return;
    setCreating(link.createAgent(machine, { name: name.trim(), provider: chosen.name, model, character: look, allowlist }));
  }

  function toggleAllowlist(entry: string, on: boolean) {
    setAllowlist((kept) => (on ? [...kept, entry] : kept.filter((keptEntry) => keptEntry !== entry)));
  }

  const tick = <Icon name="check" size="md" color="label" weight="semibold" />;
  return (
    <Screen title={t("new")} right={{ label: t("createShort"), onPress: create, disabled: !ready }}>
      <View style={{ alignItems: "center", gap: space.sm }}>
        <Character look={look} mood="idle" size={96} />
        <Button label={t("shuffle")} onPress={() => setLook(shuffleLook(others()))} />
      </View>
      <Section footer={t("characterLater")}>
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

      <ProviderModelSections
        // A new filter for each Machine, as its models are another list.
        key={machine?.id}
        status={status}
        provider={chosen?.name}
        model={model}
        footer={t("provider.footer")}
        onProvider={(name) => {
          setProvider(name);
          setModel(null);
        }}
        onModel={setModel}
      />

      <Section title={t("allowlist.heading")} footer={t("allowlist.footer")}>
        {READ_ONLY_ALLOWLIST.map((entry) => (
          <ToggleRow key={entry} title={entry} mono value={allowlist.includes(entry)} onChange={(on) => toggleAllowlist(entry, on)} />
        ))}
      </Section>

      <Note>{t("budget.default")}</Note>

      {creating && <Row title={t("creating")} accessory={<ActivityIndicator color={colors.secondaryLabel} />} />}
      {status?.createError && (
        <Note icon="warning" iconColor="orange">
          {describeError({ code: status.createError })}
        </Note>
      )}
    </Screen>
  );
}
