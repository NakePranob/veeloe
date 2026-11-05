import type { LinkingLink } from "@veeloe/protocol";
import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, View } from "react-native";
import { listDevices, useDevices } from "../../../entities/device";
import { useMachines } from "../../../entities/machine";
import { useMachineLink } from "../../../features/machine-link";
import { useDatabase } from "../../../shared/db";
import { describeError, useT } from "../../../shared/i18n";
import { keySession } from "../../../shared/keystore";
import { Button, Field, inform, Note, QrScanner, Screen, Section, space, Text, useColors } from "../../../shared/ui";
import { approveLink, handOff, handoffData, nameProblem, readLink } from "../model/link";

// controller-prototype's DeviceLinkPage on the device that is already in the Workspace: read the new
// device's QR, name it, authenticate, sign (ADR 0013, 0031). The QR goes from screen to camera, so
// there is no short code to compare: no Hub stands between them to swap the key.
export function LinkDevicePage() {
  const t = useT("link-device");
  const colors = useColors();
  const database = useDatabase();
  const machines = useMachines() ?? [];
  const devices = useDevices() ?? [];
  const links = useMachineLink();
  // Filled when the phone's camera opened a veeloe://link link.
  const { link: opened } = useLocalSearchParams<{ link?: string }>();
  const [text, setText] = useState(opened ?? "");
  const [link, setLink] = useState<LinkingLink | null>(null);
  const [name, setName] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [step, setStep] = useState<"enter" | "name" | "sending">("enter");

  function accept(value: string) {
    const read = readLink(value, machines);
    if (!read.ok) return setProblem(describeError({ code: read.code }));
    setProblem(null);
    setLink(read.link);
    setName(read.link.name);
    setStep("name");
  }

  async function approve() {
    if (!link || !links) return;
    const why = nameProblem(name, devices);
    if (why) return inform(t("cannot"), why === "empty" ? t("name.empty") : t("name.taken", { name: name.trim() }));
    const machine = machines.find((m) => m.hub_url === link.hub)!;
    const answer = await approveLink((use) => keySession.withFreshAuthentication(t("prompt", { name: name.trim() }), use), { link, name, machine });
    if (answer === null) return; // Cancelled: nothing was signed or sent, and the question stands.
    if (!answer.ok) return setProblem(describeError({ code: answer.code }));
    setStep("sending");
    // Its own key is in the list it hands over, now that the certificate it just signed has landed.
    const data = handoffData(link, machines, await listDevices(database));
    const result = await handOff({ link, data, send: (type, body) => links.sendToSelf(link.hub, type, body), watch: links.watch });
    if (result === "linked") router.replace("/devices");
    else {
      setStep("name");
      setProblem(describeError({ code: "linking.link_expired" }));
    }
  }

  const problemText = problem && (
    <Note icon="warning" iconColor="orange">
      {problem}
    </Note>
  );

  if (step === "sending") {
    return (
      <Screen title={t("title")}>
        <View style={{ alignItems: "center", gap: space.sm, paddingVertical: space.xl }}>
          <ActivityIndicator color={colors.secondaryLabel} />
          <Text variant="headline" role="heading">
            {t("sending.heading")}
          </Text>
          <Text variant="subheadline" tone="secondary" style={{ textAlign: "center" }}>
            {t("sending.body")}
          </Text>
        </View>
      </Screen>
    );
  }

  if (step === "name" && link) {
    return (
      <Screen title={t("title")}>
        <Section title={t("name.heading")} footer={t("name.footer")}>
          <Field label={t("name.label")} value={name} onChangeText={setName} />
        </Section>
        {problemText}
        <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: space.sm }}>
          <Button
            label={t("cancel")}
            onPress={() => {
              setLink(null);
              setProblem(null);
              setStep("enter");
            }}
          />
          <Button label={t("approve")} variant="primary" onPress={() => void approve()} />
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
