import { useState } from "react";
import { ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useT } from "../../../shared/i18n";
import { keySession } from "../../../shared/keystore";
import { Button, Card, Centered, Icon, Text, space, type IconName } from "../../../shared/ui";

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
        <Card style={{ alignSelf: "center", width: 112, height: 112, borderRadius: 56, padding: 0, alignItems: "center", justifyContent: "center", marginBottom: space.sm }}>
          <Icon name={lost ? "warning" : "key"} size="xl" color={lost ? "orange" : "label"} />
        </Card>
        <Text variant="headline" role="heading" style={{ fontSize: 22, textAlign: "center" }}>
          {t(`${words}.title`)}
        </Text>
        <Text variant="subheadline" tone="secondary" style={{ textAlign: "center", marginBottom: 10 }}>
          {t(`${words}.body`)}
        </Text>
        {POINTS.map((p) => (
          <View key={p.key} style={{ flexDirection: "row", gap: space.md, alignItems: "flex-start" }}>
            <Card style={{ width: 36, height: 36, borderRadius: 18, padding: 0, alignItems: "center", justifyContent: "center" }}>
              <Icon name={p.icon} color="label" />
            </Card>
            <Text variant="subheadline" tone="body" style={{ flex: 1, paddingTop: 7, fontSize: 14, lineHeight: 21 }}>
              {t(`points.${p.key}`)}
            </Text>
          </View>
        ))}
        {problem && (
          <Text variant="subheadline" role="alert" style={{ textAlign: "center" }}>
            {problem === "failed" ? t("failed") : t(process.env.EXPO_OS === "web" ? "unsupported.web" : "unsupported.app")}
          </Text>
        )}
      </ScrollView>
      <View style={{ alignSelf: "stretch", paddingBottom: insets.bottom }}>
        <Button label={t(`${words}.action`)} variant="primary" size="large" onPress={() => void create()} />
      </View>
    </Centered>
  );
}
