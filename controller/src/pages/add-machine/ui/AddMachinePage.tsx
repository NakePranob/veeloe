import { parsePairingLink, type PairingLink } from "@veeloe/protocol-ts";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { useMemo, useState, type ReactNode } from "react";
import { ScrollView, View } from "react-native";
import { describeError, useT } from "../../../shared/i18n";
import { Button, Card, CenteredStep, Field, FooterBar, Icon, QrScanner, radius, Spinner, StepNumber, Text, column, space } from "../../../shared/ui";
import { usePairMachine } from "../model/use-pair-machine";

const linkProblem = { malformed: "pairing.link_malformed", "bad-signature": "pairing.link_bad_signature", expired: "pairing.link_expired" } as const;

// The Runtime's installer, as the release publishes it (ADR 0009); a command, not words, so it is not translated.
const INSTALL = "curl -fsSL https://github.com/NakePranob/veeloe/releases/latest/download/install.sh | sh";

type OpenedParams = { link?: string; machine?: string; secret?: string; expires?: string; sig?: string };

// Expo Go hands a `link=` value whose `&` arrives unescaped, which splits the
// pairing link into separate params before this screen reads it. Rebuilding it
// from those parts keeps the same flow; a real veeloe://pair link never splits.
function openedLink({ link, machine, secret, expires, sig }: OpenedParams): string | undefined {
  if (!machine || !secret || !expires || !sig) return link;
  const hub = link?.match(/[?&]hub=([^&]+)/)?.[1];
  if (!hub) return link;
  return `veeloe://pair?hub=${hub}&machine=${machine}&secret=${secret}&expires=${expires}&sig=${sig}`;
}

export function AddMachinePage() {
  const t = useT("add-machine");
  const pair = usePairMachine();
  // Filled when the phone's camera or another app opened a veeloe://pair link.
  const params = useLocalSearchParams<OpenedParams>();
  const opened = useMemo(() => openedLink(params), [params]);
  const [start] = useState(() => (opened ? parsePairingLink(opened, Date.now()) : null));
  const [text, setText] = useState(opened ?? "");
  const [link, setLink] = useState<PairingLink | null>(start?.ok ? start.link : null);
  const [problem, setProblem] = useState<string | null>(start && !start.ok ? describeError({ code: linkProblem[start.reason] }) : null);
  const [pairing, setPairing] = useState(false);

  function accept(value: string) {
    const parsed = parsePairingLink(value, Date.now());
    if (parsed.ok) {
      setProblem(null);
      setLink(parsed.link);
    } else {
      setProblem(describeError({ code: linkProblem[parsed.reason] }));
    }
  }

  async function confirm() {
    if (!link) return;
    setProblem(null);
    setPairing(true);
    const result = await pair(link, t("confirm.prompt"));
    setPairing(false);
    if (result === null) return; // Cancelled: nothing was sent, and the question stands.
    if (result.ok) router.dismissTo("/");
    else setProblem(describeError({ code: result.code }));
  }

  const problemText = problem && (
    <View style={{ flexDirection: "row", gap: space.sm }}>
      <Icon name="warning" color="orange" />
      <Text selectable variant="subheadline" role="alert" style={{ flex: 1 }}>
        {problem}
      </Text>
    </View>
  );

  const title = <Stack.Screen options={{ title: t("title") }} />;

  if (pairing) {
    return (
      <>
        {title}
        <CenteredStep top={<Spinner size="large" />} heading={t("pairing.heading")} body={t("pairing.body")} />
      </>
    );
  }

  if (link) {
    return (
      <View style={{ flex: 1 }}>
        {title}
        <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ gap: space.lg, padding: 20, ...column }}>
          <Text variant="title" role="heading">
            {t("confirm.heading")}
          </Text>
          <Text variant="subheadline" tone="secondary">
            {t("confirm.body")}
          </Text>
          <Card style={{ gap: space.xs }}>
            <Text variant="footnote" tone="secondary">
              {t("confirm.hub")}
            </Text>
            <Text selectable mono variant="footnote" style={{ marginBottom: space.md }}>
              {link.hub}
            </Text>
            <Text variant="footnote" tone="secondary">
              {t("confirm.machine")}
            </Text>
            <Text selectable mono variant="footnote">
              {link.machine}
            </Text>
          </Card>
          {problemText}
        </ScrollView>
        <FooterBar>
          <Button
            size="large"
            label={t("confirm.cancel")}
            onPress={() => {
              setLink(null);
              setProblem(null);
            }}
          />
          <Button size="large" label={t("confirm.action")} variant="primary" onPress={() => void confirm()} />
        </FooterBar>
      </View>
    );
  }

  const step = (n: number, heading: string, children: ReactNode) => (
    <View style={{ flexDirection: "row", gap: space.md }}>
      <StepNumber n={n} />
      <View style={{ flex: 1, gap: space.sm, paddingTop: space.xxs }}>
        <Text variant="subheadline" strong>
          {heading}
        </Text>
        {children}
      </View>
    </View>
  );

  const command = (text: string) => (
    <Card style={{ paddingVertical: space.sm, borderRadius: radius.md }}>
      <Text selectable mono variant="footnote">
        {text}
      </Text>
    </Card>
  );

  return (
    <View style={{ flex: 1 }}>
      {title}
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentInsetAdjustmentBehavior="automatic"
        automaticallyAdjustKeyboardInsets
        keyboardDismissMode="interactive"
        contentContainerStyle={{ gap: 20, paddingHorizontal: 20, paddingTop: space.md, paddingBottom: space.xl, ...column }}
      >
        {/* ponytail: the board's copy button in each command needs a clipboard module (expo-clipboard) the app does not have; the commands are selectable meanwhile. */}
        {step(1, t("enter.install"), command(INSTALL))}
        {step(
          2,
          t("enter.heading"),
          <>
            {command(t("enter.command"))}
            <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
              <Spinner />
              <Text variant="footnote" tone="secondary">
                {t("enter.waiting")}
              </Text>
            </View>
          </>,
        )}
        {step(
          3,
          t("enter.body"),
          <>
            <QrScanner labels={{ scan: t("enter.scan"), stop: t("enter.stopScan"), hint: t("enter.scanHint") }} onScan={accept} onNoCamera={() => setProblem(t("enter.noCamera"))} />
            <Field label={t("enter.paste")} value={text} onChangeText={setText} placeholder="veeloe://pair?hub=…" multiline mono />
          </>,
        )}
        {problemText}
      </ScrollView>
      <FooterBar>
        <Button size="large" label={t("enter.continue")} variant="primary" disabled={!text.trim()} onPress={() => accept(text)} />
      </FooterBar>
    </View>
  );
}
