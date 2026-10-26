import { useState } from "react";
import { ActivityIndicator, Pressable, View } from "react-native";
import type { ToolResult } from "../../../entities/task";
import { Icon, icon, space, Text } from "../../../shared/ui";
import type { ToolCall } from "../model/items";

function Status({ result }: { result?: ToolResult }) {
  if (!result) return <ActivityIndicator size="small" />;
  if (result.stopped) return <Icon name="stopped" />;
  return result.ok ? <Icon name="done" color="green" /> : <Icon name="failed" color="red" />;
}

function ToolRow({ call, result }: { call: ToolCall; result?: ToolResult }) {
  return (
    <View style={{ flexDirection: "row", gap: space.sm }}>
      <View style={{ width: icon.md, alignItems: "center" }}>
        <Status result={result} />
      </View>
      <View style={{ flex: 1, gap: space.xs / 2 }}>
        <Text variant="footnote" tone="secondary" mono selectable>
          {call.command}
        </Text>
        {result && (
          <Text variant="footnote" tone="secondary" selectable>
            {result.output}
          </Text>
        )}
      </View>
    </View>
  );
}

// One command shows as it is. Several in a row fold into a line that says how
// they went, so a long Turn does not bury the Agent's words; a tap opens them.
export function ToolCalls({ calls, results }: { calls: ToolCall[]; results: Map<string, ToolResult> }) {
  const [open, setOpen] = useState(false);
  if (calls.length === 1) return <ToolRow call={calls[0]} result={results.get(calls[0].id)} />;

  const done = calls.flatMap((call) => results.get(call.id) ?? []);
  const failed = done.filter((result) => !result.ok && !result.stopped).length;
  const stopped = done.some((result) => result.stopped);
  const running = done.length < calls.length;
  const summary = running
    ? `กำลังรัน ${calls.at(-1)!.command}`
    : `รัน ${calls.length} คำสั่ง${failed ? ` · ล้มเหลว ${failed}` : stopped ? " · หยุดก่อนเสร็จ" : " · ผ่านทั้งหมด"}`;
  const overall: ToolResult | undefined = running ? undefined : { ok: failed === 0 && !stopped, output: summary, stopped: stopped && failed === 0 };
  return (
    <View style={{ gap: space.sm }}>
      <Pressable role="button" aria-expanded={open} onPress={() => setOpen(!open)} style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
          <View style={{ width: icon.md, alignItems: "center" }}>
            <Status result={overall} />
          </View>
          <Text variant="footnote" tone="secondary" numberOfLines={1} style={{ flexShrink: 1 }}>
            {summary}
          </Text>
          <Icon name={open ? "collapse" : "expand"} size="xs" weight="semibold" />
        </View>
      </Pressable>
      {open && calls.map((call) => <ToolRow key={call.seq} call={call} result={results.get(call.id)} />)}
    </View>
  );
}
