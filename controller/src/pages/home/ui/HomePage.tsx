import { router, Stack } from "expo-router";
import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Character, COLORS, type Look } from "../../../entities/character";
import { useMachines } from "../../../entities/machine";
import { useT } from "../../../shared/i18n";
import { Button, Centered, Icon, space, Text, useSplit } from "../../../shared/ui";
import { AgentInbox } from "../../../widgets/agent-inbox";

// The board's Character on the Welcome state: Veeloe's own head, not an Agent's.
const WELCOME: Look = { color: COLORS[0], shell: "box", top: "antenna", sides: "none", decal: "none" };

export function HomePage() {
  const t = useT("home");
  const machines = useMachines();
  const split = useSplit();
  const insets = useSafeAreaInsets();
  // The board's own header: "Veeloe" large on the left, Workspace and a new Agent as round buttons on the right.
  const header = (
    <>
      <Stack.Screen options={{ title: t("title"), headerShown: false }} />
      <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm, paddingTop: insets.top + space.xs, paddingLeft: 22, paddingRight: space.lg, paddingBottom: space.md }}>
        <Text variant="largeTitle" style={{ flex: 1 }}>
          {t("title")}
        </Text>
        {/* Welcome (no Machine yet) shows the name alone, as its board does. */}
        {machines && machines.length > 0 && (
          <>
            <Button label="Workspace" icon="sliders" onPress={() => router.navigate("/workspace")} />
            <Button label={t("newAgent")} icon="add" variant="primary" onPress={() => router.push("/agents/new")} />
          </>
        )}
      </View>
    </>
  );

  if (machines === null) return split ? null : header;

  // Mail with no accounts: the screen says what will be here, and how to get it there.
  if (machines.length === 0) {
    return (
      <Centered>
        {!split && header}
        <View style={{ flex: 1, alignSelf: "stretch", alignItems: "center", justifyContent: "center", gap: space.md, paddingHorizontal: space.md }}>
          <Character look={WELCOME} mood="idle" size={150} />
          <Text variant="headline" role="heading" style={{ fontSize: 22, textAlign: "center" }}>
            {t("empty.title")}
          </Text>
          <Text variant="subheadline" tone="secondary" style={{ textAlign: "center" }}>
            {t("empty.body")}
          </Text>
        </View>
        <View style={{ alignSelf: "stretch", gap: 10, paddingBottom: insets.bottom }}>
          <Button label={t("add")} variant="primary" size="large" onPress={() => router.navigate("/add-machine")} />
          <Button label={t("link")} size="large" onPress={() => router.navigate("/link")} />
        </View>
      </Centered>
    );
  }

  // In split view the inbox already sits in the sidebar, so this side waits for a choice, as Mail does.
  if (split) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: space.sm, padding: space.xl }}>
        <Icon name="inbox" size="xl" color="tertiaryLabel" />
        <Text tone="secondary" style={{ textAlign: "center" }}>
          {t("pick")}
        </Text>
      </View>
    );
  }

  return <AgentInbox header={header} />;
}
