import { router } from "expo-router";
import { useState } from "react";
import { Switch, View } from "react-native";
import { useDevices, type Device } from "../../../entities/device";
import { useMachines } from "../../../entities/machine";
import { useMachineLink } from "../../../features/machine-link";
import { describeError, useLanguage, useT } from "../../../shared/i18n";
import { keySession } from "../../../shared/keystore";
import { when } from "../../../shared/lib";
import { confirm, inform, Note, Row, Screen, Section, space } from "../../../shared/ui";
import { revocationOf, revokeDevice } from "../model/revoke";

// controller-prototype's DevicesPage: this Member's Controllers, who linked each and when,
// and the way to cut one off (ADR 0031). Renaming and Linking by login are not in v0.1.
export function DevicesPage() {
  const t = useT("devices");
  const devices = useDevices() ?? [];
  const own = useMachineLink()?.ownKey;
  const live = devices.filter((d) => d.revoked_at === null);
  const revoked = devices.filter((d) => d.revoked_at !== null);
  return (
    <Screen title={t("title")} right={{ label: t("linkNew"), icon: "add", onPress: () => router.push("/devices/link") }}>
      <Section title={t("mine")} footer={t("footer")}>
        {live.map((device) => (
          <DeviceRow key={device.key} device={device} devices={devices} here={device.key === own} />
        ))}
      </Section>
      {revoked.length > 0 && (
        <Section title={t("revokedSection")}>
          {revoked.map((device) => (
            <Row key={device.key} icon="device" title={device.name || t("firstDevice")} detail={t("revokedDetail")} />
          ))}
        </Section>
      )}
      <Section title={t("linkNew")} footer={t("linkFooter")}>
        <Row icon="add" title={t("linkQr")} detail={t("linkQrDetail")} href="/devices/link" />
      </Section>
      {live.length < 2 && (
        <Note icon="info" iconColor="orange">
          {t("oneDevice")}
        </Note>
      )}
    </Screen>
  );
}

function DeviceRow({ device, devices, here }: { device: Device; devices: Device[]; here: boolean }) {
  const t = useT("devices");
  const language = useLanguage();
  const machines = useMachines();
  const [open, setOpen] = useState(false);
  // The certificates this key signed; those not kept stop working when it is revoked (ADR 0031).
  const signed = devices.filter((d) => d.linked_by === device.key && d.revoked_at === null);
  const [dropped, setDropped] = useState<string[]>([]);
  const keep = signed.filter((d) => !dropped.includes(d.key)).map((d) => d.key);
  const nameOf = (key: string) => devices.find((d) => d.key === key)?.name || t("firstDevice");
  const name = device.name || t("firstDevice");
  const since = device.linked_at ? when(device.linked_at, language) : undefined;
  const detail = device.linked_by ? t("linkedBy", { name: nameOf(device.linked_by), when: since }) : t("firstDevice");

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

  return (
    <View>
      <Row icon="device" title={name} detail={detail} value={here ? t("thisDevice") : undefined} onPress={() => setOpen(!open)} />
      {open && (
        <View style={{ paddingLeft: space.xl }}>
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
        </View>
      )}
    </View>
  );
}
