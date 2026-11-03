import { useState } from "react";
import { View } from "react-native";
import { useT } from "../../../shared/i18n";
import { keySession } from "../../../shared/keystore";
import { Button, Icon, space, Text, useColors } from "../../../shared/ui";

// The first screen of a new device, and where a key the OS invalidated ends up (ADR 0012).
export function CreateKeyPage({ lost }: { lost: boolean }) {
  const t = useT("create-key");
  const colors = useColors();
  const [problem, setProblem] = useState<"unsupported" | "failed" | null>(null);
  const words = lost ? "lost" : "create";

  async function create() {
    const result = await keySession.create(t("prompt"));
    setProblem(result === "created" ? null : result);
  }

  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: space.lg, padding: space.xl, backgroundColor: colors.background }}>
      <View style={{ alignItems: "center", gap: space.sm, maxWidth: 420 }}>
        <Icon name={lost ? "warning" : "key"} size="xl" color={lost ? "orange" : "secondaryLabel"} />
        <Text variant="headline" role="heading" style={{ textAlign: "center" }}>
          {t(`${words}.title`)}
        </Text>
        <Text variant="subheadline" tone="secondary" style={{ textAlign: "center" }}>
          {t(`${words}.body`)}
        </Text>
        {problem && (
          <Text variant="subheadline" role="alert" style={{ textAlign: "center" }}>
            {problem === "failed" ? t("failed") : t(process.env.EXPO_OS === "web" ? "unsupported.web" : "unsupported.app")}
          </Text>
        )}
      </View>
      <Button label={t(`${words}.action`)} variant="primary" onPress={() => void create()} />
    </View>
  );
}
