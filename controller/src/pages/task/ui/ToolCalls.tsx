import { useState } from "react";
import { View } from "react-native";
import { useT } from "../../../shared/i18n";
import { Card, Chip, Icon, icon, space, Spinner, Tap, Text } from "../../../shared/ui";
import { summaryOf, type ToolCall } from "../model/items";

// A command's output runs far longer than a screen: the end, where an error usually is.
const SHOWN_LINES = 20;
const tailOf = (output: string) => output.split("\n").slice(-SHOWN_LINES).join("\n");

const VERBS = ["bash", "read", "glob", "grep", "edit", "write", "memory", "send_file"] as const;

function Status({ state }: { state: ToolCall["state"] }) {
  if (state === "running") return <Spinner />;
  if (state === "unfinished") return <Icon name="stopped" />;
  return state === "ok" ? <Icon name="done" color="green" /> : <Icon name="failed" color="red" />;
}

/** What a call did, in words: a verb for each tool the Runtime has, and the tool's own name for one this build does not know. */
function useLabel() {
  const t = useT("task");
  return (call: ToolCall) => ((VERBS as readonly string[]).includes(call.tool) ? t(`tools.verbs.${call.tool as (typeof VERBS)[number]}`, { target: call.target }) : t("tools.other", { tool: call.tool }));
}

function CallRow({ call }: { call: ToolCall }) {
  const t = useT("task");
  const label = useLabel();
  const output = call.state === "unfinished" ? t("tools.unfinished") : call.output;
  return (
    <View style={{ flexDirection: "row", gap: space.sm }}>
      <View style={{ width: icon.md, alignItems: "center", paddingTop: 2 }}>
        <Status state={call.state} />
      </View>
      <View style={{ flex: 1, gap: space.xs / 2 }}>
        <Text variant="footnote" mono selectable>
          {label(call)}
        </Text>
        {output ? (
          <Text variant="caption" tone="secondary" mono selectable>
            {tailOf(output)}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

// The tools an Agent used back to back, folded by default (task-thread-redesign): the one running,
// else the latest that failed with its last error line, else the last, and how many more it hides.
export function ToolCalls({ calls }: { calls: ToolCall[] }) {
  const t = useT("task");
  const label = useLabel();
  const [open, setOpen] = useState(false);
  const { call, error, hidden, hiddenFailed } = summaryOf(calls);
  return (
    <Card style={{ padding: space.xs, gap: 0 }}>
      <Tap onPress={() => setOpen(!open)} style={{ flexDirection: "row", alignItems: "center", gap: space.sm, minHeight: 44, paddingHorizontal: space.sm }}>
        <View style={{ width: icon.md, alignItems: "center" }}>
          <Status state={call.state} />
        </View>
        <Text variant="footnote" mono numberOfLines={1} tone={call.state === "failed" ? "danger" : "label"} style={{ flex: 1 }}>
          {label(call)}
        </Text>
        {hidden > 0 && <Chip tone="count" label={t("tools.more", { count: hidden })} urgent={false} />}
        {hiddenFailed && <Icon name="failed" size="xs" color="red" />}
        <Icon name={open ? "collapse" : "expand"} size="xs" weight="semibold" />
      </Tap>
      {!open && error && (
        <View style={{ paddingLeft: space.sm + icon.md + space.sm, paddingRight: space.sm, paddingBottom: space.sm }}>
          <Text variant="caption" tone="secondary" mono numberOfLines={2} selectable>
            {error}
          </Text>
        </View>
      )}
      {open && (
        <View style={{ gap: space.md, padding: space.sm }}>
          {calls.map((c) => (
            <CallRow key={c.id} call={c} />
          ))}
        </View>
      )}
    </Card>
  );
}

// The files a Turn changed with edit and write, under the Turn; a tap lists them.
export function ChangesRow({ files }: { files: string[] }) {
  const t = useT("task");
  const [open, setOpen] = useState(false);
  return (
    <Card style={{ padding: space.xs, gap: 0 }}>
      <Tap onPress={() => setOpen(!open)} style={{ flexDirection: "row", alignItems: "center", gap: space.sm, minHeight: 44, paddingHorizontal: space.sm }}>
        <Icon name="thread" size="md" color="label" />
        <Text variant="footnote" strong style={{ flex: 1 }}>
          {t("changes", { count: files.length })}
        </Text>
        <Icon name={open ? "collapse" : "expand"} size="xs" weight="semibold" />
      </Tap>
      {open && (
        <View style={{ gap: space.xs, padding: space.sm }}>
          {files.map((file) => (
            <Text key={file} variant="footnote" mono selectable>
              {file}
            </Text>
          ))}
          <Text variant="caption" tone="secondary">
            {t("changesNote")}
          </Text>
        </View>
      )}
    </Card>
  );
}
