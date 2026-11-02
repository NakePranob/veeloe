import { useLocalSearchParams } from "expo-router";
import { useAgents, type Agent } from "../../../entities/agent";
import { toolChanges, useConnectors, type Connector } from "../../../entities/connector";
import { can, useCurrentMember } from "../../../entities/member";
import { useStoppedReason } from "../../../features/signing";
import { Empty, Row, Screen, Section } from "../../../shared/ui";

// What a Member sees of one Connector: whether the Agent can call it right now.
export function useConnectorState(connector: Connector) {
  const stopped = useStoppedReason(connector, connector.agent, "manage");
  if (stopped) return { label: "หยุด", detail: stopped, icon: "key" as const, color: "red" as const };
  if (connector.needsLogin) return { label: "ต้อง login ใหม่", detail: "refresh ไม่ได้ tool ตอบ Agent ว่าหยุดอยู่", icon: "lock" as const, color: "orange" as const };
  if (toolChanges(connector).any) return { label: "รออนุมัติ tool", detail: "server เปลี่ยน tool ที่ตรึงไว้ ส่วนที่เปลี่ยนยังไม่ถึง Agent", icon: "shield" as const, color: "orange" as const };
  return { label: "ใช้งานอยู่", detail: undefined, icon: "connector" as const, color: "green" as const };
}

function ConnectorRow({ connector, agent }: { connector: Connector; agent: Agent }) {
  const state = useConnectorState(connector);
  return (
    <Row
      icon={state.icon}
      iconColor={state.color}
      title={`${connector.title} · ${agent.name}`}
      detail={state.detail ?? connector.account}
      value={state.label}
      href={`/connectors/${connector.id}`}
    />
  );
}

export function ConnectorsPage() {
  const { agent: only } = useLocalSearchParams<{ agent?: string }>();
  const me = useCurrentMember();
  const agents = useAgents().filter((agent) => !only || agent.id === only);
  const connectors = useConnectors();
  // Only Connectors on Agents the Member may use are listed at all.
  const visible = connectors.flatMap((connector) => {
    const agent = agents.find((candidate) => candidate.id === connector.agent);
    return agent && can(me, agent.id, "use") ? [{ connector, agent }] : [];
  });
  const manages = agents.some((agent) => can(me, agent.id, "manage"));
  return (
    <Screen title="Connector">
      <Section
        footer="Connector ต่อบริการภายนอกให้ Agent ผ่าน MCP supervisor ถือ credential ไว้เอง Agent เห็นแค่ tool และทุก tool ต้องขอ Approval จนกว่าจะอยู่ใน Allowlist ด้วยชื่อเต็ม"
      >
        {visible.length === 0 && <Empty icon="connector" title="ยังไม่มี Connector" detail="Connector ต่อบริการภายนอก เช่น GitHub หรือ Linear เข้ากับ Agent" />}
        {visible.map(({ connector, agent }) => (
          <ConnectorRow key={connector.id} connector={connector} agent={agent} />
        ))}
        {manages && <Row icon="add" title="เพิ่ม Connector" detail="ต้องมี Manage ที่ Agent" href={only ? `/connectors/new?agent=${only}` : "/connectors/new"} />}
      </Section>
    </Screen>
  );
}
