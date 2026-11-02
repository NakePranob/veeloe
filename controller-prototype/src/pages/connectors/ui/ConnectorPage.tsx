import { router, useLocalSearchParams } from "expo-router";
import { getAgent, updateAgent, useAgent } from "../../../entities/agent";
import { availableTools, removeConnector, setPersonal, simulateServerChange, toolChanges, toolKey, toolsHash, updateConnector, useConnectors, type Connector } from "../../../entities/connector";
import { can, memberName, useCurrentMember, useMember, useMembers } from "../../../entities/member";
import { clearNotifications, pushNotification } from "../../../entities/notification";
import { canResign, newSignature, useStoppedReason } from "../../../features/signing";
import { ago } from "../../../shared/lib";
import { authenticate, Button, confirm, Empty, inform, Label, Note, Row, Screen, Section, ToggleRow } from "../../../shared/ui";
import { botAccount, ownAccount } from "./login";
import { Simulate } from "./Simulate";

export function ConnectorPage() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const connector = useConnectors().find((item) => item.id === id);
  const agent = useAgent(connector?.agent);
  const me = useCurrentMember();
  const signer = useMember(connector?.signedBy);
  const members = useMembers();
  const stopped = useStoppedReason(connector ?? { signedBy: "", signedDevice: "" }, connector?.agent ?? "", "manage");

  if (!connector || !agent || !can(me, agent.id, "use")) {
    return (
      <Screen title="Connector">
        <Empty icon="connector" title="ไม่พบ Connector นี้" detail="อาจถูกลบแล้ว หรือคุณไม่มี Use ที่ Agent ของมัน" />
      </Screen>
    );
  }

  const manage = can(me, agent.id, "manage");
  const changes = toolChanges(connector);
  const live = availableTools(connector);
  const running = !stopped && !connector.needsLogin;
  const signerGone = !signer || signer.removed;
  const edit = (patch: Partial<Connector>) => updateConnector(connector.id, patch);
  const href = `/connectors/${connector.id}`;
  const ownLogin = connector.kind === "url";

  const toggleAllow = async (tool: Connector["pinned"][number], on: boolean) => {
    const key = toolKey(connector, tool);
    if (on && tool.anyUrl) return inform("ใส่ Allowlist ไม่ได้", `${key} เปิด URL ใดก็ได้ จึงข้าม Egress ได้ ต้องขอ Approval ทุกครั้ง`);
    if (!(await authenticate(`${on ? "เพิ่ม" : "เอาออกจาก"} ${key} ${on ? "ใน" : ""} Allowlist ของ ${agent.name}`))) return;
    const current = getAgent(agent.id)?.allowlist ?? [];
    updateAgent(agent.id, { allowlist: on ? [...current, key] : current.filter((entry) => entry !== key) });
  };

  const approveChanges = async () => {
    if (!(await authenticate(`อนุมัติ tool ใหม่ของ ${connector.title} และตรึง hash ${toolsHash(connector.server)}`))) return;
    // A tool whose text changed must earn its place on the Allowlist again.
    const drop = [...changes.changed, ...changes.removed].map((tool) => toolKey(connector, tool));
    updateAgent(agent.id, { allowlist: (getAgent(agent.id)?.allowlist ?? []).filter((entry) => !drop.includes(entry)) });
    edit({ pinned: connector.server });
  };

  const resign = async (account?: string) => {
    if (!(await authenticate(`เซ็น ${connector.title} ของ ${agent.name} ใหม่ในนามคุณ`))) return;
    edit({ ...newSignature(), ...(account ? { account } : {}) });
  };

  const remove = async () => {
    if (!(await confirm({ title: `ลบ ${connector.title}?`, message: "supervisor ลบ credential ทิ้ง แต่ไม่ได้ยกเลิก token ที่ฝั่งผู้ให้บริการ เจ้าของบัญชีต้องไปยกเลิกเอง", action: "ลบ", destructive: true }))) return;
    if (!(await authenticate(`ลบ Connector ${connector.title} ออกจาก ${agent.name}`))) return;
    updateAgent(agent.id, { allowlist: (getAgent(agent.id)?.allowlist ?? []).filter((entry) => !entry.startsWith(`${connector.service}/`)) });
    removeConnector(connector.id);
    router.back();
  };

  const expire = () => {
    edit({ needsLogin: true });
    // ADR 0044: a Member with Manage hears it; the push names the Agent, never the content.
    for (const member of members) {
      if (can(member, agent.id, "manage")) pushNotification({ kind: "connector", member: member.id, agent: agent.id, title: `${agent.name} มี Connector ที่ต้อง login ใหม่`, href });
    }
  };

  const personal = connector.personal[me.id];

  return (
    <Screen title={connector.title}>
      {stopped && (
        <>
          <Note icon="key" iconColor="red">
            Connector หยุดอยู่: {stopped} tool ตอบ Agent ว่าหยุดอยู่ credential ยังอยู่ เซ็นใหม่จากเครื่องอื่นแล้วใช้ต่อได้
          </Note>
          <Section>
            {canResign(connector) && <Row icon="key" title="เซ็นใหม่" detail="ในนามคุณ จากกุญแจที่ยังใช้ได้" onPress={() => resign()} />}
            {signerGone && me.owner && ownLogin && <Row icon="member" title="ผูกใหม่ด้วยบัญชีอื่น" detail="login อีกครั้ง แล้วเซ็นเป็นชื่อคุณ" onPress={() => resign(botAccount(connector.service))} />}
            {manage && <Row icon="trash" destructive title="ลบ Connector" detail="supervisor ลบ credential ทิ้ง ไม่ได้ยกเลิก token ที่ผู้ให้บริการ" onPress={remove} />}
          </Section>
        </>
      )}
      {connector.needsLogin && !stopped && (
        <Note icon="lock" iconColor="orange">
          refresh token ไม่ได้ ต้อง login ใหม่ ระหว่างนี้ tool ตอบ Agent ว่าหยุดอยู่ ไม่ให้ Agent เจอ error เงียบๆ
        </Note>
      )}

      <Section title="สถานะ">
        <Row icon="agent" title="Agent" value={agent.name} href={`/agents/${agent.id}`} />
        <Row icon="key" title="บัญชีที่ใช้" detail={connector.kind === "url" ? "ทุกคนที่มี Use ที่ Agent นี้ใช้บัญชีนี้ผ่าน Agent" : "รันใน sandbox ของ Agent ไม่ถือความลับ"} value={connector.account} />
        <Row icon="member" title="เซ็นโดย" detail={ago(connector.signedAt) === "ตอนนี้" ? "ตอนนี้" : `${ago(connector.signedAt)}ที่แล้ว`} value={signerGone ? "อดีต Member" : memberName(connector.signedBy)} />
        <Row icon="shield" title="hash ของ tool ที่ตรึง" value={toolsHash(connector.pinned)} mono />
        {manage && connector.needsLogin && !stopped && (
          <Row
            icon="lock"
            title="จำลอง: login ผ่านเบราว์เซอร์"
            detail="login ใหม่ด้วยบัญชีเดิม"
            onPress={() => {
              edit({ needsLogin: false });
              clearNotifications(href);
            }}
          />
        )}
      </Section>

      {changes.any && (
        <Section
          title="server เปลี่ยน tool"
          footer={manage ? `tool ที่เปลี่ยนหรือเพิ่มยังไม่ถึง Agent จนกว่าจะอนุมัติ hash ใหม่ ${toolsHash(connector.server)} และ tool ที่คำอธิบายเปลี่ยนต้องใส่ Allowlist ใหม่` : "Member ที่มี Manage ต้องอนุมัติใหม่ tool ที่เปลี่ยนจึงยังไม่ถึง Agent"}
        >
          {changes.added.map((tool) => (
            <Row key={`a${tool.name}`} icon="add" iconColor="orange" title={`เพิ่ม ${toolKey(connector, tool)}`} detail={tool.description} />
          ))}
          {changes.changed.map((tool) => (
            <Row
              key={`c${tool.name}`}
              icon="info"
              iconColor="orange"
              title={`เปลี่ยน ${toolKey(connector, tool)}`}
              detail={`เดิม: ${connector.pinned.find((pinned) => pinned.name === tool.name)?.description}\nใหม่: ${tool.description}`}
            />
          ))}
          {changes.removed.map((tool) => (
            <Row key={`r${tool.name}`} icon="trash" title={`หายไป ${toolKey(connector, tool)}`} />
          ))}
          {manage && <Row title="อนุมัติ tool ที่เปลี่ยน" icon="shield" onPress={approveChanges} />}
        </Section>
      )}

      <Section
        title={`tool ที่ตรึงไว้ (${connector.pinned.length})`}
        footer="ทุก tool ต้องขอ Approval จนกว่าจะอยู่ใน Allowlist ด้วยชื่อเต็ม Allowlist ของ tool จาก Connector เป็นกำแพงจริง เพราะ supervisor เป็นคนบังคับ"
      >
        {connector.pinned.map((tool) => {
          const key = toolKey(connector, tool);
          const reachable = live.some((item) => item.name === tool.name);
          const detail = `${tool.description}${tool.anyUrl ? "\nเปิด URL ใดก็ได้ ต้องขอ Approval ทุกครั้ง" : ""}${reachable ? "" : "\nยังไม่ถึง Agent: server เปลี่ยนแล้ว"}`;
          const inList = agent.allowlist.includes(key);
          return manage ? (
            <ToggleRow key={tool.name} title={key} detail={detail} value={inList} onChange={(on) => toggleAllow(tool, on)} />
          ) : (
            <Row key={tool.name} title={key} detail={detail} value={inList ? "ไม่ต้องขอ" : "ถามก่อน"} />
          );
        })}
      </Section>

      {ownLogin && (
        <Section
          title="บัญชีของฉัน"
          footer="บัญชีนี้ใช้ได้เฉพาะ Turn ที่คุณเป็นคนส่งข้อความ ไม่มีการยืมบัญชีคนอื่น และใช้ใน Channel ไม่ได้ เพราะคนในแชตไม่ใช่ Member Agent ถามคุณก่อนใช้ Always allow ผูกกับ tool นั้นบน Agent ตัวนี้และถอนได้ทุกเมื่อ"
        >
          {personal ? (
            <>
              <Row icon="member" title={personal.account} detail="ผูกไว้กับคุณ" accessory={<Button label="เลิกผูก" onPress={() => setPersonal(connector.id, me.id, null)} />} />
              {connector.pinned.map((tool) => {
                const key = toolKey(connector, tool);
                return (
                  <ToggleRow
                    key={tool.name}
                    title={`Always allow ${key}`}
                    value={personal.always.includes(key)}
                    onChange={(on) => setPersonal(connector.id, me.id, { ...personal, always: on ? [...personal.always, key] : personal.always.filter((entry) => entry !== key) })}
                  />
                );
              })}
            </>
          ) : (
            <Row icon="member" title="จำลอง: login บัญชีของฉัน" detail="ยังไม่ได้ผูกบัญชีของคุณ" onPress={() => setPersonal(connector.id, me.id, { account: ownAccount(me.name, connector.service), always: [] })} />
          )}
        </Section>
      )}

      <Simulate connector={connector} running={running} stopped={stopped} />

      {manage && (
        <Section title="จำลอง" footer="สิ่งที่ในระบบจริงเกิดจากฝั่ง server หรือผู้ให้บริการ">
          <Row icon="restart" title="server เปลี่ยน tool" detail="เพิ่ม tool และแก้คำอธิบายของตัวแรก" onPress={() => (changes.any ? inform("เปลี่ยนไปแล้ว", "มี tool ที่เปลี่ยนรออนุมัติอยู่") : simulateServerChange(connector.id))} />
          <Row icon="lock" title="refresh token หมดอายุ" detail="ต้อง login ใหม่ และ push ไปหาคนที่มี Manage" onPress={() => (connector.needsLogin ? inform("ต้อง login ใหม่อยู่แล้ว") : expire())} />
        </Section>
      )}

      {manage && !stopped && (
        <Section>
          <Row icon="trash" destructive title="ลบ Connector" onPress={remove} />
        </Section>
      )}
      <Label icon="info">ข้อความ push บอกแค่ว่า Agent ตัวไหนมีเรื่อง ไม่มีเนื้อหา</Label>
    </Screen>
  );
}
