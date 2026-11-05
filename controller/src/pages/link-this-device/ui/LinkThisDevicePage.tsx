import { router } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, View } from "react-native";
import { saveDeviceNames } from "../../../entities/device";
import { saveMachine } from "../../../entities/machine";
import { useDatabase } from "../../../shared/db";
import { deviceName } from "../../../shared/device-name";
import { describeError, useLanguage, useT } from "../../../shared/i18n";
import { keySession } from "../../../shared/keystore";
import { when } from "../../../shared/lib";
import { Button, Card, Field, inform, Note, QrCode, Screen, Section, space, Text, useColors } from "../../../shared/ui";
import { hubFrom, waitForHandoff } from "../model/wait";

type Waiting = ReturnType<typeof waitForHandoff>;

// The new device's side of Linking (ADR 0013, 0031). The prototype has no page of its own for it:
// this is its DeviceLinkPage's QR stand-in, made real, after WelcomePage's step on a second device.
export function LinkThisDevicePage() {
  const t = useT("link-this-device");
  const colors = useColors();
  const language = useLanguage();
  const database = useDatabase();
  // Filled at build time for the Hub this app ships with; someone running their own Hub types theirs.
  const [hub, setHub] = useState(process.env.EXPO_PUBLIC_HUB_URL ?? "");
  const [name, setName] = useState(deviceName);
  const [waiting, setWaiting] = useState<Waiting | null>(null);
  const [expired, setExpired] = useState(false);
  const current = useRef<Waiting | null>(null);

  // Leaving the page drops the wait and its secret.
  useEffect(() => () => current.current?.stop(), []);

  function show() {
    const normal = hubFrom(hub);
    if (!normal) return inform(t("cannot"), describeError({ code: "linking.hub_invalid" }));
    if (!name.trim()) return inform(t("cannot"), t("name.empty"));
    const secretKey = keySession.secretKey();
    if (!secretKey) return;
    const wait = waitForHandoff({ hub: normal, name: name.trim(), secretKey });
    current.current = wait;
    setExpired(false);
    setWaiting(wait);
    void wait.done.then(async (result) => {
      if (current.current !== wait) return;
      current.current = null;
      if (!result.ok) {
        setWaiting(null);
        setExpired(true);
        return;
      }
      const { workspace, member, machines, keys } = result.data;
      for (const m of machines) await saveMachine(database, { id: m.id, public_key: m.key, name: m.name, hub_url: m.hub, workspace_id: workspace, member_id: member, paired_at: Date.now() });
      await saveDeviceNames(database, member, keys);
      router.dismissTo("/");
    });
  }

  if (waiting) {
    return (
      <Screen title={t("title")}>
        <Section title={t("qr.heading")} footer={t("qr.footer", { when: when(waiting.expires * 1000, language) })}>
          <Card style={{ alignItems: "center" }}>
            <QrCode text={waiting.text} label={t("qr.label")} />
          </Card>
          <View style={{ padding: space.sm, gap: space.xs }}>
            <Text variant="footnote" tone="secondary">
              {t("qr.link")}
            </Text>
            <Text selectable mono variant="footnote">
              {waiting.text}
            </Text>
          </View>
        </Section>
        <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm, paddingHorizontal: space.sm }}>
          <ActivityIndicator color={colors.secondaryLabel} />
          <Text variant="subheadline" tone="secondary" style={{ flex: 1 }}>
            {t("waiting")}
          </Text>
        </View>
        <Note icon="lock">{t("secret")}</Note>
      </Screen>
    );
  }

  return (
    <Screen title={t("title")}>
      <Section title={t("why.heading")} footer={t("why.footer")}>
        <Field label={t("hub.label")} value={hub} onChangeText={setHub} placeholder="wss://" mono footer={t("hub.footer")} />
        <Field label={t("name.label")} value={name} onChangeText={setName} footer={t("name.footer")} />
      </Section>
      {expired && (
        <Note icon="warning" iconColor="orange">
          {describeError({ code: "linking.expired" })}
        </Note>
      )}
      <View style={{ flexDirection: "row", justifyContent: "flex-end" }}>
        <Button label={t(expired ? "again" : "show")} variant="primary" onPress={show} />
      </View>
    </Screen>
  );
}
