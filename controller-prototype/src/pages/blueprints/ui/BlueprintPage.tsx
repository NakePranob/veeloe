import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { Character, createAgent, getAgents, lookOf, updateMachine, useMachines } from "../../../entities/agent";
import { BLUEPRINTS, blueprintHash, recordInstall } from "../../../entities/blueprint";
import { thisDevice, useCurrentMember } from "../../../entities/member";
import { file, installSkill } from "../../../entities/skill";
import { authenticate, Card, Empty, Field, inform, Note, Row, Screen, Section, Select, space, Text, ToggleRow } from "../../../shared/ui";

// What a Blueprint asks for, in full, before anyone signs. The signature covers the hash, so a
// changed Blueprint is a different thing to sign (ADR 0049).
export function BlueprintPage() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const blueprint = BLUEPRINTS.find((candidate) => candidate.id === id);
  const machines = useMachines();
  const me = useCurrentMember();
  const [machineId, setMachineId] = useState(machines.find((machine) => machine.online && machine.providers.length)?.id ?? machines[0]?.id ?? "");
  const [name, setName] = useState(blueprint?.name.slice(0, 24) ?? "");
  const machine = machines.find((candidate) => candidate.id === machineId);
  const [providerId, setProviderId] = useState("");
  const provider = machine?.providers.find((candidate) => candidate.id === providerId) ?? machine?.providers[0];
  const [model, setModel] = useState("");
  const [addEgress, setAddEgress] = useState(true);

  if (!blueprint) {
    return (
      <Screen title="Blueprint">
        <Empty icon="blueprint" title="ไม่พบ Blueprint นี้" />
      </Screen>
    );
  }

  const hash = blueprintHash(blueprint);
  const newDomains = blueprint.egress.filter((domain) => !machine?.egress.includes(domain));
  // Creating an Agent is the Owner's, nearly the same as reaching the Machine's files (ADR 0031).
  const reason = !me.owner ? "เฉพาะ Owner ติดตั้งได้ เพราะเป็นการสร้าง Agent ใหม่บน Machine" : !machine ? "เลือก Machine" : !machine.online ? `${machine.name} ปิดอยู่ Runtime ต้องสร้าง Workdir ให้ Agent` : !provider ? `${machine.name} ยังไม่มี Provider` : !name.trim() ? "ตั้งชื่อ Agent" : getAgents().some((agent) => agent.name.toLowerCase() === name.trim().toLowerCase()) ? "มี Agent ชื่อนี้แล้ว" : null;

  async function install() {
    const device = thisDevice(me);
    if (!blueprint || !machine || !provider || !device || reason) return inform("ติดตั้งไม่ได้", reason ?? "ไม่พบอุปกรณ์ที่เซ็นได้");
    const summary = `ติดตั้ง ${blueprint.name} (hash ${hash.slice(0, 12)}…) เป็น Agent ${name.trim()} บน ${machine.name}\nAllowlist ${blueprint.allowlist.length} รายการ${addEgress && newDomains.length ? ` · เพิ่ม Egress ${newDomains.join(", ")}` : ""}`;
    if (!(await authenticate(summary))) return;
    const agent = createAgent({
      name: name.trim(),
      description: blueprint.summary,
      instructions: blueprint.instructions,
      machineId: machine.id,
      character: lookOf(blueprint.character),
      providerId: provider.id,
      model: model || provider.models[0],
      allowlist: blueprint.allowlist,
    });
    for (const skill of blueprint.skills) {
      installSkill({ agent: agent.id, name: skill.name, description: skill.description, origin: "link", from: blueprint.source, version: blueprint.version, files: skill.files.map((entry) => file(entry.path, entry.content)), installedBy: me.id, signedDevice: device.id });
    }
    if (addEgress && newDomains.length) updateMachine(machine.id, { egress: [...machine.egress, ...newDomains] });
    recordInstall({ blueprint: blueprint.id, agent: agent.id, hash, by: me.id });
    router.replace(`/agents/${agent.id}`);
  }

  return (
    <Screen title={blueprint.name} right={{ label: "ติดตั้ง", onPress: install, disabled: !!reason }}>
      <Card>
        <Text variant="headline">{blueprint.name}</Text>
        <Text variant="footnote" tone="secondary">
          {blueprint.summary}
        </Text>
        <Text variant="caption" tone="secondary">
          โดย {blueprint.author} · เวอร์ชัน {blueprint.version}
        </Text>
        <Text variant="caption" tone="secondary" mono selectable>
          {blueprint.source}
        </Text>
        <Text variant="caption" tone="secondary" mono selectable>
          sha256 {hash}
        </Text>
      </Card>

      <Section title="คำสั่งของ Agent" footer="เขียนโดยคนทำ Blueprint แอปไม่ได้รับรองว่าปลอดภัย อ่านให้ครบ">
        <Row title={blueprint.instructions} />
      </Section>
      <Section title="Skill ที่จะติดตั้ง">
        {blueprint.skills.length ? blueprint.skills.map((skill) => <Row key={skill.name} icon="skill" title={skill.name} detail={`${skill.description} · ${skill.files.map((entry) => entry.path).join(", ")}`} />) : <Row title="ไม่มี" />}
      </Section>
      <Section title="Connector ที่ต้องใช้" footer="ติดตั้ง Blueprint ไม่ได้ต่อบัญชีให้ ต้องไปผูกเองที่หน้า Connector โดยคนที่มี Manage และ tool ถูกตรึงตอนติดตั้ง Connector (ADR 0039)">
        {blueprint.connectors.length ? blueprint.connectors.map((connector) => <Row key={connector} icon="connector" title={connector} href="/connectors" />) : <Row title="ไม่ต้องใช้" />}
      </Section>
      <Section title="Allowlist: รันได้โดยไม่ต้องขอ Approval" footer="คำนำหน้าของ bash กันได้แค่ความผิดพลาด ไม่ได้กัน Agent ที่โดนหลอก กำแพงจริงคือ sandbox กับ Egress (ADR 0030)">
        {blueprint.allowlist.map((entry) => (
          <Row key={entry} icon="shield" mono title={entry} />
        ))}
      </Section>
      <Section title="Egress: โดเมนที่ขอเพิ่ม" footer={blueprint.egress.length ? "ตอนนี้ Egress เป็นรายการเดียวทั้ง Machine ทุก Agent บนเครื่องนี้ออกโดเมนเหล่านี้ได้ด้วย จนกว่าจะแยกต่อ Agent (ADR 0029)" : undefined}>
        {blueprint.egress.length ? blueprint.egress.map((domain) => <Row key={domain} icon="network" mono title={domain} value={machine?.egress.includes(domain) ? "มีอยู่แล้ว" : "ใหม่"} />) : <Row title="ไม่ขอเพิ่ม" />}
      </Section>
      <Section title="Character">
        <View style={{ alignItems: "center", padding: space.sm }}>
          <Character look={lookOf(blueprint.character)} mood="idle" size={72} />
        </View>
      </Section>

      <Section title="ติดตั้งบน Machine ของคุณ" footer="Agent ที่ได้เป็น Agent ปกติ ใช้ Provider และ Budget ของคุณเอง แก้ทุกอย่างได้ภายหลัง">
        <Field label="ชื่อ Agent" value={name} onChangeText={setName} />
        <Row title="Machine" accessory={<Select label="Machine" value={machineId} options={machines.map((candidate) => ({ value: candidate.id, label: candidate.name }))} onChange={(next) => { setMachineId(next); setProviderId(""); setModel(""); }} />} />
        {machine && machine.providers.length > 0 && (
          <>
            <Row title="Provider" accessory={<Select label="Provider" value={provider?.id ?? ""} options={machine.providers.map((candidate) => ({ value: candidate.id, label: candidate.name }))} onChange={(next) => { setProviderId(next); setModel(""); }} />} />
            <Row title="Model" accessory={<Select label="Model" value={model || provider?.models[0] || ""} options={(provider?.models ?? []).map((candidate) => ({ value: candidate, label: candidate }))} onChange={setModel} />} />
          </>
        )}
        {newDomains.length > 0 && <ToggleRow icon="network" title={`เพิ่ม Egress ${newDomains.length} โดเมน`} detail="ถ้าไม่เพิ่ม Agent อาจเรียกบริการที่ต้องใช้ไม่ได้" value={addEgress} onChange={setAddEgress} />}
      </Section>
      {reason && <Note icon="lock">{reason}</Note>}
      <Note icon="key">การติดตั้งเซ็นทับ hash ด้านบนด้วยกุญแจของคุณ Manage ที่ Agent ใหม่จะเป็นของ Owner</Note>
    </Screen>
  );
}
