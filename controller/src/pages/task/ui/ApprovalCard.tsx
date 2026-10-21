import { Clock } from "lucide-react-native";
import { useEffect, useState } from "react";
import { View } from "react-native";
import { answerApproval, type Approval } from "@/src/entities/task";
import { t } from "@/src/shared/i18n";
import { useWide } from "@/src/shared/lib";
import { Button, Icon, Text } from "@/src/shared/ui";

function useCountdown(until: number) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const seconds = Math.max(0, Math.round((until - now) / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

// The Approval sits in the stream, so it has no shadow; the amber label marks it.
// "Always allow" adds to the Allowlist for good, so the phone leaves it to a computer.
export function ApprovalCard({ taskId, agent, approval }: { taskId: string; agent: string; approval: Approval }) {
  const wide = useWide();
  const left = useCountdown(approval.expiresAt);
  return (
    <View className="bg-secondary gap-2.5 rounded-[20px] p-4" role="region" aria-label={t("approval.label")}>
      <View className="flex-row items-center gap-1.5">
        <Icon as={Clock} className="text-waiting size-[15px]" />
        <Text className="text-waiting flex-1 text-xs font-semibold">{t("approval.label")}</Text>
        <Text className="text-muted-foreground text-xs font-medium tabular-nums">{t("approval.expires", { time: left })}</Text>
      </View>
      <Text className="text-[17px] font-semibold">{t("approval.ask", { agent })}</Text>
      <View className="bg-background rounded-lg px-3.5 py-2.5">
        <Text selectable className="font-mono text-sm">
          {approval.command}
        </Text>
      </View>
      <Text className="text-sm">{approval.summary}</Text>
      <Text className="text-muted-foreground text-sm">{t("approval.notAllowed")}</Text>
      <View className="mt-1 flex-row gap-2">
        <Button variant="outline" size="lg" className="flex-1" onPress={() => answerApproval(taskId, "denied")}>
          <Text>{t("approval.deny")}</Text>
        </Button>
        {wide && (
          <Button variant="outline" size="lg" className="flex-1" onPress={() => answerApproval(taskId, "always")}>
            <Text>{t("approval.always")}</Text>
          </Button>
        )}
        <Button size="lg" className="flex-1" onPress={() => answerApproval(taskId, "once")}>
          <Text>{t("approval.approve")}</Text>
        </Button>
      </View>
      {!wide && <Text className="text-muted-foreground text-center text-xs">{t("approval.alwaysLater")}</Text>}
    </View>
  );
}
