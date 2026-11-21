import { useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { Keyboard, View } from "react-native";
import { allowed, allowlistOf, commandParts, covers, READ_ONLY_COMMANDS, useAgents } from "../../../entities/agent";
import { useMachines } from "../../../entities/machine";
import { useMachineLink, useMachineStatus } from "../../../features/machine-link";
import { useT } from "../../../shared/i18n";
import { keySession } from "../../../shared/keystore";
import { Button, confirm, Empty, Field, Icon, inform, Note, Row, Screen, Section, Text, space } from "../../../shared/ui";

// The AgentAllowlist board: what this Agent may run without asking, and a
// sample command to see how the rules fall (ADR 0030). A bash entry is a
// guard against mistakes, not a wall: the wall is the sandbox and Egress (ADR 0008).
export function AllowlistPage() {
  const t = useT("agent-allowlist");
  const { agent: id } = useLocalSearchParams<{ agent: string }>();
  const agent = useAgents()?.find((a) => a.id === id);
  const machine = useMachines()?.find((m) => m.id === agent?.machine_id);
  if (!agent || !machine) {
    return (
      <Screen title={t("title")}>
        <Empty icon="shield" title={t("missing.title")} detail={t("missing.body")} />
      </Screen>
    );
  }
  // Keyed by the Agent so a draft entry never carries over to another one.
  return <AllowlistView key={agent.id} agentId={agent.id} agentName={agent.name} machineId={machine.id} stored={allowlistOf(agent)} />;
}

function AllowlistView({ agentId, agentName, machineId, stored }: { agentId: string; agentName: string; machineId: string; stored: string[] | null }) {
  const t = useT("agent-allowlist");
  const link = useMachineLink();
  const machine = useMachines()?.find((m) => m.id === machineId);
  const status = useMachineStatus(machineId);
  const offline = status.online === false || !link || !machine;
  const allowlist = stored ?? [];
  const [entry, setEntry] = useState("");
  const [sample, setSample] = useState(t("try.sampleDefault"));
  const draft = entry.trim();
  const parts = commandParts(sample);
  const before = allowed(sample, allowlist);
  // The sample as it would run once the entry typed above is added.
  const after = draft ? allowed(sample, [...allowlist, draft]) : before;
  const validDraft = !!draft && commandParts(draft).length === 1 && allowed(draft, [draft]);

  /** Every change is signed after a fresh authentication (ADR 0012); false when nothing went. */
  async function save(next: string[], prompt: string) {
    if (offline || !link || !machine) return false;
    Keyboard.dismiss();
    let sent = false;
    await keySession.withFreshAuthentication(prompt, () => void (sent = !!link.updateAgent(machine, { id: agentId, allowlist: next })));
    return sent;
  }

  async function add() {
    if (!validDraft) return inform(t("invalid.title"), t("invalid.body"));
    if (allowlist.includes(draft)) return inform(t("duplicate.title"), draft);
    // A single word covers every command that starts with it, which is wider than most people mean.
    const bare = draft.split(/\s+/).length === 1 && !READ_ONLY_COMMANDS.includes(draft as (typeof READ_ONLY_COMMANDS)[number]);
    if (bare && !(await confirm({ title: t("wide.title", { entry: draft }), message: t("wide.message", { entry: draft }), action: t("wide.action"), cancel: t("cancel") }))) return;
    if (await save([...allowlist, draft], t("authenticate.add", { entry: draft, name: agentName }))) setEntry("");
  }

  // The verdict for the sample as it would run with the entry typed above added.
  const runs = validDraft ? after : before;
  const only = parts.length === 1 ? parts[0] : null;
  const usedBy = only ? allowlist.find((item) => covers(item, only)) : undefined;
  return (
    <Screen title={t("title")} subtitle={t("subtitle", { name: agentName, count: allowlist.length })}>
      {offline && (
        <Note icon="offline" iconColor="orange">
          {t("offline")}
        </Note>
      )}
      {/* Every entry in one card, each with its remove, and the add field closing the card (the board). */}
      <Section title={t("runs.heading")} footer={t("runs.footer")}>
        {allowlist.length === 0 && <Row title={t("runs.empty")} detail={t("runs.emptyDetail")} />}
        {allowlist.map((item) => (
          <Row key={item} title={item} mono accessory={<Button
            label={t("remove")}
            variant="destructive"
            size="small"
            disabled={offline}
            onPress={() => void save(
              allowlist.filter((other) => other !== item),
              t("authenticate.remove", { entry: item, name: agentName }),
            )}
          />} />
        ))}
        <Field label={t("add.label")} value={entry} onChangeText={setEntry} placeholder={t("add.placeholder")} mono bare action={{ label: t("add.action"), onPress: () => void add(), disabled: !draft || offline }} />
      </Section>

      <Section title={t("try.heading")} footer={draft && !validDraft ? t("try.invalidDraft") : undefined}>
        <Field label={t("try.label")} value={sample} onChangeText={setSample} mono bare icon="terminal" />
        <View style={{ flexDirection: "row", alignItems: "center", gap: space.md, paddingHorizontal: 14, paddingTop: space.xs, paddingBottom: space.md }}>
          <Icon name={runs ? "done" : "approval"} size="lg" color={runs ? "green" : "orange"} />
          <View style={{ flex: 1, gap: 2 }}>
            <Text variant="subheadline" strong>
              {runs ? (validDraft && !before ? t("try.wouldRun", { entry: draft }) : t("try.runs")) : parts.length && parts.every((part) => allowlist.some((item) => covers(item, part))) ? t("try.asksAlways") : t("try.asks")}
            </Text>
            {only && (
              <Text variant="caption" tone="secondary">
                {usedBy ? t("try.coveredBy", { entry: usedBy }) : validDraft && covers(draft, only) ? t("try.wouldCover", { entry: draft }) : t("try.notCovered")}
              </Text>
            )}
          </View>
        </View>
        {/* A joined command passes only if every part does, so each part says what covers it. */}
        {parts.length > 1 &&
          parts.map((part) => {
            const entryUsed = allowlist.find((item) => covers(item, part));
            const added = validDraft && covers(draft, part);
            return (
              <Row
                key={part}
                mono
                icon={entryUsed || added ? "done" : "approval"}
                iconColor={entryUsed || added ? "green" : "orange"}
                title={part}
                detail={entryUsed ? t("try.coveredBy", { entry: entryUsed }) : added ? t("try.wouldCover", { entry: draft }) : t("try.notCovered")}
              />
            );
          })}
      </Section>
      <Note tone="warning">{t("notAWall")}</Note>
    </Screen>
  );
}

/** The header's title with the Agent and its count under it, as the board draws it. */