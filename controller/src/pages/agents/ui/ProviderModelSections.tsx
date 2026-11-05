import { useState } from "react";
import { ActivityIndicator } from "react-native";
import type { MachineStatus } from "../../../features/machine-link";
import { describeError, useT } from "../../../shared/i18n";
import { Field, Icon, Row, Section, useColors } from "../../../shared/ui";
import { errorOf, modelsOf } from "../model/providers";

// ponytail: a gateway can list hundreds of models, so only the first matches show; add paging if people miss theirs.
const SHOWN = 30;

/**
 * The Provider and model sections of New Agent and of the Agent's Provider page: ticked rows of
 * what the Machine listed. The prototype picks from a menu (@expo/ui); this app has no @expo/ui yet,
 * so they are ticked rows like the language. A value not in the list is never ticked.
 */
export function ProviderModelSections({
  status,
  provider,
  model,
  footer,
  onProvider,
  onModel,
}: {
  status: MachineStatus | undefined;
  provider: string | undefined;
  model: string | null;
  footer: string;
  onProvider: (name: string) => void;
  onModel: (id: string) => void;
}) {
  const t = useT("agents");
  const colors = useColors();
  const [filter, setFilter] = useState("");
  const providers = status?.providers ?? [];
  const chosen = providers.find((p) => p.name === provider);
  const models = modelsOf(chosen);
  const query = filter.trim().toLowerCase();
  const matching = models.filter((m) => !query || m.id.toLowerCase().includes(query) || m.name?.toLowerCase().includes(query)).slice(0, SHOWN);
  const tick = <Icon name="check" size="md" color="label" weight="semibold" />;

  return (
    <>
      <Section title={t("provider.heading")} footer={footer}>
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
              onPress={() => onProvider(p.name)}
              accessory={p.name === chosen?.name ? tick : undefined}
            />
          ))
        )}
      </Section>

      {models.length > 0 && (
        <Section title="model">
          {models.length > 8 && <Field label={t("modelFilter")} value={filter} onChangeText={setFilter} mono />}
          {matching.map((m) => (
            <Row key={m.id} title={m.name ?? m.id} detail={m.name ? m.id : undefined} onPress={() => onModel(m.id)} accessory={m.id === model ? tick : undefined} />
          ))}
          {matching.length === 0 && <Row title={t("noMatch")} />}
        </Section>
      )}
    </>
  );
}
