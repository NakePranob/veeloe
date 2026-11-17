import { useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { Keyboard, View } from "react-native";
import { GIT_REPOS_MAX } from "@veeloe/protocol-ts";
import { gitReposOf, useAgents } from "../../../entities/agent";
import { useMachines } from "../../../entities/machine";
import { useMachineLink, useMachineStatus } from "../../../features/machine-link";
import { useT } from "../../../shared/i18n";
import { keySession } from "../../../shared/keystore";
import { Button, Empty, Field, inform, Note, Row, Screen, Section, space } from "../../../shared/ui";
import { toRepo } from "../model/repo";

// controller-prototype's AgentEgressPage, for repos: which GitHub repos this
// Agent may clone, fetch and push through the git broker on its Machine, which
// holds the token (ADR 0069, issue #32). Laid out like the Allowlist page.
export function GitReposPage() {
  const t = useT("agent-git");
  const { agent: id } = useLocalSearchParams<{ agent: string }>();
  const agent = useAgents()?.find((a) => a.id === id);
  const machine = useMachines()?.find((m) => m.id === agent?.machine_id);
  if (!agent || !machine) {
    return (
      <Screen title={t("title")}>
        <Empty icon="branch" title={t("missing.title")} detail={t("missing.body")} />
      </Screen>
    );
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
  const locked = offline || unsupported;

  /** Every change is signed after a fresh authentication (ADR 0012); false when nothing went. */
  async function save(next: string[], prompt: string) {
    if (locked || !link || !machine) return false;
    Keyboard.dismiss();
    let sent = false;
    await keySession.withFreshAuthentication(prompt, () => void (sent = !!link.updateAgent(machine, { id: agentId, gitRepos: next })));
    return sent;
  }

  async function add() {
    const repo = toRepo(entry);
    if (!repo) return inform(t("invalid.title"), t("invalid.body"));
    if (repos.includes(repo)) return inform(t("duplicate.title"), repo);
    if (repos.length >= GIT_REPOS_MAX) return inform(t("full.title"), t("full.body", { count: GIT_REPOS_MAX }));
    if (await save([...repos, repo], t("authenticate.add", { repo, name: agentName }))) setEntry("");
  }

  return (
    <Screen title={t("title")}>
      {unsupported && (
        <Note icon="warning" iconColor="orange">
          {t("unsupported")}
        </Note>
      )}
      {offline && (
        <Note icon="offline" iconColor="orange">
          {t("offline")}
        </Note>
      )}
      <Section title={t("repos.heading")} footer={t("repos.footer", { id: agentId })}>
        {repos.length === 0 && <Row title={t("repos.empty")} detail={t("repos.emptyDetail")} />}
        {repos.map((repo) => (
          <Row key={repo} title={repo} mono icon="branch" accessory={<Button
            label={t("remove")}
            variant="destructive"
            disabled={locked}
            onPress={() => void save(
              repos.filter((other) => other !== repo),
              t("authenticate.remove", { repo, name: agentName }),
            )}
          />} />
        ))}
      </Section>

      <Section title={t("add.heading")} footer={t("add.footer")}>
        <Field label={t("add.label")} value={entry} onChangeText={setEntry} placeholder={t("add.placeholder")} mono action={{ label: t("add.action"), onPress: add, disabled: !entry.trim() || locked }} />
      </Section>
    </Screen>
  );
}
