import { parsePairingLink, type PairingLink } from "@veeloe/protocol";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, ScrollView, TextInput, View } from "react-native";
import { describeError, useT } from "../../../shared/i18n";
import { Button, Card, column, Icon, QrScanner, radius, space, Text, useColors } from "../../../shared/ui";
import { usePairMachine } from "../model/use-pair-machine";

const linkProblem = { malformed: "pairing.link_malformed", "bad-signature": "pairing.link_bad_signature", expired: "pairing.link_expired" } as const;

export function AddMachinePage() {
  const t = useT("add-machine");
  const colors = useColors();
  const pair = usePairMachine();
  // Filled when the phone's camera or another app opened a veeloe://pair link.
  const { link: opened } = useLocalSearchParams<{ link?: string }>();
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

  return (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      contentInsetAdjustmentBehavior="automatic"
      automaticallyAdjustKeyboardInsets
      keyboardDismissMode="interactive"
      contentContainerStyle={{ gap: space.lg, padding: space.xl, ...column }}
    >
      <Stack.Screen options={{ title: t("title") }} />
      {pairing ? (
        <View style={{ alignItems: "center", gap: space.sm, paddingVertical: space.xl }}>
          <ActivityIndicator color={colors.secondaryLabel} />
          <Text variant="headline" role="heading">
            {t("pairing.heading")}
          </Text>
          <Text variant="subheadline" tone="secondary" style={{ textAlign: "center" }}>
            {t("pairing.body")}
          </Text>
        </View>
      ) : link ? (
        <>
          <View style={{ gap: space.xs }}>
            <Text variant="headline" role="heading">
              {t("confirm.heading")}
            </Text>
            <Text variant="subheadline" tone="secondary">
              {t("confirm.body")}
            </Text>
          </View>
          <Card>
            <Text variant="footnote" tone="secondary">
              {t("confirm.hub")}
            </Text>
            <Text selectable mono>
              {link.hub}
            </Text>
            <Text variant="footnote" tone="secondary">
              {t("confirm.machine")}
            </Text>
            <Text selectable mono>
              {link.machine}
            </Text>
          </Card>
          {problemText}
          <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: space.sm }}>
            <Button
              label={t("confirm.cancel")}
              onPress={() => {
                setLink(null);
                setProblem(null);
              }}
            />
            <Button label={t("confirm.action")} variant="primary" onPress={() => void confirm()} />
          </View>
        </>
      ) : (
        <>
          <View style={{ gap: space.xs }}>
            <Text variant="headline" role="heading">
              {t("enter.heading")}
            </Text>
            <Text selectable mono>
              {t("enter.command")}
            </Text>
            <Text variant="subheadline" tone="secondary">
              {t("enter.body")}
            </Text>
          </View>
          <QrScanner labels={{ scan: t("enter.scan"), stop: t("enter.stopScan") }} onScan={accept} onNoCamera={() => setProblem(t("enter.noCamera"))} />
          <TextInput
            aria-label={t("enter.paste")}
            placeholder={t("enter.paste")}
            placeholderTextColor={colors.tertiaryLabel}
            value={text}
            onChangeText={setText}
            autoCapitalize="none"
            autoCorrect={false}
            spellCheck={false}
            multiline
            style={{ minHeight: 96, padding: space.md, borderRadius: radius.card, borderCurve: "continuous", backgroundColor: colors.surface, color: colors.label, textAlignVertical: "top" }}
          />
          {problemText}
          <View style={{ flexDirection: "row", justifyContent: "flex-end" }}>
            <Button label={t("enter.continue")} variant="primary" disabled={!text.trim()} onPress={() => accept(text)} />
          </View>
        </>
      )}
    </ScrollView>
  );
}
