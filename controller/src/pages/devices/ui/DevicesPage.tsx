import { router } from "expo-router";
import { useState } from "react";
import { Switch, View } from "react-native";
import { renameDevice, useDevices, type Device } from "../../../entities/device";
import { useMachines } from "../../../entities/machine";
import { useMachineLink } from "../../../features/machine-link";
import { useDatabase } from "../../../shared/db";
import { describeError, useLanguage, useT } from "../../../shared/i18n";
import { keySession } from "../../../shared/keystore";
import { when } from "../../../shared/lib";
import { Button, Card, Chip, confirm, Field, Icon, inform, Note, radius, Row, Screen, Section, size, space, Text } from "../../../shared/ui";
import { revocationOf, revokeDevice } from "../model/revoke";

// The Devices board: this device on top, the Member's other Controllers, the revoked ones,
// and the way to cut one off (ADR 0031). Linking by login is not in v0.1.
export function DevicesPage() {
  const t = useT("devices");
  const devices = useDevices() ?? [];
  const own = useMachineLink()?.ownKey;
  const live = devices.filter((d) => d.revoked_at === null);
  const here = live.find((d) => d.key === own);
  const others = live.filter((d) => d !== here);
  const revoked = devices.filter((d) => d.revoked_at !== null);
  return (
    <Screen title={t("title")} subtitle={t("count", { count: live.length })} right={{ label: t("linkNew"), icon: "add", onPress: () => router.push("/devices/link") }}>
      {here && <Hero device={here} devices={devices} />}
      {others.length > 0 && (
        <Section title={t("others")}>
          {others.map((device) => (
            <DeviceRow key={device.key} device={device} devices={devices} />
          ))}
        </Section>
      )}
      {revoked.length > 0 && (
        <View style={{ gap: space.smd }}>
          <Text variant="footnote" strong tone="secondary" style={{ paddingHorizontal: space.inset }}>
            {t("revokedSection")}
          </Text>
          {/* Each revoked device on a card of its own, all of it grey: it no longer does anything. */}
          {revoked.map((device) => (
            <Card key={device.key} style={{ flexDirection: "row", alignItems: "center", gap: space.md, minHeight: size.row, paddingHorizontal: space.inset, paddingVertical: space.md, borderRadius: radius.card }}>
              <Icon name="device" size="md" color="secondaryLabel" />
              <View style={{ flex: 1, gap: space.xxs }}>
                <Text variant="subheadline" tone="secondary" selectable>
                  {device.name || t("firstDevice")}
                </Text>
                <Text variant="caption" tone="secondary">
                  {t("revokedDetail")}
                </Text>
              </View>
            </Card>
          ))}
        </View>
      )}
      {live.length < 2 && <Note tone="warning">{t("oneDevice")}</Note>}
      <Note tone="plain">{t("intro")}</Note>
    </Screen>
  );
}

