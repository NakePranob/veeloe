import { EgressDomainSchema } from "@veeloe/protocol-ts";
import { useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { Keyboard } from "react-native";
import { egressOf, useAgents } from "../../../entities/agent";
import { useMachines } from "../../../entities/machine";
import { useMachineLink, useMachineStatus } from "../../../features/machine-link";
import { useT } from "../../../shared/i18n";
import { keySession } from "../../../shared/keystore";
import { Button, Empty, Field, inform, Note, Row, Screen, Section, ToggleRow } from "../../../shared/ui";

// One Agent's Egress, beside its Allowlist (ADR 0029): the domains it may reach,
// and the switch for the whole public internet (`*`, issue #81). Every change is
// signed after a fresh authentication (ADR 0012), as on the Allowlist page.
export function EgressPage() {
  const t = useT("agent-egress");
  const { agent: id } = useLocalSearchParams<{ agent: string }>();
  const agents = useAgents();
  const machines = useMachines();
  const agent = agents?.find((a) => a.id === id);
  const machine = machines?.find((m) => m.id === agent?.machine_id);
  if (!agent || !machine) {
    return <Screen title={t("title")}>{agents && machines && <Empty icon="network" title={t("missing.title")} detail={t("missing.body")} />}</Screen>;
  }
  // Keyed by the Agent so a draft domain never carries over to another one.
  return <EgressView key={agent.id} agentId={agent.id} agentName={agent.name} machineId={machine.id} stored={egressOf(agent)} />;
}

function EgressView({ agentId, agentName, machineId, stored }: { agentId: string; agentName: string; machineId: string; stored: string[] }) {
  const t = useT("agent-egress");
  const link = useMachineLink();
  const machine = useMachines()?.find((m) => m.id === machineId);
  const status = useMachineStatus(machineId);
  const offline = status.online === false || !link || !machine;
  const open = stored.includes("*");
  const domains = stored.filter((domain) => domain !== "*");
  const [draft, setDraft] = useState("");

  async function save(next: string[], prompt: string) {
    if (offline || !link || !machine) return false;
    Keyboard.dismiss();
    return (await keySession.signed(prompt, () => (link.setEgress(machine, next, agentId) ? "sent" : null))).status === "sent";
  }

  async function add() {
    const domain = draft.trim().toLowerCase();
    // The Protocol's own rule, so what the Machine would refuse never goes.
    if (domain === "*" || !EgressDomainSchema.safeParse(domain).success) return inform(t("invalid.title"), t("invalid.body"));
    if (stored.includes(domain)) return inform(t("duplicate"), domain);
    if (await save([...stored, domain], t("authenticate.add", { domain, name: agentName }))) setDraft("");
  }

  return (
    <Screen title={t("title")} subtitle={open ? t("subtitleOpen", { name: agentName }) : t("subtitle", { name: agentName, count: domains.length })}>
      {offline && <Note tone="offline">{t("offline")}</Note>}
      <Section footer={t(open ? "open.warning" : "open.footer")}>
        <ToggleRow icon="network" title={t("open.title")} value={open} onChange={(on) => void save(on ? [...stored, "*"] : domains, t(on ? "authenticate.open" : "authenticate.close", { name: agentName }))} />
      </Section>
      <Section title={t("domains.heading")} footer={t("domains.footer")}>
        {domains.length === 0 && <Row title={t("domains.empty")} detail={open ? t("domains.emptyOpen") : t("domains.emptyDetail")} />}
        {domains.map((domain) => (
          <Row
            key={domain}
            title={domain}
            mono
            accessory={
              <Button
                label={t("remove")}
                variant="destructive"
                size="small"
                disabled={offline}
                onPress={() =>
                  void save(
                    stored.filter((item) => item !== domain),
                    t("authenticate.remove", { domain, name: agentName }),
                  )
                }
              />
            }
          />
        ))}
        <Field label={t("add.label")} value={draft} onChangeText={setDraft} placeholder={t("add.placeholder")} mono bare action={{ label: t("add.action"), onPress: () => void add(), disabled: !draft.trim() || offline }} />
      </Section>
    </Screen>
  );
}
