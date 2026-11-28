import type { InvitationLink } from "@veeloe/protocol-ts";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { ScrollView, View } from "react-native";
import { saveMachine } from "../../../entities/machine";
import { useDatabase } from "../../../shared/db";
import { describeError, useLanguage, useT } from "../../../shared/i18n";
import { keySession } from "../../../shared/keystore";
import { when } from "../../../shared/lib";
import { Button, Card, CenteredStep, Field, FooterBar, inform, Note, Row, Spinner, Text, column, space } from "../../../shared/ui";
import { askToJoin, ownCode, readInvitation } from "../model/join";

type Waiting = ReturnType<typeof askToJoin>;

// The invited person's side of an Invitation (ADR 0059), laid out as Link this device: the link,
// then a name, then the code to read out to the inviter while this device waits to be let in.
export function JoinPage() {
  const t = useT("join");
  const language = useLanguage();
  const database = useDatabase();
  // Filled when another app opened a veeloe://invite link.
  const { link: opened } = useLocalSearchParams<{ link?: string }>();
  const [text, setText] = useState(opened ?? "");
  const [link, setLink] = useState<InvitationLink | null>(null);
  const [name, setName] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [waiting, setWaiting] = useState<{ wait: Waiting; code: string } | null>(null);
  const current = useRef<Waiting | null>(null);

  // Leaving the page stops asking.
  useEffect(() => () => current.current?.stop(), []);

  function accept(value: string) {
    const read = readInvitation(value);
    if (!read.ok) return setProblem(describeError({ code: read.code }));
    setProblem(null);
    setLink(read.link);
  }

  // A link that opened the app goes straight to the name, once.
  // biome-ignore lint/correctness/useExhaustiveDependencies: once on open, by design
  useEffect(() => void (opened && accept(opened)), []);

  async function ask() {
    if (!link) return;
    if (!name.trim()) return inform(t("cannot"), t("name.empty"));
    const secretKey = keySession.secretKey();
    if (!secretKey) return;
    // ponytail: a copy for the wait, as Linking keeps one, since the session's own is zeroed if the app locks.
    const signingKey = secretKey.slice();
    const wait = askToJoin({ link, name, secretKey: signingKey });
    current.current = wait;
    setProblem(null);
    setWaiting({ wait, code: ownCode(signingKey) });
    const result = await wait.done;
    signingKey.fill(0);
    if (current.current !== wait) return;
    current.current = null;
    setWaiting(null);
    if (!result.ok) return setProblem(describeError({ code: result.code }));
    const { workspace, member, machines } = result.data;
    for (const m of machines) await saveMachine(database, { id: m.id, public_key: m.key, name: m.name, hub_url: m.hub, workspace_id: workspace, member_id: member, paired_at: Date.now() });
    router.dismissTo("/");
  }

  const problemText = problem && (
    <Note icon="warning" iconColor="orange">
      {problem}
    </Note>
  );
  const title = <Stack.Screen options={{ title: t("title") }} />;
  const scroll = { contentInsetAdjustmentBehavior: "automatic", keyboardShouldPersistTaps: "handled", automaticallyAdjustKeyboardInsets: true, keyboardDismissMode: "interactive" } as const;

  if (waiting && link) {
    return (
      <>
        {title}
        <CenteredStep top={<Spinner size="large" />} heading={t("waiting.heading", { from: link.from })} body={t("waiting.body", { from: link.from })}>
          <Text variant="largeTitle" mono selectable>
            {waiting.code}
          </Text>
          <Text variant="footnote" tone="secondary">
            {t("waiting.footer", { when: when(link.expires * 1000, language) })}
          </Text>
        </CenteredStep>
      </>
    );
  }

  if (link) {
    return (
      <View style={{ flex: 1 }}>
        {title}
        <ScrollView {...scroll} contentContainerStyle={{ gap: space.md, padding: 20, ...column }}>
          <Text variant="title" role="heading">
            {t("name.heading", { from: link.from })}
          </Text>
          <Field label={t("name.label")} value={name} onChangeText={setName} />
          {/* Where this device will connect, from the link: someone running their own Hub sees it is theirs. */}
          <Card style={{ padding: 0 }}>
            <Row icon="network" title={t("hub")} value={link.hub} />
          </Card>
          <Text variant="footnote" tone="secondary">
            {t("name.footer", { from: link.from })}
          </Text>
          {problemText}
        </ScrollView>
        <FooterBar>
          <Button
            size="large"
            label={t("back")}
            onPress={() => {
              setLink(null);
              setProblem(null);
            }}
          />
          <Button size="large" label={t("send")} variant="primary" onPress={() => void ask()} />
        </FooterBar>
      </View>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      {title}
      <ScrollView {...scroll} contentContainerStyle={{ gap: space.md, paddingHorizontal: 20, paddingTop: space.smd, paddingBottom: space.lg, ...column }}>
        <Text variant="subheadline" strong>
          {t("enter.heading")}
        </Text>
        <Field label={t("enter.paste")} value={text} onChangeText={setText} placeholder="veeloe://invite?…" multiline mono />
        <Text variant="footnote" tone="secondary">
          {t("enter.footer")}
        </Text>
        {problemText}
      </ScrollView>
      <FooterBar>
        <Button size="large" label={t("enter.continue")} variant="primary" disabled={!text.trim()} onPress={() => accept(text)} />
      </FooterBar>
    </View>
  );
}
