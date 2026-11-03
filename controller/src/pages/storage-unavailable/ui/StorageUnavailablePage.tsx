import { View } from "react-native";
import { useT } from "../../../shared/i18n";
import { Button, Icon, space, Text, useColors } from "../../../shared/ui";

// Shown in place of the app, in the device's language, because the saved one is in the database that would not open.
export function StorageUnavailablePage({ onRetry }: { onRetry: () => void }) {
  const t = useT("storage-unavailable");
  const colors = useColors();
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: space.lg, padding: space.xl, backgroundColor: colors.background }}>
      <View style={{ alignItems: "center", gap: space.sm, maxWidth: 420 }}>
        <Icon name="warning" size="xl" color="orange" />
        <Text variant="headline" role="heading" style={{ textAlign: "center" }}>
          {t("title")}
        </Text>
        <Text variant="subheadline" tone="secondary" style={{ textAlign: "center" }}>
          {t(process.env.EXPO_OS === "web" ? "body.web" : "body.app")}
        </Text>
      </View>
      <Button label={t("retry")} variant="primary" onPress={onRetry} />
    </View>
  );
}
