import { EgressDomainSchema } from "@veeloe/protocol-ts";
import { useState } from "react";
import { egressOf as agentEgressOf, type AgentRow } from "../../../entities/agent";
import { egressOf as machineEgressOf, type Machine } from "../../../entities/machine";
import { useMachineLink, useMachineStatus } from "../../../features/machine-link";
import { keySession } from "../../../shared/keystore";
import { useLanguage, useT } from "../../../shared/i18n";
import { formatList } from "../../../shared/lib";
import { View } from "react-native";
import { Button, Field, inform, Note, Row, Section, Select, space } from "../../../shared/ui";

// The Machine board's Egress tab: the domains every Agent on this Machine
// may reach, or the ones one Agent may (`agent-egress-ui`). Every change is signed
// after a fresh authentication (ADR 0012), and the list shown is the one the
// Machine signed back for that Agent (ADR 0008, 0029).
export function EgressSection({ machine, agents }: { machine: Machine; agents: AgentRow[] }) {
  const t = useT("machines");
  const language = useLanguage();
  const link = useMachineLink();
  const status = useMachineStatus(machine.id);
  // The empty id is no Agent: the whole Machine, as before per-Agent Egress.
  const [scope, setScope] = useState("");
  const [draft, setDraft] = useState("");
  const agent = agents.find((entry) => entry.id === scope);
  const egress = agent ? agentEgressOf(agent) : machineEgressOf(machine);
  const agentNames = agents.map((entry) => entry.name);
  const who = agent ? t("egress.whoOne", { machine: machine.name, agent: agent.name }) : agentNames.length ? t("egress.whoNamed", { machine: machine.name, agents: formatList(agentNames, language) }) : t("egress.who", { machine: machine.name });

  async function change(next: string[], prompt: string) {
    if (!status.online || !link) return inform(t("egress.offline.title"), t("egress.offline.body", { machine: machine.name }));
    return (await keySession.signed(prompt, () => link.setEgress(machine, next, agent?.id))).status === "sent";
  }

  async function add() {
    const domain = draft.trim().toLowerCase();
    // The Protocol's own rule, so what the Machine would refuse never goes.
    if (!EgressDomainSchema.safeParse(domain).success) return inform(t("egress.invalid.title"), t("egress.invalid.body"));
    if (egress.includes(domain)) return inform(t("egress.duplicate"), domain);
    if (await change([...egress, domain], t("egress.addPrompt", { domain, who }))) setDraft("");
  }

  return (
    <View style={{ gap: space.smd }}>
      {/* The board's line names no Agents; the signing prompt below still does, since it is what the Owner confirms. */}
      <Note tone="plain">{t(agent ? "egress.topOne" : "egress.top", { who: agent ? who : t("egress.who", { machine: machine.name }) })}</Note>
      <Section footer={t("egress.footer")}>
        {agents.length > 0 && (
          <Select
            cancel={t("pickCancel")}
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
            iconColor="green"
            title={domain}
            mono
            accessory={
              <Button
                variant="destructive"
                size="small"
                label={t("egress.remove")}
                onPress={() =>
                  void change(
                    egress.filter((item) => item !== domain),
                    t("egress.removePrompt", { domain, who }),
                  )
                }
              />
            }
          />
        ))}
        <Field bare label={t("egress.add")} value={draft} onChangeText={setDraft} placeholder={t("egress.placeholder")} mono action={{ label: t("egress.add"), onPress: () => void add(), disabled: !draft.trim() }} />
      </Section>
    </View>
  );
}
