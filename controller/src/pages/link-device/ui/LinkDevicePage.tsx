import { router } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, Share, View } from "react-native";
import { listDevices, useDevices } from "../../../entities/device";
import { useMachines } from "../../../entities/machine";
import { useMachineLink } from "../../../features/machine-link";
import { useDatabase } from "../../../shared/db";
import { describeError, useLanguage, useT } from "../../../shared/i18n";
import { keySession } from "../../../shared/keystore";
import { when } from "../../../shared/lib";
import { Button, Card, Field, inform, Note, QrCode, Screen, Section, space, Text, useColors } from "../../../shared/ui";
import { approveLink, handOff, handoffData, nameProblem, openLink, type LinkAsk, type OpenLink } from "../model/link";

// controller-prototype's DeviceLinkPage on the device that is already in the Workspace: show a QR
// that carries this device's Hub, as `veeloe pair` does, then approve the request the new device
// sends back, authenticate and sign (ADR 0013, 0031). The new device never asks for a Hub.
export function LinkDevicePage() {
  const t = useT("link-device");
  const colors = useColors();
  const language = useLanguage();
  const database = useDatabase();
  const machines = useMachines();
  const devices = useDevices() ?? [];
  const links = useMachineLink();
  // ponytail: the first Machine's Hub. A Member with Machines on two Hubs links on that one, and the
  // new device gets the Machines there; a Hub picker goes here if that ever happens.
  const hub = machines?.[0]?.hub_url;
  const [offer, setOffer] = useState<OpenLink | null>(null);
  const [ask, setAsk] = useState<LinkAsk | null>(null);
  const [name, setName] = useState("");
  const [expired, setExpired] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  function fresh() {
    if (!links || !hub) return;
    setOffer(openLink({ hub, ownKey: links.ownKey }));
    setAsk(null);
    setExpired(false);
    setProblem(null);
  }

  // A QR as soon as there is a connection to say it on; a new one only when asked.
  useEffect(() => void (!offer && fresh()), [links, hub]);

  useEffect(() => {
    if (!offer || !links || ask) return;
    const timer = setTimeout(() => setExpired(true), Math.max(0, offer.link.expires * 1000 - Date.now()));
    const stop = links.onLinkRequest((from, request) => {
      if (from !== offer.link.hub) return;
      const taken = offer.take(request);
      if (!taken) return;
      setAsk(taken);
      setName(taken.name);
    });
    return () => {
      clearTimeout(timer);
      stop();
    };
  }, [offer, links, ask]);

  async function approve() {
    if (!offer || !ask || !links || !machines) return;
    const why = nameProblem(name, devices);
    if (why) return inform(t("cannot"), why === "empty" ? t("name.empty") : t("name.taken", { name: name.trim() }));
    const machine = machines.find((m) => m.hub_url === offer.link.hub)!;
    const answer = await approveLink((use) => keySession.withFreshAuthentication(t("prompt", { name: name.trim() }), use), { link: offer.link, ask, name, machine });
    if (answer === null) return; // Cancelled: nothing was signed or sent, and the question stands.
    if (!answer.ok) return setProblem(describeError({ code: answer.code }));
    setSending(true);
    // Its own key is in the list it hands over, now that the certificate it just signed has landed.
    const data = handoffData(offer.link.hub, machines, await listDevices(database));
    const result = await handOff({ link: offer.link, key: ask.key, data, send: (type, body) => links.sendToSelf(offer.link.hub, type, body), watch: links.watch });
    if (result === "linked") return router.replace("/devices");
    setSending(false);
    setProblem(describeError({ code: "linking.expired" }));
  }

  const problemText = problem && (
    <Note icon="warning" iconColor="orange">
      {problem}
    </Note>
  );

  if (machines && !hub) {
    return (
      <Screen title={t("title")}>
        <Note icon="info">{t("noHub")}</Note>
      </Screen>
    );
  }

  if (sending) {
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

  if (ask) {
    return (
      <Screen title={t("title")}>
        <Section title={t("ask.heading")} footer={t("ask.footer")}>
          <Field label={t("ask.label")} value={name} onChangeText={setName} />
        </Section>
        {problemText}
        <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: space.sm }}>
          <Button label={t("cancel")} onPress={() => router.back()} />
          <Button label={t("approve")} variant="primary" onPress={() => void approve()} />
        </View>
      </Screen>
    );
  }

  if (!offer) {
    return (
      <Screen title={t("title")}>
        <ActivityIndicator color={colors.secondaryLabel} />
      </Screen>
    );
  }

  if (expired) {
    return (
      <Screen title={t("title")}>
        <Note icon="warning" iconColor="orange">
          {t("expired")}
        </Note>
        <View style={{ flexDirection: "row", justifyContent: "flex-end" }}>
          <Button label={t("again")} variant="primary" onPress={fresh} />
        </View>
      </Screen>
    );
  }

  return (
    <Screen title={t("title")}>
      <Section title={t("show.heading")} footer={t("show.footer", { when: when(offer.link.expires * 1000, language) })}>
        <Card style={{ alignItems: "center" }}>
          <QrCode text={offer.text} label={t("show.label")} />
        </Card>
        <View style={{ padding: space.sm, gap: space.xs }}>
          <Text variant="footnote" tone="secondary">
            {t("show.link")}
          </Text>
          <Text selectable mono variant="footnote">
            {offer.text}
          </Text>
          <View style={{ flexDirection: "row" }}>
            {/* Shared to the owner's own new device, a tablet or laptop with no camera; a share sheet that is missing or dismissed changes nothing. */}
            <Button label={t("show.share")} onPress={() => void Share.share({ message: offer.text }).catch(() => {})} />
          </View>
        </View>
      </Section>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm, paddingHorizontal: space.sm }}>
        <ActivityIndicator color={colors.secondaryLabel} />
        <Text variant="subheadline" tone="secondary" style={{ flex: 1 }}>
          {t("show.waiting")}
        </Text>
      </View>
      <Note icon="lock">{t("show.secret")}</Note>
    </Screen>
  );
}
