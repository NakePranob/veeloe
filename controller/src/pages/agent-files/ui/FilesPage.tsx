import { useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { Keyboard } from "react-native";
import { accessOf, useAgents, type Access } from "../../../entities/agent";
import { useMachines } from "../../../entities/machine";
import { useMachineLink, useMachineStatus } from "../../../features/machine-link";
import { describeError, useT } from "../../../shared/i18n";
import { keySession } from "../../../shared/keystore";
import { Button, Empty, Field, inform, Note, Row, Screen, Section, ToggleRow } from "../../../shared/ui";

// Which of the Machine's files one Agent reaches (ADR 0087): its own folders, or those and folders
// on the Machine given one at a time, read only. Every change is signed after a fresh
// authentication (ADR 0012), as on the Egress page. ponytail: v0.1 has one Member, the Owner, so
// the page does not hide the wider level from anyone; the Machine refuses a Member who is not one.
export function FilesPage() {
  const t = useT("agent-files");
  const { agent: id } = useLocalSearchParams<{ agent: string }>();
  const agents = useAgents();
  const machines = useMachines();
  const agent = agents?.find((a) => a.id === id);
  const machine = machines?.find((m) => m.id === agent?.machine_id);
  if (!agent || !machine) {
    return <Screen title={t("title")}>{agents && machines && <Empty icon="folder" title={t("missing.title")} detail={t("missing.body")} />}</Screen>;
  }
  const access = accessOf(agent);
  if (!access) {
    return (
      <Screen title={t("title")}>
        <Empty icon="folder" title={t("older.title")} detail={t("older.body")} />
      </Screen>
    );
  }
  // Keyed by the Agent so a draft path never carries over to another one.
  return <FilesView key={agent.id} agentId={agent.id} agentName={agent.name} machineId={machine.id} stored={access} />;
}

function FilesView({ agentId, agentName, machineId, stored }: { agentId: string; agentName: string; machineId: string; stored: Access }) {
  const t = useT("agent-files");
  const link = useMachineLink();
  const machine = useMachines()?.find((m) => m.id === machineId);
  const status = useMachineStatus(machineId);
  const offline = status.online === false || !link || !machine;
  const selected = stored.files === "selected";
  const [draft, setDraft] = useState("");

  async function save(next: Access, prompt: string) {
    if (offline || !link || !machine) return false;
    Keyboard.dismiss();
    return (await keySession.signed(prompt, () => (link.updateAgent(machine, { id: agentId, files: next.files, folders: next.folders }) ? "sent" : null))).status === "sent";
  }

  async function add() {
    const path = draft.trim().replace(/\/+$/, "");
    // The Machine checks the folder itself (it must exist there and stay clear of the home and secrets); here only the shape.
    if (!path.startsWith("/") || path.length < 2) return inform(t("invalid.title"), t("invalid.body"));
    if (stored.folders.some((folder) => folder.path === path)) return inform(t("duplicate"), path);
    if (await save({ files: "selected", folders: [...stored.folders, { path, mode: "read" }] }, t("authenticate.add", { path, name: agentName }))) setDraft("");
  }

  return (
    <Screen title={t("title")} subtitle={selected ? t("subtitleSelected", { name: agentName, count: stored.folders.length }) : t("subtitle", { name: agentName })}>
      {offline && <Note tone="offline">{t("offline")}</Note>}
      {status.updateError && <Note tone="warning">{describeError({ code: status.updateError, params: status.updateErrorParams ?? undefined })}</Note>}
      <Section footer={t(selected ? "selected.warning" : "selected.footer")}>
        <ToggleRow
          icon="folder"
          title={t("selected.title")}
          value={selected}
          onChange={(on) => void save({ files: on ? "selected" : "folder", folders: stored.folders }, t(on ? "authenticate.open" : "authenticate.close", { name: agentName }))}
        />
      </Section>
      {selected && (
        <Section title={t("folders.heading")} footer={t("folders.footer")}>
          {stored.folders.length === 0 && <Row title={t("folders.empty")} detail={t("folders.emptyDetail")} />}
          {stored.folders.map((folder) => (
            <Row
              key={folder.path}
              title={folder.path}
              detail={t(folder.mode === "write" ? "folders.readWrite" : "folders.readOnly")}
              mono
              disabled={offline}
              // One tap moves it between read only and read and write; the Machine refuses a folder another Agent writes.
              onPress={() =>
                void save(
                  { files: "selected", folders: stored.folders.map((item) => (item.path === folder.path ? { path: item.path, mode: item.mode === "write" ? "read" : "write" } : item)) },
                  t(folder.mode === "write" ? "authenticate.readOnly" : "authenticate.write", { path: folder.path, name: agentName }),
                )
              }
              accessory={
                <Button
                  label={t("remove")}
                  variant="destructive"
                  size="small"
                  disabled={offline}
                  onPress={() => void save({ files: "selected", folders: stored.folders.filter((item) => item.path !== folder.path) }, t("authenticate.remove", { path: folder.path, name: agentName }))}
                />
              }
            />
          ))}
          <Field label={t("add.label")} value={draft} onChangeText={setDraft} placeholder={t("add.placeholder")} mono bare action={{ label: t("add.action"), onPress: () => void add(), disabled: !draft.trim() || offline }} />
        </Section>
      )}
    </Screen>
  );
}
