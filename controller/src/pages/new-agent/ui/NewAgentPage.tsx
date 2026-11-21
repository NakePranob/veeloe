import { READ_ONLY_ALLOWLIST } from "@veeloe/protocol-ts";
import { randomUUID } from "expo-crypto";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import { View } from "react-native";
import { useAgents } from "../../../entities/agent";
import { Character, lookOfJson, shuffleLook, Stage } from "../../../entities/character";
import { useMachines } from "../../../entities/machine";
import { useMachineLink, useMachineStatuses } from "../../../features/machine-link";
import { describeError, useT } from "../../../shared/i18n";
import { Button, Field, Icon, Note, Row, Screen, Section, Select, Spinner, ToggleRow } from "../../../shared/ui";
import { modelsOf, ProviderModelSections } from "../../../widgets/provider-models";

// The NewAgent board: the head on a stage of its colour under the header, its name, then where it
// works and with what model, and the commands it runs without asking.
// ponytail: no Budget row; the create body has no budget, so it starts at the Machine's default (ADR 0043) and is set on the Agent's page.
export function NewAgentPage() {
  const t = useT("new-agent");
  const machines = useMachines() ?? [];
  const statuses = useMachineStatuses();
  const link = useMachineLink();
  const agents = useAgents();
  const [name, setName] = useState("");
  const [machineId, setMachineId] = useState<string | null>(null);
  const [provider, setProvider] = useState<string | null>(null);
  const [model, setModel] = useState<string | null>(null);
  const [creating, setCreating] = useState<string | null>(null);
  const [modelOpen, setModelOpen] = useState(false);
  const [allowlistOpen, setAllowlistOpen] = useState(false);
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

  // The Provider is picked for us (the first one), so its first model is too:
  // a form that shows a Provider and a model list but leaves Create disabled
  // with no chosen model reads as broken.
  useEffect(() => {
    if (!chosen) return;
    const models = modelsOf(chosen);
    if (!models.some((m) => m.id === model)) setModel(models[0]?.id ?? null);
  }, [chosen, model]);

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

  const expand = (open: boolean) => <Icon name={open ? "collapse" : "expand"} size="sm" color="tertiaryLabel" />;
  return (
    <Screen title={t("new")} bottom={<Button label={t("create")} variant="primary" size="large" onPress={create} disabled={!ready} />}>
      <Stage color={look.color} bleed>
        <Character look={look} mood="idle" size={104} />
        <Button label={t("shuffle")} leading="shuffle" variant="surface" onPress={() => setLook(shuffleLook(others()))} />
        <View style={{ alignSelf: "stretch" }}>
          <Field label={t("name")} value={name} onChangeText={setName} placeholder={t("namePlaceholder")} />
        </View>
      </Stage>

      <Section title={t("where.heading")} footer={t("where.footer")}>
        {machine && (
          <Select cancel={t("pickCancel")}
            label={t("machine.label")}
            value={machine.id}
            options={machines.map((m) => ({
              value: m.id,
              // ponytail: Select has no detail line, so the state rides in the value; the board's OS line has no data.
              label: statuses[m.id]?.online === false ? t("machine.offline", { name: m.name }) : statuses[m.id]?.online ? t("machine.online", { name: m.name }) : m.name }))}
            onChange={(id) => {
              setMachineId(id);
              setProvider(null);
              setModel(null);
            }}
          />
        )}
        <Row title={t("provider.label")} value={model ?? undefined} onPress={() => setModelOpen((was) => !was)} accessory={expand(modelOpen)} />
      </Section>

      {/* The Provider and model lists open under the card; with nothing chosen yet they show why. */}
      {(modelOpen || !chosen) && (
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
          onModel={(id) => {
            setModel(id);
            setModelOpen(false);
          }}
        />
      )}

      {/* The board's one row opens the Allowlist page; a new Agent has no page yet, so the entries open here. */}
      <Section title={t("allowlist.heading")} footer={t("allowlist.footer")}>
        <Row title={t("allowlist.row", { count: allowlist.length })} detail={allowlist.join(" · ") || undefined} onPress={() => setAllowlistOpen((was) => !was)} accessory={expand(allowlistOpen)} />
        {allowlistOpen && READ_ONLY_ALLOWLIST.map((entry) => <ToggleRow key={entry} title={entry} mono value={allowlist.includes(entry)} onChange={(on) => toggleAllowlist(entry, on)} />)}
      </Section>

      {creating && <Row title={t("creating")} accessory={<Spinner />} />}
      {status?.createError && (
        <Note icon="warning" iconColor="orange">
          {describeError({ code: status.createError })}
        </Note>
      )}
    </Screen>
  );
}
