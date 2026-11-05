import { useState } from "react";
import { ActivityIndicator, Pressable, View } from "react-native";
import { useT } from "../../../shared/i18n";
import { Icon, icon, space, Text, useColors } from "../../../shared/ui";
import type { ToolCall } from "../model/items";

// A command's output runs far longer than the prototype's samples: the end, where an error usually is.
const SHOWN_LINES = 20;
const tailOf = (output: string) => output.split("\n").slice(-SHOWN_LINES).join("\n");

type State = ToolCall["state"];

function Status({ state }: { state: State }) {
  const colors = useColors();
  if (state === "running") return <ActivityIndicator size="small" color={colors.secondaryLabel} />;
  if (state === "unfinished") return <Icon name="stopped" />;
  return state === "ok" ? <Icon name="done" color="green" /> : <Icon name="failed" color="red" />;
}

function ToolRow({ call }: { call: ToolCall }) {
  const t = useT("task");
  const output = call.state === "unfinished" ? t("tools.unfinished") : call.output;
  return (
    <View style={{ flexDirection: "row", gap: space.sm }}>
      <View style={{ width: icon.md, alignItems: "center" }}>
        <Status state={call.state} />
      </View>
      <View style={{ flex: 1, gap: space.xs / 2 }}>
        <Text variant="footnote" tone="secondary" mono selectable>
          {call.command}
        </Text>
        {output ? (
          <Text variant="footnote" tone="secondary" mono selectable>
            {tailOf(output)}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

// controller-prototype's ToolCalls: one command shows as it is. Several in a row
// fold into a line that says how they went, so a long Turn does not bury the
// Agent's words; a tap opens them.
export function ToolCalls({ calls }: { calls: ToolCall[] }) {
  const t = useT("task");
  const [open, setOpen] = useState(false);
  if (calls.length === 1) return <ToolRow call={calls[0]!} />;

  const running = calls.find((call) => call.state === "running");
  const failed = calls.filter((call) => call.state === "failed").length;
  const unfinished = calls.some((call) => call.state === "unfinished");
  const overall: State = running ? "running" : failed ? "failed" : unfinished ? "unfinished" : "ok";
  const summary = running
    ? t("tools.running", { command: running.command })
    : failed
      ? t("tools.failed", { count: calls.length, failed })
      : unfinished
        ? t("tools.someUnfinished", { count: calls.length })
        : t("tools.passed", { count: calls.length });
  return (
    <View style={{ gap: space.sm }}>
      <Pressable role="button" aria-expanded={open} onPress={() => setOpen(!open)} style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1, minHeight: 44, justifyContent: "center" })}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
          <View style={{ width: icon.md, alignItems: "center" }}>
            <Status state={overall} />
          </View>
          <Text variant="footnote" tone="secondary" numberOfLines={1} style={{ flexShrink: 1 }}>
            {summary}
          </Text>
          <Icon name={open ? "collapse" : "expand"} size="xs" weight="semibold" />
        </View>
      </Pressable>
      {open && calls.map((call) => <ToolRow key={call.id} call={call} />)}
    </View>
  );
}
