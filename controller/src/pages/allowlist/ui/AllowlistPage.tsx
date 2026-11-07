import { useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { Keyboard, View } from "react-native";
import { allowed, allowlistOf, commandParts, covers, READ_ONLY_COMMANDS, useAgents } from "../../../entities/agent";
import { useMachines } from "../../../entities/machine";
import { useMachineLink, useMachineStatus } from "../../../features/machine-link";
import { useT } from "../../../shared/i18n";
import { keySession } from "../../../shared/keystore";
import { Button, confirm, Empty, Field, Icon, inform, Note, Row, Screen, Section, Text, space } from "../../../shared/ui";

// controller-prototype's AllowlistPage: what this Agent may run without asking,
// and a sample command to see how the rules fall (ADR 0030). A bash entry is a
// guard against mistakes, not a wall: the wall is the sandbox and Egress (ADR 0008).
export function AllowlistPage() {
  const t = useT("allowlist");
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
  const t = useT("allowlist");
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

  return (
    <Screen title={t("title")}>
      <Note icon="info" iconColor="orange">
        {t("notAWall")}
      </Note>
      {offline && (
        <Note icon="offline" iconColor="orange">
          {t("offline")}
        </Note>
      )}
      <Section title={t("runs.heading")} footer={t("runs.footer")}>
        {allowlist.length === 0 && <Row title={t("runs.empty")} detail={t("runs.emptyDetail")} />}
        {allowlist.map((item) => (
          <Row key={item} title={item} mono icon="shield" accessory={<Button
            label={t("remove")}
            disabled={offline}
            onPress={() => void save(
              allowlist.filter((other) => other !== item),
              t("authenticate.remove", { entry: item, name: agentName }),
            )}
          />} />
        ))}
      </Section>

      <Section title={t("add.heading")} footer={t("add.footer")}>
        <Field label={t("add.label")} value={entry} onChangeText={setEntry} placeholder={t("add.placeholder")} mono />
        <View style={{ alignItems: "flex-start", padding: space.sm }}>
          <Button label={t("add.action")} variant="primary" disabled={!draft || offline} onPress={add} />
        </View>
      </Section>

      <Section title={t("try.heading")} footer={draft && !validDraft ? t("try.invalidDraft") : t("try.footer")}>
        <Field label={t("try.label")} value={sample} onChangeText={setSample} mono />
        {parts.map((part) => {
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
        <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm, padding: space.sm }}>
          <Icon name={(validDraft ? after : before) ? "done" : "approval"} size="md" color={(validDraft ? after : before) ? "green" : "orange"} />
          <Text style={{ flex: 1 }}>
            {(validDraft ? after : before) ? (validDraft && !before ? t("try.wouldRun", { entry: draft }) : t("try.runs")) : parts.length && parts.every((part) => allowlist.some((item) => covers(item, part))) ? t("try.asksAlways") : t("try.asks")}
          </Text>
        </View>
      </Section>
    </Screen>
  );
}
