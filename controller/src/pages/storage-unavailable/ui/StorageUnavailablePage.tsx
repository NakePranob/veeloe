import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useT } from "../../../shared/i18n";
import { Button, Card, Centered, Icon, Text, space } from "../../../shared/ui";

// Shown in place of the app, in the device's language, because the saved one is in the database that would not open.
export function StorageUnavailablePage({ onRetry }: { onRetry: () => void }) {
  const t = useT("storage-unavailable");
  const insets = useSafeAreaInsets();
  return (
    <Centered>
      <View style={{ flex: 1, alignSelf: "stretch", alignItems: "center", justifyContent: "center", gap: space.md }}>
        <Card style={{ width: 112, height: 112, borderRadius: 56, padding: 0, alignItems: "center", justifyContent: "center", marginBottom: space.sm }}>
          <Icon name="storage" size="xl" color="label" />
        </Card>
        <Text variant="headline" role="heading" style={{ fontSize: 22, textAlign: "center", marginBottom: 6 }}>
          {t("title")}
        </Text>
        {(["web", "app"] as const).map((where) => (
          <Card key={where} style={{ alignSelf: "stretch", gap: space.xs, paddingVertical: space.md }}>
            <Text variant="caption" strong tone="secondary">
              {t(`on.${where}`)}
            </Text>
            <Text variant="subheadline">{t(`body.${where}`)}</Text>
          </Card>
        ))}
      </View>
      <View style={{ alignSelf: "stretch", paddingBottom: insets.bottom }}>
        <Button label={t("retry")} variant="primary" size="large" onPress={onRetry} />
      </View>
    </Centered>
  );
}
