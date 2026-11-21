import { useState } from "react";
import { View } from "react-native";
import type { MachineStatus } from "../../../features/machine-link";
import { describeError, useLanguage, useT } from "../../../shared/i18n";
import { formatTokens } from "../../../shared/lib";
import { Chip, Field, Icon, Note, Row, Section, Select, Spinner, Tap, Text, space } from "../../../shared/ui";
import { errorOf, modelsOf } from "../model/providers";

// ponytail: a gateway can list hundreds of models, so only the first matches show; add paging if people miss theirs.
const SHOWN = 30;

/**
 * The AgentModel board, used by New Agent and the Agent's Provider page: the Provider as one row that
 * opens its choices, a search box, then the models the Machine listed with their context. A value not in
 * the list is never ticked.
 * ponytail: the board shows the Provider's URL on its row; the Machine never sends it (ProviderSchema), so it is left out.
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
  footer?: string;
  onProvider: (name: string) => void;
  onModel: (id: string) => void;
}) {
  const t = useT("provider-models");
  const language = useLanguage();
  const [filter, setFilter] = useState("");
  const providers = status?.providers ?? [];
  const chosen = providers.find((p) => p.name === provider);
  const models = modelsOf(chosen);
  const query = filter.trim().toLowerCase();
  const matching = models.filter((m) => !query || m.id.toLowerCase().includes(query) || m.name?.toLowerCase().includes(query)).slice(0, SHOWN);
  // The board offers only Providers that answered; the one in use stays, so its error can be read below.
  const options = providers.filter((p) => !errorOf(p) || p.name === chosen?.name).map((p) => ({ value: p.name, label: p.name }));
  const failure = errorOf(chosen);

  return (
    <>
      <Section footer={footer}>
        {status?.online === false ? (
          <Row icon="machine" title={t("machine.offline")} />
        ) : !status?.providers ? (
          <Row title={t("asking")} accessory={<Spinner />} />
        ) : providers.length === 0 ? (
          <Row icon="key" title={t("provider.none")} detail={t("provider.command")} />
        ) : (
          <Select cancel={t("pickCancel")} label={t("provider.heading")} value={chosen?.name ?? ""} options={options} onChange={onProvider} />
        )}
      </Section>
      {failure && <Note tone="warning">{describeError({ code: failure })}</Note>}

      {models.length > 0 && (
        <>
          <Field bare icon="search" label={t("modelFilter")} value={filter} onChangeText={setFilter} placeholder={t("modelFilter")} />
          <Section title={t("modelHeading", { provider: chosen?.name ?? "", count: models.length })} footer={t("contextFooter")}>
            {matching.map((m) => (
              <Tap key={m.id} onPress={() => onModel(m.id)} style={{ flexDirection: "row", alignItems: "center", gap: space.md, minHeight: 60, paddingHorizontal: space.inset, paddingVertical: space.sm, borderRadius: 0 }}>
                <View style={{ flex: 1, gap: space.xxs }}>
                  <Text variant="subheadline" strong>
                    {m.name ?? m.id}
                  </Text>
                  {m.name && (
                    <Text variant="caption" tone="secondary" mono numberOfLines={1}>
                      {m.id}
                    </Text>
                  )}
                </View>
                {m.contextWindow ? <Chip tone="mono" label={formatTokens(m.contextWindow, language)} /> : null}
                {/* Kept in place when hidden, so the chips line up down the list. */}
                <View style={{ opacity: m.id === model ? 1 : 0 }} aria-hidden={m.id !== model}>
                  <Icon name="check" size="md" color="label" weight="semibold" />
                </View>
              </Tap>
            ))}
            {matching.length === 0 && <Row title={t("noMatch")} />}
          </Section>
        </>
      )}
    </>
  );
}
