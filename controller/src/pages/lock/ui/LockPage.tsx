import { useEffect } from "react";
import { View } from "react-native";
import { useT } from "../../../shared/i18n";
import { keySession } from "../../../shared/keystore";
import { Button, Icon, space, Text, useColors } from "../../../shared/ui";

// A phone asks at once. A browser refuses a passkey without a press, so web waits for the button.
export function LockPage() {
  const t = useT("lock");
  const colors = useColors();
  const prompt = t("prompt");

  useEffect(() => {
    if (process.env.EXPO_OS !== "web") void keySession.unlock(prompt);
  }, [prompt]);

  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: space.lg, padding: space.xl, backgroundColor: colors.background }}>
      <View style={{ alignItems: "center", gap: space.sm, maxWidth: 420 }}>
        <Icon name="lock" size="xl" />
        <Text variant="headline" role="heading" style={{ textAlign: "center" }}>
          {t("title")}
        </Text>
        <Text variant="subheadline" tone="secondary" style={{ textAlign: "center" }}>
          {t("body")}
        </Text>
      </View>
      <Button label={t("action")} variant="primary" onPress={() => void keySession.unlock(prompt)} />
    </View>
  );
}
