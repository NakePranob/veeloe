import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useT } from "../../../shared/i18n";
import { Button, Card, Centered, IconDisc, Text, space } from "../../../shared/ui";

// Shown in place of the app, in the device's language, because the saved one is in the database that would not open.
export function StorageUnavailablePage({ onRetry }: { onRetry: () => void }) {
  const t = useT("storage-unavailable");
  const insets = useSafeAreaInsets();
  return (
    <Centered>
      <View style={{ flex: 1, alignSelf: "stretch", alignItems: "center", justifyContent: "center", gap: space.md }}>
        <IconDisc icon="storage" />
        <Text variant="title" role="heading" style={{ textAlign: "center", marginBottom: space.smd }}>
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
