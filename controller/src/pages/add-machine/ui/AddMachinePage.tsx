import { parsePairingLink, type PairingLink } from "@veeloe/protocol-ts";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { useMemo, useState, type ReactNode } from "react";
import { ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { describeError, useT } from "../../../shared/i18n";
import { Button, Card, Field, Icon, QrScanner, Spinner, StepNumber, Text, column, space } from "../../../shared/ui";
import { usePairMachine } from "../model/use-pair-machine";

const linkProblem = { malformed: "pairing.link_malformed", "bad-signature": "pairing.link_bad_signature", expired: "pairing.link_expired" } as const;

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
  const insets = useSafeAreaInsets();
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
  const foot = (children: ReactNode) => <View style={{ flexDirection: "row", gap: 10, paddingHorizontal: space.lg, paddingTop: space.sm, paddingBottom: insets.bottom + space.sm, ...column }}>{children}</View>;
  const wide = (button: ReactNode) => <View style={{ flex: 1 }}>{button}</View>;

  if (pairing) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: space.md, paddingHorizontal: 36 }}>
        {title}
        <Spinner size="large" />
        <Text variant="headline" role="heading" style={{ fontSize: 22, textAlign: "center" }}>
          {t("pairing.heading")}
        </Text>
        <Text variant="subheadline" tone="secondary" style={{ textAlign: "center" }}>
          {t("pairing.body")}
        </Text>
      </View>
    );
  }

  if (link) {
    return (
      <View style={{ flex: 1 }}>
        {title}
        <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ gap: space.lg, padding: 20, ...column }}>
          <Text variant="headline" role="heading" style={{ fontSize: 22 }}>
            {t("confirm.heading")}
          </Text>
          <Text variant="subheadline" tone="secondary">
            {t("confirm.body")}
          </Text>
          <Card style={{ gap: space.xs }}>
            <Text variant="footnote" tone="secondary">
              {t("confirm.hub")}
            </Text>
            <Text selectable mono variant="footnote" style={{ marginBottom: 10 }}>
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
        {foot(
          <>
            {wide(
              <Button
                size="large"
                label={t("confirm.cancel")}
                onPress={() => {
                  setLink(null);
                  setProblem(null);
                }}
              />,
            )}
            {wide(<Button size="large" label={t("confirm.action")} variant="primary" onPress={() => void confirm()} />)}
          </>,
        )}
      </View>
    );
  }

  const step = (n: number, heading: string, children: ReactNode) => (
    <View style={{ flexDirection: "row", gap: space.md }}>
      <StepNumber n={n} />
      <View style={{ flex: 1, gap: space.sm, paddingTop: 2 }}>
        <Text variant="subheadline" strong>
          {heading}
        </Text>
        {children}
      </View>
    </View>
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
        {step(
          1,
          t("enter.heading"),
          <Card style={{ paddingVertical: space.sm }}>
            <Text selectable mono variant="footnote">
              {t("enter.command")}
            </Text>
          </Card>,
        )}
        {step(
          2,
          t("enter.body"),
          <>
            <QrScanner labels={{ scan: t("enter.scan"), stop: t("enter.stopScan") }} onScan={accept} onNoCamera={() => setProblem(t("enter.noCamera"))} />
            <Field label={t("enter.paste")} value={text} onChangeText={setText} placeholder="veeloe://pair?hub=…" multiline mono />
          </>,
        )}
        {problemText}
      </ScrollView>
      {foot(wide(<Button size="large" label={t("enter.continue")} variant="primary" disabled={!text.trim()} onPress={() => accept(text)} />))}
    </View>
  );
}
