import type { LinkingLink } from "@veeloe/protocol";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, View } from "react-native";
import { saveDeviceNames } from "../../../entities/device";
import { saveMachine } from "../../../entities/machine";
import { useDatabase } from "../../../shared/db";
import { deviceName } from "../../../shared/device-name";
import { describeError, useLanguage, useT } from "../../../shared/i18n";
import { keySession } from "../../../shared/keystore";
import { when } from "../../../shared/lib";
import { Button, Field, inform, Note, QrScanner, Row, Screen, Section, space, Text, useColors } from "../../../shared/ui";
import { readLink, sendLinkRequest, waitForHandoff } from "../model/wait";

type Waiting = ReturnType<typeof waitForHandoff>;

// The new device's side of Linking (ADR 0013, 0031), after WelcomePage's step on a second device:
// read the QR the other device shows, by camera, or by opening or pasting its link on a device
// with none, as Pairing reads `veeloe pair`'s. The link names the Hub, so this asks for none.
export function LinkThisDevicePage() {
  const t = useT("link-this-device");
  const colors = useColors();
  const language = useLanguage();
  const database = useDatabase();
  // Filled when the camera or another app opened a veeloe://link link.
  const { link: opened } = useLocalSearchParams<{ link?: string }>();
  const [text, setText] = useState(opened ?? "");
  const [link, setLink] = useState<LinkingLink | null>(null);
  const [name, setName] = useState(deviceName);
  const [problem, setProblem] = useState<string | null>(null);
  const [waiting, setWaiting] = useState<Waiting | null>(null);
  const current = useRef<Waiting | null>(null);

  // Leaving the page drops the wait and its secret.
  useEffect(() => () => current.current?.stop(), []);

  function accept(value: string) {
    const read = readLink(value);
    if (!read.ok) return setProblem(describeError({ code: read.code }));
    setProblem(null);
    setLink(read.link);
  }

  // A link that opened the app goes straight to the name, once.
  useEffect(() => void (opened && accept(opened)), []);

  async function ask() {
    if (!link) return;
    if (!name.trim()) return inform(t("cannot"), t("name.empty"));
    const secretKey = keySession.secretKey();
    if (!secretKey) return;
    // Waiting first, so nothing the other device sends after its owner approves is missed.
    const wait = waitForHandoff({ link, secretKey });
    const answer = await sendLinkRequest({ link, name, secretKey });
    if (!answer.ok) {
      wait.stop();
      return setProblem(describeError({ code: answer.code }));
    }
    current.current = wait;
    setProblem(null);
    setWaiting(wait);
    const result = await wait.done;
    if (current.current !== wait) return;
    current.current = null;
    setWaiting(null);
    if (!result.ok) {
      setLink(null);
      setText("");
      return setProblem(describeError({ code: result.code }));
    }
    const { workspace, member, machines, keys } = result.data;
    for (const m of machines) await saveMachine(database, { id: m.id, public_key: m.key, name: m.name, hub_url: m.hub, workspace_id: workspace, member_id: member, paired_at: Date.now() });
    await saveDeviceNames(database, member, keys);
    router.dismissTo("/");
  }

  const problemText = problem && (
    <Note icon="warning" iconColor="orange">
      {problem}
    </Note>
  );

  if (waiting && link) {
    return (
      <Screen title={t("title")}>
        <Section title={t("waiting.heading")} footer={t("waiting.footer", { when: when(link.expires * 1000, language) })}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm, padding: space.sm }}>
            <ActivityIndicator color={colors.secondaryLabel} />
            <Text variant="subheadline" tone="secondary" style={{ flex: 1 }}>
              {t("waiting.body", { name: name.trim() })}
            </Text>
          </View>
        </Section>
      </Screen>
    );
  }

  if (link) {
    return (
      <Screen title={t("title")}>
        <Section title={t("name.heading")} footer={t("name.footer")}>
          <Field label={t("name.label")} value={name} onChangeText={setName} />
          {/* Where this device will connect, from the link: for someone running their own Hub to see it is theirs. */}
          <Row icon="network" title={t("hub")} detail={link.hub} mono />
        </Section>
        {problemText}
        <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: space.sm }}>
          <Button
            label={t("back")}
            onPress={() => {
              setLink(null);
              setProblem(null);
            }}
          />
          <Button label={t("send")} variant="primary" onPress={() => void ask()} />
        </View>
      </Screen>
    );
  }

  return (
    <Screen title={t("title")}>
      <Section title={t("enter.heading")} footer={t("enter.footer")}>
        <View style={{ gap: space.md, padding: space.sm }}>
          <QrScanner labels={{ scan: t("enter.scan"), stop: t("enter.stopScan") }} onScan={accept} onNoCamera={() => setProblem(t("enter.noCamera"))} />
        </View>
        <Field label={t("enter.paste")} value={text} onChangeText={setText} multiline mono />
      </Section>
      {problemText}
      <View style={{ flexDirection: "row", justifyContent: "flex-end" }}>
        <Button label={t("enter.continue")} variant="primary" disabled={!text.trim()} onPress={() => accept(text)} />
      </View>
    </Screen>
  );
}
