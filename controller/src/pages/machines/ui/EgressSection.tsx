import { EgressDomainSchema } from "@veeloe/protocol";
import { useState } from "react";
import { View } from "react-native";
import { egressOf, type Machine } from "../../../entities/machine";
import { useMachineLink, useMachineStatus } from "../../../features/machine-link";
import { keySession } from "../../../shared/keystore";
import { useT } from "../../../shared/i18n";
import { Button, Field, inform, Row, Section, space } from "../../../shared/ui";

// controller-prototype's EgressSection: the domains every Agent on this Machine
// may reach. One list for the whole Machine until Egress is split per Agent
// (ADR 0008, 0029). Every change is signed after a fresh authentication (ADR 0012),
// and the list shown is the one the Machine signed back.
export function EgressSection({ machine, agentNames }: { machine: Machine; agentNames: string[] }) {
  const t = useT("machines");
  const link = useMachineLink();
  const status = useMachineStatus(machine.id);
  const egress = egressOf(machine);
  const [draft, setDraft] = useState("");
  const who = agentNames.length ? t("egress.whoNamed", { machine: machine.name, agents: agentNames.join(", ") }) : t("egress.who", { machine: machine.name });

  async function change(next: string[], prompt: string) {
    if (!status.online || !link) return inform(t("egress.offline.title"), t("egress.offline.body", { machine: machine.name }));
    let sent = false;
    await keySession.withFreshAuthentication(prompt, () => void (sent = link.setEgress(machine, next)));
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
    <Section title="Egress" footer={t("egress.footer", { who })}>
      {egress.length === 0 && <Row title={t("egress.none.title")} detail={t("egress.none.detail")} />}
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
