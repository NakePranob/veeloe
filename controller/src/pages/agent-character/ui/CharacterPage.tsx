import * as Haptics from "expo-haptics";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { HeaderButton } from "expo-router/react-navigation";
import { useState, type ReactNode } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { Character, COLORS, DECALS, pick, SHELLS, shuffleLook, SIDES, TOPS, updateCharacter, useAgent, useAgents, type Agent, type Look } from "../../../entities/agent";
import { Button, column, radius, space, Text, useColors, useShadows } from "../../../shared/ui";

// The Moods the Member will see this look in, at inbox size, so they can tell they still read.
const MOODS = [
  ["idle", "ว่าง"],
  ["thinking", "คิด"],
  ["working", "ทำงาน"],
  ["waiting", "รอ"],
  ["done", "เสร็จ"],
  ["offline", "ออฟไลน์"],
] as const;

const COLOR_NAMES: Record<(typeof COLORS)[number], string> = {
  "#F4B183": "พีช",
  "#9DC3E6": "ฟ้า",
  "#A9D18E": "เสจ",
  "#C9B3E6": "ไลแลค",
  "#F2A7B8": "โรส",
  "#F3D98B": "เนย",
  "#92D5C8": "มินต์",
  "#D8C3A5": "ทราย",
};

// Every slot but the colour, with the words for each option.
const PARTS = [
  { slot: "shell", title: "เปลือก", options: SHELLS, names: { box: "กล่อง", capsule: "แคปซูล", dome: "โดม", chamfer: "เหลี่ยม" } },
  { slot: "top", title: "ด้านบน", options: TOPS, names: { none: "ไม่มี", antenna: "เสาเดี่ยว", twin: "เสาคู่", fin: "ครีบ", beacon: "ไฟสัญญาณ" } },
  { slot: "sides", title: "ด้านข้าง", options: SIDES, names: { none: "ไม่มี", ears: "น็อตหู", pods: "หูฟัง", fins: "ปีก" } },
  { slot: "decal", title: "ลายบนเปลือก", options: DECALS, names: { none: "ไม่มี", brow: "แถบคิ้ว", lights: "ไฟสามดวง", grille: "ช่องลำโพง" } },
] as const;

// A Task opened from a link has the inbox underneath (the root layout's anchor), so there is always somewhere to go back to.
const close = () => (router.canGoBack() ? router.back() : router.replace("/"));

const feel = () => {
  if (process.env.EXPO_OS === "ios") Haptics.selectionAsync();
};

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
function Option({ section, name, selected, ring, onPress, children }: { section: string; name: string; selected: boolean; ring: string; onPress: () => void; children: ReactNode }) {
  const colors = useColors();
  const shadows = useShadows();
  return (
    <Pressable role="button" aria-label={`${section} ${name}`} aria-selected={selected} accessibilityState={{ selected }} onPress={onPress}>
      {({ pressed }) => (
        <View
          style={{
            // Five to a row with their gaps still fit a 375pt screen.
            width: 62,
            alignItems: "center",
            gap: space.xs,
            paddingVertical: space.sm,
            // Keeps a long name off the coloured border.
            paddingHorizontal: space.xs,
            borderRadius: radius.lg,
            borderCurve: "continuous",
            backgroundColor: pressed ? colors.chipPressed : colors.surface,
            // Every card keeps the same border width, clear unless chosen, so choosing never shifts the grid.
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

function Editor({ agent }: { agent: Agent }) {
  const colors = useColors();
  const others = useAgents().flatMap((other) => (other.id === agent.id ? [] : [other.character]));
  // Picking changes this draft only; Done applies it, and Cancel or a swipe drops it with the screen.
  const [draft, setDraft] = useState<Look>(agent.character);
  const choose = (slot: keyof Look, value: string) => {
    feel();
    setDraft((look) => pick(look, slot, value));
  };
  return (
    <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={[column, { padding: space.lg, gap: space.xl }]}>
      <Stack.Screen
        options={{
          title: `Character ของ ${agent.name}`,
          // The Agent's name with what is being edited under it, as the Task header puts the status there.
          headerTitle: () => (
            <View style={{ alignItems: "center" }}>
              <Text variant="headline" numberOfLines={1}>
                {agent.name}
              </Text>
              <Text variant="caption" tone="secondary">
                Character
              </Text>
            </View>
          ),
          headerLeft: () => (
            <HeaderButton onPress={close} accessibilityLabel="ยกเลิก">
              <Text>ยกเลิก</Text>
            </HeaderButton>
          ),
          headerRight: () => (
            <HeaderButton
              accessibilityLabel="เสร็จ"
              onPress={() => {
                updateCharacter(agent.id, draft);
                close();
              }}
            >
              <Text strong>เสร็จ</Text>
            </HeaderButton>
          ),
        }}
      />
      <View style={{ alignItems: "center", gap: space.lg }}>
        <Character look={draft} mood="idle" size={140} />
        <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: space.sm }}>
          {MOODS.map(([mood, label]) => (
            <View key={mood} style={{ width: 48, alignItems: "center", gap: space.xs }}>
              <Character look={draft} mood={mood} size={44} />
              <Text variant="caption" tone="secondary" numberOfLines={1}>
                {label}
              </Text>
            </View>
          ))}
        </View>
      </View>
      <Section title="สี">
        {COLORS.map((color) => {
          const selected = draft.color.toLowerCase() === color.toLowerCase();
          return (
            <Pressable
              key={color}
              role="button"
              aria-label={`สี ${COLOR_NAMES[color]}`}
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
      {PARTS.map(({ slot, title, options, names }) => (
        <Section key={slot} title={title}>
          {options.map((value) => (
            <Option key={value} section={title} name={names[value as keyof typeof names]} selected={draft[slot] === value} ring={draft.color} onPress={() => choose(slot, value)}>
              <Character look={pick(draft, slot, value)} mood="idle" size={48} still />
            </Option>
          ))}
        </Section>
      ))}
      <View style={{ alignItems: "center", paddingBottom: space.lg }}>
        <Button
          label="สุ่มชิ้นส่วน"
          onPress={() => {
            feel();
            setDraft(shuffleLook(others));
          }}
        />
      </View>
      {/* Nothing here leaves the phone: the Demo Workspace keeps the look on this device. */}
      <Text variant="footnote" tone="secondary" style={{ textAlign: "center" }}>
        Demo Workspace · หน้าตาที่แก้เก็บไว้บนเครื่องนี้เท่านั้น
      </Text>
    </ScrollView>
  );
}

// Laid out like the Memoji editor in Messages: the head large on top, then each part to pick.
export function CharacterPage() {
  const { agent: id } = useLocalSearchParams<{ agent: string }>();
  const agent = useAgent(id);
  if (!agent) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: space.md, padding: space.lg }}>
        <Stack.Screen
          options={{
            title: "Character",
            headerLeft: () => (
              <HeaderButton onPress={close} accessibilityLabel="ปิด">
                <Text>ปิด</Text>
              </HeaderButton>
            ),
          }}
        />
        <Text tone="secondary">ไม่พบ Agent นี้</Text>
        <Button label="กลับไป Inbox" onPress={() => router.replace("/")} />
      </View>
    );
  }
  // Keyed by the Agent so a draft never carries over to another one.
  return <Editor key={agent.id} agent={agent} />;
}
