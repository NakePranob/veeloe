import { View } from "react-native";
import { useT } from "../../../shared/i18n";
import { Button, Centered, Icon, Text, space } from "../../../shared/ui";

// WhatsApp Web's "open in another window" (ADR 0021). Shown in place of the app, so the URL stays.
export function OtherTabPage({ onUseHere }: { onUseHere: () => void }) {
  const t = useT("other-tab");
  return (
    <Centered>
      <View style={{ alignItems: "center", gap: space.sm, maxWidth: 420 }}>
        <Icon name="window" size="xl" />
        <Text variant="headline" role="heading" style={{ textAlign: "center" }}>
          {t("title")}
        </Text>
        <Text variant="subheadline" tone="secondary" style={{ textAlign: "center" }}>
          {t("body")}
        </Text>
      </View>
      <Button label={t("useHere")} variant="primary" onPress={onUseHere} />
    </Centered>
  );
}