// Renaming and revoking one device, with the certificates it signed that the Member keeps (ADR 0031).
function useDeviceActions(device: Device, devices: Device[], here: boolean) {
  const t = useT("devices");
  const language = useLanguage();
  const database = useDatabase();
  const machines = useMachines();
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(device.name);
  const [problem, setProblem] = useState<string | null>(null);
  // The certificates this key signed; those not kept stop working when it is revoked (ADR 0031).
  const signed = devices.filter((d) => d.linked_by === device.key && d.revoked_at === null);
  const [dropped, setDropped] = useState<string[]>([]);
  const keep = signed.filter((d) => !dropped.includes(d.key)).map((d) => d.key);
  const nameOf = (key: string) => devices.find((d) => d.key === key)?.name || t("firstDevice");
  const name = device.name || t("firstDevice");
  const since = device.linked_at ? when(device.linked_at, language) : undefined;
  const detail = device.linked_by ? t("linkedBy", { name: nameOf(device.linked_by), when: since }) : t("firstDevice");

  function startRename() {
    setDraft(name);
    setProblem(null);
    setRenaming(true);
  }

  async function saveRename() {
    const next = draft.trim();
    if (!next) return setProblem(t("rename.empty"));
    if (devices.some((other) => other.key !== device.key && other.revoked_at === null && other.name === next)) {
      return setProblem(t("rename.taken"));
    }
    if (!(await renameDevice(database, device.key, next))) return setProblem(t("rename.failed"));
    setProblem(null);
    setRenaming(false);
  }

  async function revoke() {
    const machine = machines?.[0];
    const { drops, survivors } = revocationOf(devices, device.key, keep);
    if (survivors.length === 0) return inform(t("lastDevice.title"), t("lastDevice.body", { name }));
    if (!machine) return inform(t("failed"), describeError({ code: "pairing.hub_unreachable" }));
    const others = drops.filter((key) => key !== device.key).map(nameOf);
    const kept = signed.filter((d) => keep.includes(d.key)).map((d) => d.name);
    const message = [here ? t("confirm.here") : null, t("confirm.body"), others.length ? t("confirm.drops", { names: others.join(", ") }) : null, kept.length ? t("confirm.kept", { names: kept.join(", ") }) : null]
      .filter(Boolean)
      .join("\n\n");
    if (!(await confirm({ title: t("confirm.title", { name }), message, action: t("confirm.action"), cancel: t("confirm.cancel"), destructive: true }))) return;
    const answer = await revokeDevice((use) => keySession.withFreshAuthentication(t("prompt", { name }), use), { device: device.key, keep, devices, machine });
    // Cancelled: nothing was signed. Done: the Hub hands the revocation to every device, this one's list included,
    // and closes the revoked device's connection, which wipes it when it is this one.
    if (answer && !answer.ok) inform(t("failed"), describeError({ code: answer.code }));
  }

  const rename = (
    <>
      <Field label={t("rename.label")} value={draft} onChangeText={setDraft} placeholder={t("rename.placeholder")} footer={problem ?? t("rename.footer")} />
      <Row title={t("rename.save")} onPress={() => void saveRename()} />
      <Row title={t("rename.cancel")} onPress={() => setRenaming(false)} />
    </>
  );
  const options = (
    <>
      {signed.length > 0 && (
        <>
          <Row title={t("signed.title")} detail={t("signed.detail")} />
          {signed.map((other) => (
            <Row
              key={other.key}
              title={t("keep", { name: other.name })}
              accessory={
                <Switch
                  aria-label={t("keep", { name: other.name })}
                  value={keep.includes(other.key)}
                  onValueChange={(on) => setDropped(on ? dropped.filter((k) => k !== other.key) : [...dropped, other.key])}
                />
              }
            />
          ))}
        </>
      )}
      <Row icon="trash" title={t("revoke")} destructive onPress={() => void revoke()} />
    </>
  );
  return { name, detail, renaming, startRename, rename, options };
}

// This device, large: its name, how it came, and its two buttons.
function Hero({ device, devices }: { device: Device; devices: Device[] }) {
  const t = useT("devices");
  const [open, setOpen] = useState(false);
  const { name, detail, renaming, startRename, rename, options } = useDeviceActions(device, devices, true);
  return (
    <>
      <Card style={{ padding: 18, gap: space.inset, borderRadius: radius.lg }}>
        <View style={{ flexDirection: "row", alignItems: "flex-start", gap: space.inset }}>
          {/* A raised Card without its shadow is the white square the board puts the icon on. */}
          <Card tone="surface" style={{ width: 56, height: 56, padding: 0, borderRadius: radius.md, alignItems: "center", justifyContent: "center" }}>
            <Icon name="device" size="lg" color="label" />
          </Card>
          <View style={{ flex: 1, gap: 3 }}>
            <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: space.sm }}>
              <Text variant="title" selectable>
                {name}
              </Text>
              <Chip tone="choice" selected label={t("thisDevice")} />
            </View>
            {/* ponytail: the board's "ใช้ล่าสุด ตอนนี้" needs a last-seen time the database does not keep. */}
            <Text variant="footnote" tone="body">
              {detail}
            </Text>
          </View>
        </View>
        <View style={{ flexDirection: "row", gap: space.sm }}>
          <View style={{ flex: 1 }}>
            <Button label={t("rename.short")} variant="surface" onPress={startRename} />
          </View>
          <Button label={t("more")} icon="more" variant="surface" onPress={() => setOpen(!open)} />
        </View>
      </Card>
      {renaming && <Section>{rename}</Section>}
      {open && <Section>{options}</Section>}
    </>
  );
}

// Another device of the Member's; it opens its rename and revoke under it.
function DeviceRow({ device, devices }: { device: Device; devices: Device[] }) {
  const t = useT("devices");
  const [open, setOpen] = useState(false);
  const { name, detail, renaming, startRename, rename, options } = useDeviceActions(device, devices, false);
  // ponytail: the board's per-kind icon (iPad, laptop) and "ใช้ล่าสุด" line need an OS and a last-seen time the database does not keep.
  return (
    <View>
      <Row icon="device" title={name} detail={detail} accessory={<Icon name={open ? "collapse" : "expand"} size="sm" color="secondaryLabel" />} onPress={() => setOpen(!open)} />
      {open && (
        <Card tone="surface" style={{ marginHorizontal: space.sm, marginBottom: space.sm, padding: 0, gap: 0, borderRadius: radius.md }}>
          {renaming ? rename : <Row icon="edit" title={t("rename.action")} onPress={startRename} />}
          {options}
        </Card>
      )}
    </View>
  );
}
