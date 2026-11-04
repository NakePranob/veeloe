import { router, Stack, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, TextInput, View } from "react-native";
import { useAgents } from "../../../entities/agent";
import { useMachines } from "../../../entities/machine";
import { useMachineLink, useMachineStatus } from "../../../features/machine-link";
import { describeError, useT } from "../../../shared/i18n";
import { Button, Card, column, Icon, radius, space, Text, useColors } from "../../../shared/ui";

// ponytail: a gateway can list hundreds of models, so only the first matches show; add paging if people miss theirs.
const SHOWN = 30;

type Model = { id: string; name?: string };
// The schemas are loose (ADR 0023), so `in` alone does not narrow them.
const modelsOf = (p: unknown): Model[] => (Array.isArray((p as { models?: unknown } | undefined)?.models) ? (p as { models: Model[] }).models : []);
const errorOf = (p: unknown): string | null => {
  const error = (p as { error?: unknown } | undefined)?.error;
  return typeof error === "string" ? error : null;
};

function Row({ label, detail, picked, onPress, first }: { label: string; detail?: string; picked: boolean; onPress: () => void; first: boolean }) {
  const colors = useColors();
  return (
    <Pressable
      role="radio"
      aria-checked={picked}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: 44,
        flexDirection: "row",
        alignItems: "center",
        gap: space.md,
        paddingHorizontal: space.lg,
        paddingVertical: space.sm,
        backgroundColor: pressed ? colors.chipPressed : "transparent",
        borderTopWidth: first ? 0 : 0.5,
        borderTopColor: colors.separator,
      })}
    >
      <View style={{ flex: 1 }}>
        <Text>{label}</Text>
        {detail && (
          <Text variant="caption" tone="secondary">
            {detail}
          </Text>
        )}
      </View>
      {picked && <Icon name="check" color="label" weight="semibold" />}
    </Pressable>
  );
}

export function AddAgentPage() {
  const t = useT("add-agent");
  const colors = useColors();
  const { machine: machineId } = useLocalSearchParams<{ machine: string }>();
  const machine = useMachines()?.find((m) => m.id === machineId);
  const status = useMachineStatus(machineId);
  const link = useMachineLink();
  const agents = useAgents();
  const [name, setName] = useState("");
  const [provider, setProvider] = useState<string | null>(null);
  const [model, setModel] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [creating, setCreating] = useState<string | null>(null);

  // Done when the Machine lists the new Agent; it goes back to the Agent under its Machine.
  useEffect(() => {
    if (creating && agents?.some((a) => a.id === creating)) router.back();
  }, [creating, agents]);
  useEffect(() => {
    if (status.createError) setCreating(null);
  }, [status.createError]);

  const providers = status.providers ?? [];
  const chosen = providers.find((p) => p.name === (provider ?? providers[0]?.name));
  const models = modelsOf(chosen);
  const query = filter.trim().toLowerCase();
  const matching = models.filter((m) => !query || m.id.toLowerCase().includes(query) || m.name?.toLowerCase().includes(query)).slice(0, SHOWN);
  const ready = !!machine && !!name.trim() && !!chosen && !!model && models.some((m) => m.id === model) && !creating;

  const field = { minHeight: 44, paddingHorizontal: space.lg, borderRadius: radius.card, borderCurve: "continuous", backgroundColor: colors.surface, color: colors.label, fontSize: 17 } as const;

  let content;
  if (status.online === false) content = <Text tone="secondary">{t("offline")}</Text>;
  else if (status.providers === null)
    content = (
      <View style={{ flexDirection: "row", gap: space.sm, alignItems: "center" }}>
        <ActivityIndicator color={colors.secondaryLabel} />
        <Text tone="secondary">{t("asking")}</Text>
      </View>
    );
  else if (providers.length === 0)
    content = (
      <View style={{ gap: space.sm }}>
        <Text variant="headline" role="heading">
          {t("noProvider.heading")}
        </Text>
        <Text variant="subheadline" tone="secondary">
          {t("noProvider.body")}
        </Text>
        <Text selectable mono>
          {t("noProvider.command")}
        </Text>
      </View>
    );
  else
    content = (
      <>
        <Text variant="footnote" tone="secondary" style={{ paddingHorizontal: space.lg }}>
          {t("name")}
        </Text>
        <TextInput aria-label={t("name")} placeholder={t("namePlaceholder")} placeholderTextColor={colors.tertiaryLabel} value={name} onChangeText={setName} maxLength={80} style={field} />
        <Text variant="footnote" tone="secondary" style={{ paddingHorizontal: space.lg, paddingTop: space.md }}>
          {t("provider")}
        </Text>
        <Card style={{ padding: 0, gap: 0, overflow: "hidden" }}>
          <View role="radiogroup" aria-label={t("provider")}>
            {providers.map((p, i) => (
              <Row
                key={p.name}
                first={i === 0}
                label={p.name}
                detail={errorOf(p) ? t("providerProblem") : undefined}
                picked={p.name === chosen?.name}
                onPress={() => {
                  setProvider(p.name);
                  setModel(null);
                }}
              />
            ))}
          </View>
        </Card>
        {errorOf(chosen) && (
          <Text variant="footnote" tone="secondary">
            {describeError({ code: errorOf(chosen)! })}
          </Text>
        )}
        {models.length > 0 && (
          <>
            <Text variant="footnote" tone="secondary" style={{ paddingHorizontal: space.lg, paddingTop: space.md }}>
              {t("model")}
            </Text>
            {models.length > 8 && (
              <TextInput aria-label={t("modelFilter")} placeholder={t("modelFilter")} placeholderTextColor={colors.tertiaryLabel} value={filter} onChangeText={setFilter} autoCapitalize="none" autoCorrect={false} style={field} />
            )}
            <Card style={{ padding: 0, gap: 0, overflow: "hidden" }}>
              <View role="radiogroup" aria-label={t("model")}>
                {matching.map((m, i) => (
                  <Row key={m.id} first={i === 0} label={m.name ?? m.id} detail={m.name ? m.id : undefined} picked={m.id === model} onPress={() => setModel(m.id)} />
                ))}
                {matching.length === 0 && (
                  <Text tone="secondary" style={{ padding: space.lg }}>
                    {t("noMatch")}
                  </Text>
                )}
              </View>
            </Card>
          </>
        )}
        {status.createError && (
          <View style={{ flexDirection: "row", gap: space.sm }}>
            <Icon name="warning" color="orange" />
            <Text selectable variant="subheadline" role="alert" style={{ flex: 1 }}>
              {describeError({ code: status.createError })}
            </Text>
          </View>
        )}
        <View style={{ flexDirection: "row", justifyContent: "flex-end", alignItems: "center", gap: space.sm, paddingTop: space.md }}>
          {creating && <ActivityIndicator color={colors.secondaryLabel} />}
          <Button
            label={t("create")}
            variant="primary"
            disabled={!ready}
            onPress={() => {
              if (!ready || !link || !machine || !chosen || !model) return;
              setCreating(link.createAgent(machine, { name: name.trim(), provider: chosen.name, model }));
            }}
          />
        </View>
      </>
    );

  return (
    <ScrollView keyboardShouldPersistTaps="handled" contentInsetAdjustmentBehavior="automatic" contentContainerStyle={[column, { padding: space.lg, gap: space.sm }]}>
      <Stack.Screen options={{ title: t("title") }} />
      {content}
    </ScrollView>
  );
}
