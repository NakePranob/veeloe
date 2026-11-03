import { Stack } from "expo-router";
import { Pressable, ScrollView, View } from "react-native";
import { useDatabase, useLiveQuery } from "../../../shared/db";
import { LANGUAGES, saveLanguage, useLanguage, useT } from "../../../shared/i18n";
import { Card, column, Icon, space, Text, useColors } from "../../../shared/ui";

// Settings on iOS: a group of rows, with a check on the one picked.
export function SettingsPage() {
  const t = useT("settings");
  const colors = useColors();
  const database = useDatabase();
  const language = useLanguage();
  const saved = useLiveQuery<{ value: string }>("SELECT value FROM device_setting WHERE key = 'language'", [], ["device_setting"]);
  const current = saved?.[0]?.value ?? language;
  return (
    <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={[column, { padding: space.lg, gap: space.sm }]}>
      <Stack.Screen options={{ title: t("title") }} />
      <Text variant="footnote" tone="secondary" style={{ paddingHorizontal: space.lg }}>
        {t("language.heading")}
      </Text>
      <Card style={{ padding: 0, gap: 0, overflow: "hidden" }}>
        <View role="radiogroup" aria-label={t("language.heading")}>
          {LANGUAGES.map((option) => (
            <Pressable
              key={option}
              role="radio"
              aria-checked={option === current}
              onPress={() => void saveLanguage(database, option)}
              style={({ pressed }) => ({
                minHeight: 44,
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
                gap: space.md,
                paddingHorizontal: space.lg,
                paddingVertical: space.md,
                backgroundColor: pressed ? colors.chipPressed : "transparent",
              })}
            >
              <Text>{t(`language.${option}`)}</Text>
              {option === current && <Icon name="check" size="md" color="label" weight="semibold" />}
            </Pressable>
          ))}
        </View>
      </Card>
      <Text variant="footnote" tone="secondary" style={{ paddingHorizontal: space.lg }}>
        {t("language.note")}
      </Text>
    </ScrollView>
  );
}
