import { useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { Keyboard, Linking, View } from "react-native";
import { GIT_REPOS_MAX } from "@veeloe/protocol-ts";
import { gitReposOf, useAgents } from "../../../entities/agent";
import { useMachines } from "../../../entities/machine";
import { useMachineLink, useMachineStatus } from "../../../features/machine-link";
import { useT } from "../../../shared/i18n";
import { keySession } from "../../../shared/keystore";
import { Button, Card, Empty, Field, Icon, inform, Note, Screen, space, Text } from "../../../shared/ui";
import { toRepo } from "../model/repo";

// The AgentGit board: which GitHub repos this Agent may clone, fetch and push
// through the git broker on its Machine, which holds the token (ADR 0069, issue #32).
export function GitReposPage() {
  const t = useT("agent-git");
  const { agent: id } = useLocalSearchParams<{ agent: string }>();
  const agents = useAgents();
  const machines = useMachines();
  const agent = agents?.find((a) => a.id === id);
  const machine = machines?.find((m) => m.id === agent?.machine_id);
  if (!agent || !machine) {
    return <Screen title={t("title")}>{agents && machines && <Empty icon="branch" title={t("missing.title")} detail={t("missing.body")} />}</Screen>;
  }
  // Keyed by the Agent so a draft entry never carries over to another one.
  return <GitReposView key={agent.id} agentId={agent.id} agentName={agent.name} machineId={machine.id} stored={gitReposOf(agent)} />;
}

function GitReposView({ agentId, agentName, machineId, stored }: { agentId: string; agentName: string; machineId: string; stored: string[] | null }) {
  const t = useT("agent-git");
  const link = useMachineLink();
  const machine = useMachines()?.find((m) => m.id === machineId);
  const status = useMachineStatus(machineId);
  const offline = status.online === false || !link || !machine;
  // A Machine that never sent repos has no git broker yet: there is nothing to set.
  const unsupported = stored === null;
  const repos = stored ?? [];
  const [entry, setEntry] = useState("");
  const [adding, setAdding] = useState(false);
  const locked = offline || unsupported;

  /** Every change is signed after a fresh authentication (ADR 0012); false when nothing went. */
  async function save(next: string[], prompt: string) {
    if (locked || !link || !machine) return false;
    Keyboard.dismiss();
    return (await keySession.signed(prompt, () => link.updateAgent(machine, { id: agentId, gitRepos: next }))).status === "sent";
  }

  async function add() {
    const repo = toRepo(entry);
    if (!repo) return inform(t("invalid.title"), t("invalid.body"));
    if (repos.includes(repo)) return inform(t("duplicate.title"), repo);
    if (repos.length >= GIT_REPOS_MAX) return inform(t("full.title"), t("full.body", { count: GIT_REPOS_MAX }));
    if (await save([...repos, repo], t("authenticate.add", { repo, name: agentName }))) {
      setEntry("");
      setAdding(false);
    }
  }

  return (
    <Screen title={t("title")} subtitle={t("subtitle", { name: agentName, count: repos.length })} right={{ label: t("add.action"), icon: "add", variant: "chip", onPress: () => setAdding((was) => !was), disabled: locked }}>
      {unsupported && (
        <Note icon="warning" iconColor="orange">
          {t("unsupported")}
        </Note>
      )}
      {offline && <Note tone="offline">{t("offline")}</Note>}
      {/* The header's + opens the field; with no repos yet it is the first thing to do, so it shows. */}
      {(adding || (repos.length === 0 && !locked)) && (
        <Field label={t("add.label")} value={entry} onChangeText={setEntry} placeholder={t("add.placeholder")} mono action={{ label: t("add.action"), onPress: add, disabled: !entry.trim() || locked }} />
      )}
      {repos.length === 0 && <Empty icon="branch" title={t("repos.empty")} detail={t("repos.emptyDetail")} />}
      {/* One card per repo, its two actions under it (the board). */}
      <View style={{ gap: space.md }}>
        {repos.map((repo) => (
          <Card key={repo} style={{ padding: space.inset, gap: space.md }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: space.md }}>
              <Icon name="branch" size="md" color="label" />
              <Text variant="subheadline" mono strong selectable style={{ flex: 1 }}>
                {repo}
              </Text>
            </View>
            <Text variant="caption" tone="body">
              {t("repos.access", { id: agentId })}
            </Text>
            <View style={{ flexDirection: "row", gap: space.sm }}>
              <View style={{ flex: 1 }}>
                <Button label={t("open")} leading="external" variant="surface" size="small" onPress={() => void Linking.openURL(`https://github.com/${repo}`)} />
              </View>
              <Button
                label={t("remove")}
                variant="destructive"
                size="small"
                disabled={locked}
                onPress={() =>
                  void save(
                    repos.filter((other) => other !== repo),
                    t("authenticate.remove", { repo, name: agentName }),
                  )
                }
              />
            </View>
          </Card>
        ))}
      </View>
      <Note tone="plain">{t("footer")}</Note>
    </Screen>
  );
}
