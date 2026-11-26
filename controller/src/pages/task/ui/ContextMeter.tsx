import { Pressable } from "react-native";
import { useT } from "../../../shared/i18n";
import { Ring } from "../../../shared/ui";
import type { ContextUsage } from "../model/items";

/** The context window as a ring beside Send: red once the Runtime will summarize, orange past half. Tap opens the numbers. */
export function ContextMeter({ usage, onPress }: { usage: ContextUsage | null; onPress: () => void }) {
  const t = useT("task");
  if (!usage || usage.window <= 0) return null;
  const ratio = Math.min(1, Math.max(0, usage.tokens / usage.window));
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={t("context.a11y", { percent: Math.round(ratio * 100) })} hitSlop={8} onPress={onPress}>
      <Ring ratio={ratio} tone={usage.tokens >= usage.threshold ? "full" : ratio >= 0.5 ? "warn" : "ok"} />
    </Pressable>
  );
}
