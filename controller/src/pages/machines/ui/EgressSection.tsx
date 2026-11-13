import { EgressDomainSchema } from "@veeloe/protocol-ts";
import { useState } from "react";
import { View } from "react-native";
import { egressOf as agentEgressOf, type AgentRow } from "../../../entities/agent";
import { egressOf as machineEgressOf, type Machine } from "../../../entities/machine";
import { useMachineLink, useMachineStatus } from "../../../features/machine-link";
import { keySession } from "../../../shared/keystore";
import { useT } from "../../../shared/i18n";
import { Button, Field, inform, Row, Section, Select, space } from "../../../shared/ui";

// controller-prototype's EgressSection: the domains every Agent on this Machine
// may reach, or the ones one Agent may (`agent-egress-ui`). Every change is signed
// after a fresh authentication (ADR 0012), and the list shown is the one the
// Machine signed back for that Agent (ADR 0008, 0029).
export function EgressSection({ machine, agents }: { machine: Machine; agents: AgentRow[] }) {
  const t = useT("machines");
  const link = useMachineLink();
  const status = useMachineStatus(machine.id);
  // The empty id is no Agent: the whole Machine, as before per-Agent Egress.
  const [scope, setScope] = useState("");
  const [draft, setDraft] = useState("");
  const agent = agents.find((entry) => entry.id === scope);
  const egress = agent ? agentEgressOf(agent) : machineEgressOf(machine);
  const agentNames = agents.map((entry) => entry.name);
  const who = agent
    ? t("egress.whoOne", { machine: machine.name, agent: agent.name })
    : agentNames.length
      ? t("egress.whoNamed", { machine: machine.name, agents: agentNames.join(", ") })
      : t("egress.who", { machine: machine.name });

  async function change(next: string[], prompt: string) {
    if (!status.online || !link) return inform(t("egress.offline.title"), t("egress.offline.body", { machine: machine.name }));
    let sent = false;
    await keySession.withFreshAuthentication(prompt, () => void (sent = link.setEgress(machine, next, agent?.id)));
    return sent;
  }

  async function add() {
    const domain = draft.trim().toLowerCase();
    // The Protocol's own rule, so what the Machine would refuse never goes.
    if (!EgressDomainSchema.safeParse(domain).success) return inform(t("egress.invalid.title"), t("egress.invalid.body"));
    if (egress.includes(domain)) return inform(t("egress.duplicate"), domain);
    if (await change([...egress, domain], t("egress.addPrompt", { domain, who }))) setDraft("");
  }

  return (
    <Section title="Egress" footer={t(agent ? "egress.footerOne" : "egress.footer", { who })}>
      {agents.length > 0 && (
        <Select
          label={t("egress.agent")}
          value={agent?.id ?? ""}
          onChange={(next) => {
            setScope(next);
            // A domain typed for one Agent is not a draft for another.
            setDraft("");
          }}
          options={[{ value: "", label: t("egress.allAgents") }, ...agents.map((entry) => ({ value: entry.id, label: entry.name }))]}
        />
      )}
      {egress.length === 0 && <Row title={t("egress.none.title")} detail={agent ? t("egress.none.detailOne") : t("egress.none.detail")} />}
      {egress.map((domain) => (
        <Row
          key={domain}
          icon="network"
          title={domain}
          mono
          accessory={<Button label={t("egress.remove")} onPress={() => void change(egress.filter((item) => item !== domain), t("egress.removePrompt", { domain, who }))} />}
        />
      ))}
      <View>
        <Field label={t("egress.add")} value={draft} onChangeText={setDraft} placeholder={t("egress.placeholder")} mono />
        <View style={{ alignItems: "flex-start", padding: space.sm }}>
          <Button label={t("egress.add")} disabled={!draft.trim()} onPress={() => void add()} />
        </View>
      </View>
    </Section>
  );
}
