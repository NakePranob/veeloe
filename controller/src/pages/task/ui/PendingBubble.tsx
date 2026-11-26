import { Pressable, View } from "react-native";
import { dismissPendingMessage, type PendingRow } from "../../../entities/task";
import { useDatabase } from "../../../shared/db";
import { useT } from "../../../shared/i18n";
import { Bubble, Label, space, Text } from "../../../shared/ui";
import { Problem } from "./LogCards";

/** A message still on its way, or queued behind the running Turn; one that failed offers to take it off. */
export function PendingBubble({ message, position, busy }: { message: PendingRow; position: number; busy: boolean }) {
  const t = useT("task");
  const database = useDatabase();
  return (
    <Bubble
      text={message.text}
      queued
      note={
        message.error ? (
          <View style={{ alignItems: "flex-end", gap: space.xs }}>
            <Problem code={message.error} />
            <Pressable role="button" hitSlop={space.sm} onPress={() => void dismissPendingMessage(database, message.id)}>
              <Text variant="footnote" strong>
                {t("dismiss")}
              </Text>
            </Pressable>
          </View>
        ) : (
          // ponytail: the board's "ลบ" on a queued message needs a way to take it back off the Machine's queue,
          // which the Protocol does not have; removing only the local copy would still send it. Add it with that message.
          <Label icon="time" variant="caption">
            {busy ? t("queuedPosition", { position }) : t("sending")}
          </Label>
        )
      }
    />
  );
}
