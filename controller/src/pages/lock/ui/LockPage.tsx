import { useEffect } from "react";
import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Character, COLORS, type Look } from "../../../entities/character";
import { useT } from "../../../shared/i18n";
import { keySession } from "../../../shared/keystore";
import { Button, Centered, Text, space } from "../../../shared/ui";

// The board's Character: Veeloe's own head, not an Agent's.
const LOOK: Look = { color: COLORS[0], shell: "box", top: "antenna", sides: "none", decal: "none" };

// Asks for Face ID or the fingerprint at once; the button asks again after a cancel.
export function LockPage() {
  const t = useT("lock");
  const insets = useSafeAreaInsets();
  const prompt = t("prompt");

  useEffect(() => {
    void keySession.unlock(prompt);
  }, [prompt]);

  return (
    <Centered>
      <View style={{ flex: 1, alignSelf: "stretch", alignItems: "center", justifyContent: "center", gap: space.md, paddingHorizontal: space.md }}>
        <Character look={LOOK} mood="idle" size={150} />
        <Text variant="title" role="heading" style={{ textAlign: "center" }}>
          {t("title")}
        </Text>
        <Text variant="subheadline" tone="secondary" style={{ textAlign: "center" }}>
          {t("body")}
        </Text>
      </View>
      <View style={{ alignSelf: "stretch", paddingBottom: insets.bottom }}>
        <Button label={t("action")} leading="faceId" variant="primary" size="large" onPress={() => void keySession.unlock(prompt)} />
      </View>
    </Centered>
  );
}
