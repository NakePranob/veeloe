import { useState } from "react";
import { Pressable, View } from "react-native";
import { useToolOutput } from "../../../features/machine-link";
import { useLanguage, useT } from "../../../shared/i18n";
import { clock, formatList } from "../../../shared/lib";
import { Card, Chip, Icon, icon, radius, space, Spinner, Tap, Text } from "../../../shared/ui";
import { summaryOf, type ToolCall } from "../model/items";

// A command's output runs far longer than a screen: the end, where an error usually is.
const SHOWN_LINES = 20;
const tailOf = (output: string) => output.split("\n").slice(-SHOWN_LINES).join("\n");

const VERBS = ["bash", "read", "glob", "grep", "edit", "write", "memory", "send_file", "goal_note", "goal_met"] as const;

function Status({ state }: { state: ToolCall["state"] }) {
  if (state === "running") return <Spinner />;
  if (state === "unfinished") return <Icon name="stopped" />;
  return state === "ok" ? <Icon name="done" color="green" /> : <Icon name="failed" color="red" />;
}

// Where the target goes in a verb's words, so each language keeps its own order around it.
const MARK = "\u0000";

/**
 * What a call did, in words: a verb for each tool the Runtime has, and the tool's own name for one this build
 * does not know. The words are the body font and only the target is mono, as the boards draw it; Memory's note stays prose.
 */
function CallLabel({ call, tone = "label", numberOfLines, selectable }: { call: ToolCall; tone?: "label" | "danger"; numberOfLines?: number; selectable?: boolean }) {
  const t = useT("task");
  const known = (VERBS as readonly string[]).includes(call.tool);
  const words = known ? t(`tools.verbs.${call.tool as (typeof VERBS)[number]}`, { target: MARK }) : t("tools.other", { tool: call.tool });
  const [before, after] = words.split(MARK);
  return (
    <Text variant="footnote" tone={tone} numberOfLines={numberOfLines} selectable={selectable} style={{ flex: 1 }}>
      {before}
      {after !== undefined &&
        (call.tool === "memory" ? (
          <Text variant="footnote" tone="body">
            {call.target}
          </Text>
        ) : (
          <Text variant="caption" mono tone={tone}>
            {call.target}
          </Text>
        ))}
      {after}
    </Text>
  );
}

function CallRow({ call }: { call: ToolCall }) {
  const t = useT("task");
  const output = call.state === "unfinished" ? t("tools.unfinished") : call.output;
  return (
    <View style={{ flexDirection: "row", gap: space.sm }}>
      <View style={{ width: icon.md, alignItems: "center", paddingTop: space.xxs }}>
        <Status state={call.state} />
      </View>
      <View style={{ flex: 1, gap: space.xs / 2 }}>
        <CallLabel call={call} selectable />
        {output ? (
          <Text variant="caption" tone="secondary" mono selectable>
            {tailOf(output)}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

// A running command's latest line of output and how long it has run, as the Machine streams it (ADR 0073).
function Live({ id }: { id: string }) {
  const output = useToolOutput(id);
  if (!output.at) return null;
  const line =
    output.tail
      .split("\n")
      .filter((l: string) => l.trim())
      .at(-1) ?? "";
  return (
    <View style={{ flexDirection: "row", gap: space.sm, paddingLeft: space.sm + icon.md + space.sm, paddingRight: space.sm, paddingBottom: space.sm }}>
      <Text variant="caption" tone="secondary" mono numberOfLines={1} style={{ flex: 1 }}>
        {line}
      </Text>
      <Text variant="caption" tone="secondary" style={{ fontVariant: ["tabular-nums"] }}>
        {clock(output.elapsedMs)}
      </Text>
    </View>
  );
}

// The tools an Agent used back to back, folded by default (task-thread-redesign): the one running,
// else the latest that failed with its last error line, else the last, and how many more it hides.
export function ToolCalls({ calls }: { calls: ToolCall[] }) {
  const t = useT("task");
  const language = useLanguage();
  const [open, setOpen] = useState(false);
  const { call, error, hidden, hiddenFailed, counts } = summaryOf(calls);
  // Once nothing runs, the head says what the group did, counted by tool, instead of its last call (issue #73).
  const finished = calls.length > 1 && !calls.some((c) => c.state === "running");
  const counted = formatList(
    counts.map(({ tool, count }) => ((VERBS as readonly string[]).includes(tool) ? t(`tools.count.${tool as (typeof VERBS)[number]}`, { count }) : t("tools.count.other", { tool, count }))),
    language,
  );
  const failedAny = calls.some((c) => c.state === "failed");
  return (
    <Card style={{ padding: space.xs, gap: 0 }}>
      <Tap onPress={() => setOpen(!open)} style={{ flexDirection: "row", alignItems: "center", gap: space.sm, minHeight: 44, paddingHorizontal: space.sm }}>
        <View style={{ width: icon.md, alignItems: "center" }}>
          <Status state={finished ? (failedAny ? "failed" : "ok") : call.state} />
        </View>
        {finished ? (
          <Text variant="footnote" tone={failedAny ? "danger" : "label"} numberOfLines={1} style={{ flex: 1 }}>
            {counted}
          </Text>
        ) : (
          <>
            <CallLabel call={call} numberOfLines={1} tone={call.state === "failed" ? "danger" : "label"} />
            {hidden > 0 && <Chip tone="count" label={t("tools.more", { count: hidden })} urgent={false} />}
            {hiddenFailed && <Icon name="failed" size="xs" color="red" />}
          </>
        )}
        <Icon name={open ? "collapse" : "expand"} size="xs" weight="semibold" />
      </Tap>
      {!open && call.state === "running" && <Live id={call.id} />}
      {!open && error && (
        // The board's white code box under the failed call.
        <View style={{ paddingLeft: space.sm + icon.md + space.sm, paddingRight: space.sm, paddingBottom: space.sm }}>
          <Card tone="surface" style={{ paddingVertical: space.sm, paddingHorizontal: space.md, borderRadius: radius.sm }}>
            <Text variant="caption2" tone="body" mono numberOfLines={2} selectable>
              {error}
            </Text>
          </Card>
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

// The files a Turn changed with edit and write, under the Turn: the board's grey pill, and a tap lists them.
// ponytail: the board's +/- line counts need per-edit diffs the log does not carry; add them when tool.result does.
export function ChangesRow({ files }: { files: string[] }) {
  const t = useT("task");
  const [open, setOpen] = useState(false);
  return (
    <View style={{ gap: space.sm }}>
      <Pressable role="button" aria-expanded={open} hitSlop={6} onPress={() => setOpen(!open)} style={({ pressed }) => ({ alignSelf: "flex-start", opacity: pressed ? 0.6 : 1 })}>
        <Card style={{ flexDirection: "row", alignItems: "center", gap: space.sm, height: 32, paddingVertical: 0, paddingHorizontal: space.md, borderRadius: radius.pill }}>
          <Text variant="footnote">{t("changes", { count: files.length })}</Text>
          <Icon name={open ? "collapse" : "expand"} size="xs" weight="semibold" />
        </Card>
      </Pressable>
      {open && (
        <Card style={{ gap: space.xs, padding: space.inset }}>
          {files.map((file) => (
            <Text key={file} variant="caption" mono selectable>
              {file}
            </Text>
          ))}
          <Text variant="caption" tone="secondary">
            {t("changesNote")}
          </Text>
        </Card>
      )}
    </View>
  );
}
