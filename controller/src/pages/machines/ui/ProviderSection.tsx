import { useState } from "react";
import { View } from "react-native";
import type { AgentRow } from "../../../entities/agent";
import type { Machine } from "../../../entities/machine";
import { useMachineLink, useMachineStatus } from "../../../features/machine-link";
import { describeError, useT } from "../../../shared/i18n";
import { keySession } from "../../../shared/keystore";
import { Button, Card, Dot, Field, Icon, inform, Row, Section, Select, Text } from "../../../shared/ui";
import { AddRow } from "./AgentList";
import { PROVIDER_PRESETS } from "../model/providers";

const CUSTOM = "custom";

// The Machine board's Provider tab: the Machine's Providers, and adding one with its key sealed
// to this Machine (ADR 0042). The preset is one picker row; a custom one asks for its name and URL.
// ponytail: the board's "change key" waits for a Runtime command that replaces a Provider's key.
export function ProviderSection({ machine, agents }: { machine: Machine; agents: AgentRow[] }) {
  const t = useT("machines");
  const link = useMachineLink();
  const status = useMachineStatus(machine.id);
  const [adding, setAdding] = useState(false);
  const [preset, setPreset] = useState<string>(PROVIDER_PRESETS[0].id);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [key, setKey] = useState("");
  const chosen = PROVIDER_PRESETS.find((entry) => entry.id === preset);
  // Set before the unlock, so a second tap cannot seal and send the key twice.
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!link || busy) return;
    if (!key.trim() || (!chosen && (!name.trim() || !url.trim()))) return;
    let sig: string | null = null;
    setBusy(true);
    let authenticated = false;
    try {
      authenticated = await keySession.withFreshAuthentication(t("provider.prompt", { machine: machine.name }), async () => {
        sig = await link.addProvider(machine, { name: chosen?.id ?? name.trim(), url: chosen?.url ?? url.trim(), ...(chosen ? { preset: chosen.id } : {}), key });
      });
    } finally {
      setBusy(false);
    }
    // A cancelled unlock sent nothing and needs no alert; only a send that failed after it does.
    if (!authenticated) return;
    if (!sig) return inform(t("provider.failed"), t("provider.failedBody"));
    close();
  }

  function close() {
    setAdding(false);
    setKey("");
    setName("");
    setUrl("");
    setPreset(PROVIDER_PRESETS[0].id);
  }

  return (
    <Section footer={t("provider.footer")}>
      {status.providers?.length === 0 && <Row icon="key" title={t("provider.none")} detail={t("provider.command")} mono />}
      {status.providers?.map((provider) => {
        const models = (provider as { models?: unknown[] }).models;
        const error = (provider as { error?: string }).error;
        const users = agents.filter((agent) => agent.provider === provider.name).map((agent) => agent.name);
        const detail = error
          ? describeError({ code: error })
          : [models ? t("provider.models", { count: models.length }) : null, users.length ? t("provider.usedBy", { agents: users.join(", ") }) : null].filter(Boolean).join(" · ") || undefined;
        return (
          <View key={provider.name} style={{ flexDirection: "row", alignItems: "center", gap: 12, minHeight: 52, paddingHorizontal: 14, paddingVertical: 10 }}>
            <Icon name="key" size="md" color={error ? "orange" : "label"} />
            <View style={{ flex: 1, gap: 2 }}>
              <Text variant="subheadline" strong selectable>
                {provider.name}
              </Text>
              {detail && (
                <Text variant="caption" tone={error ? "danger" : "secondary"}>
                  {detail}
                </Text>
              )}
            </View>
            {!error && (
              // Green words fail contrast on grey, so the dot carries the colour and the words stay ink.
              <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
                <Dot color="green" size={7} />
                <Text variant="caption" strong>
                  {t("provider.ok")}
                </Text>
              </View>
            )}
          </View>
        );
      })}
      {adding ? (
        <View style={{ paddingHorizontal: 8, paddingTop: 4, paddingBottom: 8 }}>
          <Card tone="surface" style={{ paddingTop: 12, paddingHorizontal: 8, paddingBottom: 8, gap: 10, borderRadius: 18 }}>
            <Text variant="subheadline" strong style={{ fontSize: 14, paddingHorizontal: 6 }}>
              {t("provider.add")}
            </Text>
            <Select
              cancel={t("pickCancel")}
              label="Provider"
              value={preset}
              onChange={setPreset}
              options={[...PROVIDER_PRESETS.map((entry) => ({ value: entry.id as string, label: entry.name })), { value: CUSTOM, label: t("provider.custom") }]}
            />
            {!chosen && (
              <>
                <Field label={t("provider.name")} value={name} onChangeText={setName} placeholder="main" mono />
                <Field label={t("provider.url")} value={url} onChangeText={setUrl} placeholder="https://api.example.com" mono />
              </>
            )}
            <Field label={t("provider.key")} value={key} onChangeText={setKey} secure mono />
            <View style={{ flexDirection: "row", gap: 8 }}>
              <View style={{ flex: 1 }}>
                <Button label={t("provider.cancel")} onPress={close} />
              </View>
              <View style={{ flex: 1 }}>
                <Button label={t("provider.save")} variant="primary" disabled={busy || !key.trim() || (!chosen && (!name.trim() || !url.trim()))} onPress={() => void save()} />
              </View>
            </View>
          </Card>
        </View>
      ) : (
        <AddRow label={t("provider.add")} onPress={() => setAdding(true)} />
      )}
      {status.providerError && <Row icon="warning" iconColor="orange" title={t("provider.failed")} detail={describeError({ code: status.providerError })} />}
    </Section>
  );
}
