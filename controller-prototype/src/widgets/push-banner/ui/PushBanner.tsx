import { router } from "expo-router";
import { useEffect } from "react";
import { Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useCurrentMemberId } from "../../../entities/member";
import { dismissNotification, useNotifications } from "../../../entities/notification";
import { Card, Icon, space, Text } from "../../../shared/ui";

// ponytail: stands in for the OS's push while there is no Hub. It says only which Agent has
// something, as a real push must (ADR 0005), and shows the latest for whoever holds this device.
export function PushBanner() {
  const insets = useSafeAreaInsets();
  const member = useCurrentMemberId();
  const latest = useNotifications().findLast((item) => item.member === member && !item.cleared);
  const id = latest?.id;

  useEffect(() => {
    if (!id) return;
    const timer = setTimeout(() => dismissNotification(id), 5000);
    return () => clearTimeout(timer);
  }, [id]);

  if (!latest) return null;
  return (
    <View pointerEvents="box-none" style={{ position: "absolute", top: insets.top + space.sm, left: space.md, right: space.md, alignItems: "center" }}>
      <Pressable
        role="button"
        onPress={() => {
          dismissNotification(latest.id);
          router.push(latest.href as never);
        }}
        style={{ width: "100%", maxWidth: 480 }}
      >
        <Card raised style={{ flexDirection: "row", alignItems: "center", padding: space.md }}>
          <Icon name="bell" size="md" color={latest.kind === "approval" ? "orange" : "secondaryLabel"} />
          <View style={{ flex: 1 }}>
            <Text variant="caption" tone="secondary">
              Veeloe
            </Text>
            <Text variant="subheadline" strong numberOfLines={2}>
              {latest.title}
            </Text>
          </View>
        </Card>
      </Pressable>
    </View>
  );
}
