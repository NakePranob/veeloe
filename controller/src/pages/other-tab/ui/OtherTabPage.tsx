import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useT } from "../../../shared/i18n";
import { Button, Card, Centered, Icon, Text, space } from "../../../shared/ui";

// WhatsApp Web's "open in another window" (ADR 0021). Shown in place of the app, so the URL stays.
export function OtherTabPage({ onUseHere }: { onUseHere: () => void }) {
  const t = useT("other-tab");
  const insets = useSafeAreaInsets();
  return (
    <Centered>
      <View style={{ flex: 1, alignSelf: "stretch", alignItems: "center", justifyContent: "center", gap: space.md, paddingHorizontal: space.md }}>
        <Card style={{ width: 112, height: 112, borderRadius: 56, padding: 0, alignItems: "center", justifyContent: "center", marginBottom: space.sm }}>
          <Icon name="window" size="xl" color="label" />
        </Card>
        <Text variant="headline" role="heading" style={{ fontSize: 22, textAlign: "center" }}>
          {t("title")}
        </Text>
        <Text variant="subheadline" tone="secondary" style={{ textAlign: "center" }}>
          {t("body")}
        </Text>
      </View>
      <View style={{ alignSelf: "stretch", paddingBottom: insets.bottom }}>
        <Button label={t("useHere")} variant="primary" size="large" onPress={onUseHere} />
      </View>
    </Centered>
  );
}
