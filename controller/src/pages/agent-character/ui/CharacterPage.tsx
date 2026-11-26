import { router, Stack, useLocalSearchParams } from "expo-router";
import { useState, type ReactNode } from "react";
import { View } from "react-native";
import { useAgents, type AgentRow } from "../../../entities/agent";
import { Character, COLOR_NAMES, COLORS, DECALS, LookTile, lookOfJson, MoodTile, pick, SHELLS, shuffleLook, SIDES, Stage, Swatch, TOPS, type Look, type Mood } from "../../../entities/character";
import { useAgentUpdate } from "../../../features/machine-link";
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
  // Every part's name by slot, as one object: a slot and a value read from it need no key built from both.
  const partNames: Record<string, Record<string, string>> = t("parts", { returnObjects: true });
  // Picking changes this draft only; Done sends it, and Cancel or a swipe drops it with the screen.
  const [draft, setDraft] = useState<Look>(() => lookOfJson(agent.character));
  // Only the slots touched go back changed, so a part this build does not know stays (ADR 0023).
  const [touched, setTouched] = useState<ReadonlySet<keyof Look>>(new Set());
  // Closes once the Machine lists the new look (ADR 0006), compared by the look this build draws, and stays open on an error.
  const save = useAgentUpdate(agent, {
    landed: (row, sent) => JSON.stringify(lookOfJson(row.character)) === JSON.stringify(lookOfJson(JSON.stringify(sent.character))),
    onLanded: close,
  });
  // Which Mood the large head shows, picked from the row of Moods under it.
  const [preview, setPreview] = useState<Mood>("idle");
  const offline = save.offline;

  const choose = (slot: keyof Look, value: string) => {
    setDraft((look) => pick(look, slot, value));
    setTouched((all) => new Set(all).add(slot));
  };

  function done() {
    if (touched.size === 0) return close();
    save.send({ character: characterToSend(agent.character, draft, touched) });
  }

  // The parts it wears, under the head, as the board names them; an empty slot says nothing.
  const summary = PARTS.filter(({ slot }) => draft[slot] !== "none")
    .map(({ slot }) => partNames[slot][draft[slot]])
    .join(" · ");
  // What is being edited, with whose Character under it, as the board's header reads.
  return (
    <Screen title={t("title")} subtitle={t("titleOf", { name: agent.name })}>
      <HeaderAction label={t("cancel")} placement="left" onPress={close} />
      <HeaderAction label={t("done")} onPress={done} disabled={save.sending || offline} />
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
        <Card raised style={{ alignSelf: "stretch", flexDirection: "row", justifyContent: "space-between", gap: 0, paddingVertical: space.sm, paddingHorizontal: space.smd }}>
          {MOODS.map((mood) => (
            <MoodTile key={mood} color={draft.color} label={t(`moods.${mood}`)} selected={preview === mood} onPress={() => setPreview(mood)}>
              <Character look={draft} mood={mood} size={38} still />
            </MoodTile>
          ))}
        </Card>
      </Stage>
      {offline && <Note tone="offline">{t("offline")}</Note>}
      {save.sending && (
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: space.sm }}>
          <Spinner />
          <Text variant="footnote" tone="secondary">
            {t("saving")}
          </Text>
        </View>
      )}
      {save.error && (
        <Note icon="warning" iconColor="orange">
          {describeError({ code: save.error })}
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
            const name = partNames[slot][value];
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
  if (!agents || !agent) {
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
  return <Editor key={agent.id} agent={agent} others={agents.flatMap((a) => (a.id === agent.id ? [] : [lookOfJson(a.character)]))} />;
}
