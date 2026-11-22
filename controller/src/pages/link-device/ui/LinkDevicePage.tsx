import { router, Stack } from "expo-router";
import { useEffect, useState } from "react";
import { ScrollView, Share, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { listDevices, nameProblem, useDevices } from "../../../entities/device";
import { useMachines } from "../../../entities/machine";
import { useMachineLink } from "../../../features/machine-link";
import { useDatabase } from "../../../shared/db";
import { describeError, useLanguage, useT } from "../../../shared/i18n";
import { keySession } from "../../../shared/keystore";
import { clock, useNow, when } from "../../../shared/lib";
import { Button, Card, CenteredStep, Chip, Field, FooterBar, IconDisc, Note, QrCode, radius, Screen, Spinner, Text, column, inform, space } from "../../../shared/ui";
import { approveLink, handOff, handoffData, openLink, type LinkAsk, type OpenLink } from "../model/link";

// controller-prototype's DeviceLinkPage on the device that is already in the Workspace: show a QR
// that carries this device's Hub, as `veeloe pair` does, then approve the request the new device
// sends back, authenticate and sign (ADR 0013, 0031). The new device never asks for a Hub.
export function LinkDevicePage() {
  const t = useT("link-device");
  const insets = useSafeAreaInsets();
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
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs when a connection or Hub appears; a new offer must not start another
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
    const machine = machines.find((m) => m.hub_url === offer.link.hub);
    if (!machine) return;
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

  const title = <Stack.Screen options={{ title: t("title") }} />;

  if (machines && !hub) {
    return (
      <Screen title={t("title")}>
        <Note icon="info">{t("noHub")}</Note>
      </Screen>
    );
  }

  if (sending)
    return (
      <>
        {title}
        <CenteredStep top={<Spinner size="large" />} heading={t("sending.heading")} body={t("sending.body")} />
      </>
    );

  if (ask) {
    return (
      <View style={{ flex: 1 }}>
        {title}
        <ScrollView contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets contentContainerStyle={{ gap: space.md, padding: 20, ...column }}>
          <Text variant="title" role="heading">
            {t("ask.heading")}
          </Text>
          <Field label={t("ask.label")} value={name} onChangeText={setName} />
          <Note icon="warning" iconColor="orange">
            {t("ask.footer")}
          </Note>
          {problemText}
        </ScrollView>
        {/* Back to a QR: the one shown was spent on this request, so it is a fresh one (single use, ADR 0031). */}
        <FooterBar>
          <Button size="large" label={t("cancel")} onPress={fresh} />
          <Button size="large" label={t("approve")} variant="primary" onPress={() => void approve()} />
        </FooterBar>
      </View>
    );
  }

  if (!offer) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
        {title}
        <Spinner />
      </View>
    );
  }

  if (expired) {
    return (
      <>
        {title}
        <CenteredStep
          top={<IconDisc icon="time" />}
          heading={t("expired")}
          body={t("expiredBody")}
          footer={
            <FooterBar>
              <Button size="large" label={t("again")} variant="primary" onPress={fresh} />
            </FooterBar>
          }
        />
      </>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      {title}
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ alignItems: "center", gap: space.md, paddingHorizontal: 20, paddingTop: space.smd, paddingBottom: space.lg, ...column }}>
        <Text variant="subheadline" style={{ textAlign: "center" }}>
          {t("show.heading")}
        </Text>
        <Card style={{ alignItems: "center", borderRadius: radius.lg, gap: space.md }}>
          <QrCode text={offer.text} label={t("show.label")} />
          {/* ponytail: the board's short code ("K7F-29Q") beside the timer needs a code the Hub's Linking does not issue; add it with one. */}
          <Countdown until={offer.link.expires * 1000} />
        </Card>
        <Text variant="footnote" tone="secondary" style={{ textAlign: "center" }}>
          {t("show.footer", { when: when(offer.link.expires * 1000, language) })}
        </Text>
        <Note icon="lock" iconColor="orange">
          {t("show.secret")}
        </Note>
        <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm, minHeight: 44 }}>
          <Spinner />
          <Text variant="subheadline" tone="secondary">
            {t("show.waiting")}
          </Text>
        </View>
      </ScrollView>
      <View style={{ gap: space.sm, paddingHorizontal: space.lg, paddingTop: space.xs, paddingBottom: insets.bottom + space.sm, ...column }}>
        <Text variant="footnote" tone="secondary" style={{ textAlign: "center" }}>
          {t("show.link")}
        </Text>
        {/* Shared to the owner's own new device, a tablet or laptop with no camera; a share sheet that is missing or dismissed changes nothing. */}
        <Button size="large" leading="share" label={t("show.share")} onPress={() => void Share.share({ message: offer.text }).catch(() => {})} />
      </View>
    </View>
  );
}

// The white pill on the QR card counting down to the QR's expiry; the page's own timer turns it into the expired step at 0.
function Countdown({ until }: { until: number }) {
  const t = useT("link-device");
  const now = useNow(1000);
  const seconds = Math.max(0, Math.ceil((until - now) / 1000));
  const left = clock(seconds * 1000);
  return (
    <View role="timer" aria-label={t("show.expiresIn", { left })}>
      <Chip tone="mono" icon="time" label={left} />
    </View>
  );
}
