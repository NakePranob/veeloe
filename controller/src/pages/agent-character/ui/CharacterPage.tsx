import { router, Stack, useLocalSearchParams } from "expo-router";
import { useEffect, useState, type ReactNode } from "react";
import { View } from "react-native";
import { useAgents, type AgentRow } from "../../../entities/agent";
import { Character, COLOR_NAMES, COLORS, DECALS, LookTile, lookOfJson, MoodTile, pick, SHELLS, shuffleLook, SIDES, Stage, Swatch, TOPS, type Look, type Mood } from "../../../entities/character";
import { useMachines } from "../../../entities/machine";
import { useMachineLink, useMachineStatus } from "../../../features/machine-link";
import { describeError, useT } from "../../../shared/i18n";
import { Button, Card, HeaderAction, Note, Screen, space, Spinner, Text } from "../../../shared/ui";
import { characterToSend } from "../model/to-send";

// The Moods the Member will see this look in, at inbox size, so they can tell they still read.
// ponytail: the board previews six; failed and stuck draw on the Inbox but are left out here, as on the board.
const MOODS = ["idle", "thinking", "working", "waiting", "done", "offline"] as const satisfies readonly Mood[];

// Every slot but the colour.
const PARTS = [
  { slot: "shell", options: SHELLS },
  { slot: "top", options: TOPS },
  { slot: "sides", options: SIDES },
  { slot: "decal", options: DECALS },
] as const;

// A page opened from a link has the inbox underneath (the root layout's anchor), so there is always somewhere to go back to.
/** How long a save waits for the Machine's answer before the page lets it go. */
const SAVE_ANSWER_MS = 15_000;

const close = () => (router.canGoBack() ? router.back() : router.replace("/"));

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={{ gap: space.sm }}>
      <Text variant="footnote" strong tone="secondary" role="heading" style={{ paddingHorizontal: space.xs }}>
        {title}
      </Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>{children}</View>
    </View>
  );
}

