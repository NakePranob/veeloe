import { useState } from "react";
import { ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useT } from "../../../shared/i18n";
import { keySession } from "../../../shared/keystore";
import { Button, Centered, IconDisc, Text, space, type IconName } from "../../../shared/ui";

const POINTS: { key: "secret" | "nothing" | "ask"; icon: IconName }[] = [
  { key: "secret", icon: "shield" },
  { key: "nothing", icon: "edit" },
  { key: "ask", icon: "faceId" },
];

// The first screen of a new device, and where a key the OS invalidated ends up (ADR 0012).
export function CreateKeyPage({ lost }: { lost: boolean }) {
  const t = useT("create-key");
  const insets = useSafeAreaInsets();
  const [problem, setProblem] = useState<"unsupported" | "failed" | null>(null);
  const words = lost ? "lost" : "create";

  async function create() {
    const result = await keySession.create(t("prompt"));
    setProblem(result === "created" ? null : result);
  }

  return (
    <Centered>
      <ScrollView style={{ flex: 1, alignSelf: "stretch" }} contentContainerStyle={{ flexGrow: 1, justifyContent: "center", gap: space.md }}>
        <IconDisc icon={lost ? "warning" : "key"} color={lost ? "orange" : "label"} />
        <Text variant="title" role="heading" style={{ textAlign: "center" }}>
          {t(`${words}.title`)}
        </Text>
        <Text variant="subheadline" tone="secondary" style={{ textAlign: "center", marginBottom: space.md }}>
          {t(`${words}.body`)}
        </Text>
        {POINTS.map((p) => (
          <View key={p.key} style={{ flexDirection: "row", gap: space.md, alignItems: "flex-start" }}>
            <IconDisc small icon={p.icon} />
            <Text variant="callout" tone="body" style={{ flex: 1, paddingTop: 7 }}>
              {t(`points.${p.key}`)}
            </Text>
          </View>
        ))}
        {problem && (
          <Text variant="subheadline" role="alert" style={{ textAlign: "center" }}>
            {problem === "failed" ? t("failed") : t("unsupported")}
          </Text>
        )}
      </ScrollView>
      <View style={{ alignSelf: "stretch", paddingBottom: insets.bottom }}>
        <Button label={t(`${words}.action`)} variant="primary" size="large" onPress={() => void create()} />
      </View>
    </Centered>
  );
}
