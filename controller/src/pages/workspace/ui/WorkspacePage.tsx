import { useAgents } from "../../../entities/agent";
import { useMachines } from "../../../entities/machine";
import { useDatabase, useLiveQuery } from "../../../shared/db";
import { LANGUAGES, saveLanguage, useLanguage, useT } from "../../../shared/i18n";
import { Icon, Row, Screen, Section } from "../../../shared/ui";

// Everything that is not a conversation, grouped as a settings app groups it (controller-prototype's WorkspacePage).
export function WorkspacePage() {
  const t = useT("workspace");
  const database = useDatabase();
  const language = useLanguage();
  const machines = useMachines();
  const agents = useAgents();
  const saved = useLiveQuery<{ value: string }>("SELECT value FROM device_setting WHERE key = 'language'", [], ["device_setting"]);
  const current = saved?.[0]?.value ?? language;
  return (
    <Screen title="Workspace">
      <Section title={t("onMachines")}>
        <Row icon="machine" title="Machine" value={machines ? String(machines.length) : undefined} href="/machines" />
        <Row icon="agent" title="Agent" value={agents ? String(agents.length) : undefined} href="/agents" />
      </Section>
      <Section title={t("language.heading")} footer={t("language.note")}>
        {LANGUAGES.map((option) => (
          <Row
            key={option}
            title={t(`language.${option}`)}
            onPress={() => void saveLanguage(database, option)}
            accessory={option === current ? <Icon name="check" size="md" color="label" weight="semibold" /> : undefined}
          />
        ))}
      </Section>
    </Screen>
  );
}
