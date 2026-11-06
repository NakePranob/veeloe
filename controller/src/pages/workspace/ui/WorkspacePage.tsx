import { useAgents } from "../../../entities/agent";
import { useDevices } from "../../../entities/device";
import { useMachines } from "../../../entities/machine";
import { useDatabase, useLiveQuery } from "../../../shared/db";
import { LANGUAGES, saveLanguage, useLanguage, useT } from "../../../shared/i18n";
import { Icon, Note, Row, Screen, Section } from "../../../shared/ui";

// Everything that is not a conversation, grouped as a settings app groups it (controller-prototype's WorkspacePage).
export function WorkspacePage() {
  const t = useT("workspace");
  const database = useDatabase();
  const language = useLanguage();
  const machines = useMachines();
  const agents = useAgents();
  const devices = useDevices();
  const live = devices?.filter((d) => d.revoked_at === null);
  const saved = useLiveQuery<{ value: string }>("SELECT value FROM device_setting WHERE key = 'language'", [], ["device_setting"]);
  const current = saved?.[0]?.value ?? language;
  return (
    <Screen title="Workspace">
      <Section title={t("onMachines")}>
        <Row icon="machine" title="Machine" value={machines ? String(machines.length) : undefined} href="/machines" />
        <Row icon="agent" title="Agent" value={agents ? String(agents.length) : undefined} href="/agents" />
      </Section>
      <Section>
        <Row icon="usage" title={t("usage")} detail={t("usageDetail")} href="/usage" />
      </Section>
      <Section title={t("people")}>
        <Row icon="device" title={t("devices")} value={live?.length ? String(live.length) : undefined} href="/devices" />
      </Section>
      {/* Once there is a device list, which comes with the first Machine. */}
      {live?.length === 1 && (
        <Note icon="info" iconColor="orange">
          {t("oneDevice")}
        </Note>
      )}
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
