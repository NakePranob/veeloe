import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { getAgent, updateAgent, useAgents } from "../../../entities/agent";
import { addConnector, getConnectors, SERVICES, toolKey, toolsHash } from "../../../entities/connector";
import { can, useCurrentMember } from "../../../entities/member";
import { newSignature } from "../../../features/signing";
import { authenticate, Button, Empty, inform, Label, Note, Row, Screen, Section, Select, ToggleRow } from "../../../shared/ui";
import { botAccount } from "./login";

export function NewConnectorPage() {
  // Opened from an Agent's page, it installs on that Agent and asks no one to pick.
  const { agent: preset } = useLocalSearchParams<{ agent?: string }>();
  const me = useCurrentMember();
  const agents = useAgents().filter((agent) => can(me, agent.id, "manage") && (!preset || agent.id === preset));
  const [agentId, setAgentId] = useState(agents[0]?.id ?? "");
  const [serviceId, setServiceId] = useState(SERVICES[0].service);
  const [account, setAccount] = useState<string | null>(null);
  const [ticks, setTicks] = useState<Record<string, boolean>>({});
  const service = SERVICES.find((item) => item.service === serviceId) ?? SERVICES[0];
  const agent = agents.find((item) => item.id === agentId) ?? agents[0];

  if (!agent) {
    return (
      <Screen title="เพิ่ม Connector">
        <Empty icon="lock" title="ต้องมี Manage ที่ Agent" detail="ติดตั้ง Connector ได้เฉพาะ Member ที่มี Manage ที่ Agent นั้น" />
      </Screen>
    );
  }

  const ready = service.kind === "command" || account !== null;
  // A tool that fetches any URL never goes on the Allowlist, so it asks every time (ADR 0040).
  const ticked = (name: string) => {
    const tool = service.tools.find((item) => item.name === name);
    return !!tool && !tool.anyUrl && (ticks[`${service.service}/${name}`] ?? tool.readOnlyHint);
  };

  const install = async () => {
    if (getConnectors().some((connector) => connector.agent === agent.id && connector.service === service.service)) {
      inform("ติดตั้งไม่ได้", `${agent.name} มี ${service.title} อยู่แล้ว ชื่อ tool จะชนกัน ลบตัวเดิมก่อน`);
      return;
    }
    if (!(await authenticate(`ติดตั้ง ${service.title} ให้ ${agent.name} และเซ็นทับ hash ${toolsHash(service.tools)} ของ tool ทั้งหมดที่เห็น`))) return;
    const connector = addConnector({
      agent: agent.id,
      service: service.service,
      title: service.title,
      kind: service.kind,
      account: service.kind === "command" ? "ไม่มีบัญชี (รันใน sandbox)" : (account as string),
      ...newSignature(),
      pinned: service.tools,
    });
    const current = getAgent(agent.id)?.allowlist ?? [];
    const keys = service.tools.filter((tool) => ticked(tool.name)).map((tool) => toolKey(service, tool));
    updateAgent(agent.id, { allowlist: [...current, ...keys.filter((key) => !current.includes(key))] });
    router.replace(`/connectors/${connector.id}`);
  };

  return (
    <Screen title="เพิ่ม Connector" right={{ label: "เซ็นและติดตั้ง", onPress: install, disabled: !ready }}>
      <Section title="ให้ใคร">
        {preset ? <Row title="Agent" value={agent.name} /> : <Row title="Agent" detail="เฉพาะ Agent ที่คุณมี Manage" accessory={<Select label="Agent" value={agent.id} options={agents.map((item) => ({ value: item.id, label: item.name }))} onChange={setAgentId} />} />}
        <Row
          title="บริการ"
          accessory={
            <Select
              label="บริการ"
              value={service.service}
              options={SERVICES.map((item) => ({ value: item.service, label: item.title }))}
              onChange={(value) => {
                setServiceId(value);
                setAccount(null);
              }}
            />
          }
        />
      </Section>

      {service.kind === "command" ? (
        <Section footer="MCP แบบคำสั่งรันใน sandbox ของ Agent เหมือนโปรแกรมทั่วไป ทำได้ไม่เกินที่ Agent ทำได้ และไม่ควรถือความลับ เพราะโปรเซสใน sandbox เดียวกันอ่าน env ของกันได้">
          <Row icon="machine" title="ไม่ต้อง login" detail="รันบน Machine ของ Agent" />
        </Section>
      ) : (
        <Section footer="แอป login ผ่านเบราว์เซอร์ของระบบ แลก code เป็น token เอง แล้วเข้ารหัสด้วยกุญแจของ Machine ส่งผ่าน Hub ที่อ่านไม่ได้ จากนั้นแอปลบสำเนาของตัวเอง">
          <Row icon="key" title={account ?? "ยังไม่ได้ login"} detail={account ? "ผูกแล้ว" : `บัญชีที่ Connector ใช้กับ ${service.title}`} />
          <Row icon="play" title="จำลอง: login ผ่านเบราว์เซอร์ (PKCE)" onPress={() => setAccount(botAccount(service.service))} />
        </Section>
      )}
      <Note icon="members" iconColor="orange">
        ทุกคนที่มี Use ที่ {agent.name} จะใช้บัญชีนี้ผ่าน Agent ได้ จึงควรเป็นบัญชี bot หรือ service account ไม่ใช่บัญชีส่วนตัว
      </Note>
      {service.note && (
        <Note icon="info" iconColor={service.tools.some((tool) => tool.anyUrl) ? "orange" : "secondaryLabel"}>
          {service.note}
        </Note>
      )}

      <Section
        title={`tool ที่ server บอก (${service.tools.length}) · hash ${toolsHash(service.tools)}`}
        footer="คำอธิบายของ tool เข้า prompt ตรงๆ จึงฝังคำสั่งได้ อ่านให้ครบก่อนเซ็น การเซ็นตรึง tool เหล่านี้ไว้ ถ้า server เปลี่ยนหรือเพิ่มต้องอนุมัติใหม่ ติ๊กคือไม่ต้องขอ Approval ถ้าไม่ติ๊กจะถามทุกครั้ง ส่วน readOnlyHint มาจาก server ตัดสินเอง"
      >
        {service.tools.map((tool) => (
          <ToggleRow
            key={tool.name}
            title={toolKey(service, tool)}
            detail={`${tool.description}\n${tool.schema}${tool.readOnlyHint ? "\nserver บอกว่าอ่านอย่างเดียว" : ""}${tool.anyUrl ? "\nเปิด URL ใดก็ได้ ต้องขอ Approval ทุกครั้ง" : ""}`}
            value={ticked(tool.name)}
            onChange={(value) => {
              if (tool.anyUrl) {
                inform("ใส่ Allowlist ไม่ได้", `${toolKey(service, tool)} เปิด URL ใดก็ได้ จึงข้าม Egress ได้ ต้องขอ Approval ทุกครั้ง`);
                return;
              }
              setTicks({ ...ticks, [toolKey(service, tool)]: value });
            }}
          />
        ))}
      </Section>
      {!ready && <Label icon="info">login ก่อนจึงเซ็นได้</Label>}
    </Screen>
  );
}
