import { router, Stack, useLocalSearchParams } from "expo-router";
import { useEffect, useState, type ReactNode } from "react";
import { ActivityIndicator, Pressable, ScrollView, View } from "react-native";
import { useAgents, type AgentRow } from "../../../entities/agent";
import { Character, COLORS, DECALS, lookOfJson, pick, SHELLS, shuffleLook, SIDES, TOPS, type Look } from "../../../entities/character";
import { useMachines } from "../../../entities/machine";
import { useMachineLink, useMachineStatus } from "../../../features/machine-link";
import { describeError, useT } from "../../../shared/i18n";
import { Button, column, HeaderAction, Note, radius, space, Text, useColors, useShadows } from "../../../shared/ui";
import { characterToSend } from "../model/to-send";

// The Moods the Member will see this look in, at inbox size, so they can tell they still read.
// ponytail: the prototype's "waiting" comes with Approval (approval-and-allowlist).
const MOODS = ["idle", "thinking", "working", "done", "offline"] as const;

const COLOR_NAMES: Record<(typeof COLORS)[number], "peach" | "sky" | "sage" | "lilac" | "rose" | "butter" | "mint" | "sand"> = {
  "#F4B183": "peach",
  "#9DC3E6": "sky",
  "#A9D18E": "sage",
  "#C9B3E6": "lilac",
  "#F2A7B8": "rose",
  "#F3D98B": "butter",
  "#92D5C8": "mint",
  "#D8C3A5": "sand",
};

// Every slot but the colour.
const PARTS = [
  { slot: "shell", options: SHELLS },
  { slot: "top", options: TOPS },
  { slot: "sides", options: SIDES },
  { slot: "decal", options: DECALS },
] as const;

// A page opened from a link has the inbox underneath (the root layout's anchor), so there is always somewhere to go back to.
const close = () => (router.canGoBack() ? router.back() : router.replace("/"));

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={{ gap: space.sm }}>
      <Text variant="subheadline" tone="secondary" role="heading">
        {title}
      </Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>{children}</View>
    </View>
  );
}

// One option: the head wearing it on a card, its name under it. The chosen one is ringed in the Character's colour.
function Option({ label, name, selected, ring, onPress, children }: { label: string; name: string; selected: boolean; ring: string; onPress: () => void; children: ReactNode }) {
  const colors = useColors();
  const shadows = useShadows();
  return (
    <Pressable role="button" aria-label={label} aria-selected={selected} accessibilityState={{ selected }} onPress={onPress}>
      {({ pressed }) => (
        <View
          style={{
            // Five to a row with their gaps still fit a 375pt screen.
            width: 62,
            alignItems: "center",
            gap: space.xs,
            paddingVertical: space.sm,
            // Keeps a long name off the coloured ring.
            paddingHorizontal: space.xs,
            borderRadius: radius.lg,
            borderCurve: "continuous",
            backgroundColor: pressed ? colors.chipPressed : colors.surface,
            // Every card keeps the same ring width, clear unless chosen, so choosing never shifts the grid.
            borderWidth: 2,
            borderColor: selected ? ring : "transparent",
            boxShadow: shadows.card,
          }}
        >
          {children}
          {/* Android's Thai is wider than iOS's: a long name shrinks a little before it is cut. */}
          <Text variant="caption" tone={selected ? "label" : "secondary"} strong={selected} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>
            {name}
          </Text>
        </View>
      )}
    </Pressable>
  );
}

function Editor({ agent, others }: { agent: AgentRow; others: Look[] }) {
  const t = useT("agent-character");
  const colors = useColors();
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
  const offline = status.online === false || !link || notSent;

  // Closes once the Machine lists the new look (ADR 0006), and stays open on an error.
  useEffect(() => {
    if (sent && JSON.stringify(lookOfJson(agent.character)) === JSON.stringify(lookOfJson(sent))) close();
  }, [sent, agent.character]);
  useEffect(() => {
    if (status.updateError) setSent(null);
  }, [status.updateError]);

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

  return (
    <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={[column, { padding: space.lg, gap: space.xl }]}>
      <Stack.Screen
        options={{
          title: t("titleOf", { name: agent.name }),
          // The Agent's name with what is being edited under it, as the Task header puts the status there.
          headerTitle: () => (
            <View style={{ alignItems: "center" }}>
              <Text variant="headline" numberOfLines={1}>
                {agent.name}
              </Text>
              <Text variant="caption" tone="secondary">
                {t("title")}
              </Text>
            </View>
          ),
        }}
      />
      <HeaderAction label={t("cancel")} placement="left" onPress={close} />
      <HeaderAction label={t("done")} onPress={done} disabled={!!sent || offline} />
      {offline && (
        <Note icon="offline" iconColor="orange">
          {t("offline")}
        </Note>
      )}
      {sent && (
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: space.sm }}>
          <ActivityIndicator color={colors.secondaryLabel} />
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
      <View style={{ alignItems: "center", gap: space.lg }}>
        <Character look={draft} mood="idle" size={140} />
        <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: space.sm }}>
          {MOODS.map((mood) => (
            <View key={mood} style={{ width: 56, alignItems: "center", gap: space.xs }}>
              <Character look={draft} mood={mood} size={44} />
              <Text variant="caption" tone="secondary" numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>
                {t(`moods.${mood}`)}
              </Text>
            </View>
          ))}
        </View>
      </View>
      <Section title={t("color")}>
        {COLORS.map((color) => {
          const selected = draft.color.toLowerCase() === color.toLowerCase();
          return (
            <Pressable
              key={color}
              role="button"
              aria-label={t("colorOption", { name: t(`colors.${COLOR_NAMES[color]}`) })}
              aria-selected={selected}
              accessibilityState={{ selected }}
              onPress={() => choose("color", color)}
              // 34 plus 5 on each side clears the 44pt target.
              hitSlop={5}
            >
              {/* The chosen colour is ringed in ink, a gap of screen between, so it reads on any pastel in either theme. */}
              <View
                style={{
                  width: 34,
                  height: 34,
                  borderRadius: radius.pill,
                  backgroundColor: color,
                  boxShadow: selected ? `0 0 0 3px ${colors.background}, 0 0 0 5px ${colors.label}` : undefined,
                }}
              />
            </Pressable>
          );
        })}
      </Section>
      {PARTS.map(({ slot, options }) => (
        <Section key={slot} title={t(`slots.${slot}`)}>
          {options.map((value) => {
            const name = t(`parts.${slot}.${value}` as never) as string;
            return (
              <Option key={value} label={t("option", { slot: t(`slots.${slot}`), name })} name={name} selected={draft[slot] === value} ring={draft.color} onPress={() => choose(slot, value)}>
                <Character look={pick(draft, slot, value)} mood="idle" size={48} still />
              </Option>
            );
          })}
        </Section>
      ))}
      <View style={{ alignItems: "center", paddingBottom: space.lg }}>
        <Button
          label={t("shuffle")}
          onPress={() => {
            setDraft(shuffleLook(others));
            setTouched(new Set(["color", "shell", "top", "sides", "decal"]));
          }}
        />
      </View>
    </ScrollView>
  );
}

// controller-prototype's CharacterPage, laid out like the Memoji editor in Messages: the head large on top, then each part to pick.
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