function Editor({ agent, others }: { agent: AgentRow; others: Look[] }) {
  const t = useT("agent-character");
  const link = useMachineLink();
  const machine = useMachines()?.find((m) => m.id === agent.machine_id);
  const status = useMachineStatus(agent.machine_id);
  // Picking changes this draft only; Done sends it, and Cancel or a swipe drops it with the screen.
  const [draft, setDraft] = useState<Look>(() => lookOfJson(agent.character));
  // Only the slots touched go back changed, so a part this build does not know stays (ADR 0023).
  const [touched, setTouched] = useState<ReadonlySet<keyof Look>>(new Set());
  // What went, kept as JSON: compared by the look this build draws from it.
  const [sent, setSent] = useState<string | null>(null);
  const [tried, setTried] = useState(false);
  const [notSent, setNotSent] = useState(false);
  // Which Mood the large head shows, picked from the row of Moods under it.
  const [preview, setPreview] = useState<Mood>("idle");
  const offline = status.online === false || !link || notSent;

  // Closes once the Machine lists the new look (ADR 0006), and stays open on an error.
  useEffect(() => {
    if (sent && JSON.stringify(lookOfJson(agent.character)) === JSON.stringify(lookOfJson(sent))) close();
  }, [sent, agent.character]);
  useEffect(() => {
    if (status.updateError) setSent(null);
  }, [status.updateError]);
  // A send that found no link is tried again once the link or the Machine changes, and a save the Machine
  // never answers, or one cut off by the Machine going away, is let go rather than locking the page.
  useEffect(() => setNotSent(false), [link, status.online]);
  useEffect(() => {
    if (sent === null) return;
    if (status.online === false) return setSent(null);
    const timer = setTimeout(() => setSent(null), SAVE_ANSWER_MS);
    return () => clearTimeout(timer);
  }, [sent, status.online]);

  const choose = (slot: keyof Look, value: string) => {
    setDraft((look) => pick(look, slot, value));
    setTouched((all) => new Set(all).add(slot));
  };

  function done() {
    if (touched.size === 0) return close();
    if (!link || !machine) return;
    const character = characterToSend(agent.character, draft, touched);
    setTried(true);
    if (!link.updateAgent(machine, { id: agent.id, character })) return setNotSent(true);
    setSent(JSON.stringify(character));
  }

  // The parts it wears, under the head, as the board names them; an empty slot says nothing.
  const summary = PARTS.filter(({ slot }) => draft[slot] !== "none")
    .map(({ slot }) => t(`parts.${slot}.${draft[slot]}` as never) as string)
    .join(" · ");
  // What is being edited, with whose Character under it, as the board's header reads.
  return (
    <Screen title={t("title")} subtitle={t("titleOf", { name: agent.name })}>
      <HeaderAction label={t("cancel")} placement="left" onPress={close} />
      <HeaderAction label={t("done")} onPress={done} disabled={!!sent || offline} />
      {/* The head large on a stage of its colour under the header, the shuffle floating beside it, and the Moods to preview. */}
      <Stage color={draft.color} bleed>
        <View style={{ alignSelf: "stretch", alignItems: "center", gap: space.xs }}>
          <Character look={draft} mood={preview} size={150} />
          <View style={{ position: "absolute", right: space.lg, top: space.xl }}>
            <Button
              label={t("shuffle")}
              icon="shuffle"
              variant="floating"
              onPress={() => {
                setDraft(shuffleLook(others));
                setTouched(new Set(["color", "shell", "top", "sides", "decal"]));
              }}
            />
          </View>
          {!!summary && (
            <Text variant="footnote" strong tone="body">
              {summary}
            </Text>
          )}
        </View>
        <Card raised style={{ alignSelf: "stretch", flexDirection: "row", justifyContent: "space-between", gap: 0, paddingVertical: space.sm, paddingHorizontal: 6 }}>
          {MOODS.map((mood) => (
            <MoodTile key={mood} color={draft.color} label={t(`moods.${mood}`)} selected={preview === mood} onPress={() => setPreview(mood)}>
              <Character look={draft} mood={mood} size={38} still />
            </MoodTile>
          ))}
        </Card>
      </Stage>
      {offline && (
        <Note icon="offline" iconColor="orange">
          {t("offline")}
        </Note>
      )}
      {sent && (
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: space.sm }}>
          <Spinner />
          <Text variant="footnote" tone="secondary">
            {t("saving")}
          </Text>
        </View>
      )}
      {tried && status.updateError && !sent && (
        <Note icon="warning" iconColor="orange">
          {describeError({ code: status.updateError })}
        </Note>
      )}
      <Group title={t("color")}>
        <Card style={{ flex: 1, flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", padding: space.md }}>
          {COLORS.map((color, i) => (
            <Swatch key={color} color={color} label={t("colorOption", { name: t(`colors.${COLOR_NAMES[i]}`) })} selected={draft.color.toLowerCase() === color.toLowerCase()} onPress={() => choose("color", color)} />
          ))}
        </Card>
      </Group>
      {PARTS.map(({ slot, options }) => (
        <Group key={slot} title={t(`slots.${slot}`)}>
          {options.map((value) => {
            const name = t(`parts.${slot}.${value}` as never) as string;
            return (
              <LookTile key={value} color={draft.color} label={t("option", { slot: t(`slots.${slot}`), name })} name={name} selected={draft[slot] === value} onPress={() => choose(slot, value)}>
                <Character look={pick(draft, slot, value)} mood="idle" size={48} still />
              </LookTile>
            );
          })}
        </Group>
      ))}
    </Screen>
  );
}

// The AgentCharacter board, laid out like the Memoji editor in Messages: the head large on top, then each part to pick.
// Done waits for the Machine's answer before it closes, since the look is the Machine's to keep (ADR 0006).
export function CharacterPage() {
  const t = useT("agent-character");
  const { agent: id } = useLocalSearchParams<{ agent: string }>();
  const agents = useAgents();
  const agent = agents?.find((a) => a.id === id);
  if (!agent) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: space.md, padding: space.lg }}>
        <Stack.Screen options={{ title: t("title") }} />
        <HeaderAction label={t("close")} placement="left" onPress={close} />
        {agents && <Text tone="secondary">{t("missing")}</Text>}
        {agents && <Button label={t("backToInbox")} onPress={() => router.replace("/")} />}
      </View>
    );
  }
  // Keyed by the Agent so a draft never carries over to another one.
  return <Editor key={agent.id} agent={agent} others={agents!.flatMap((a) => (a.id === agent.id ? [] : [lookOfJson(a.character)]))} />;
}
