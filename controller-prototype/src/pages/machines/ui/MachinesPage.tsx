import { router } from "expo-router";
import { useAgents, useMachines } from "../../../entities/agent";
import { useCurrentMember } from "../../../entities/member";
import { Empty, Row, Screen, Section } from "../../../shared/ui";
import { canSeeMachine } from "../model/access";

export function MachinesPage() {
  const machines = useMachines();
  const agents = useAgents();
  const me = useCurrentMember();
  const visible = machines.filter((machine) => canSeeMachine(me, machine.id, agents));
  return (
    <Screen title="Machine" right={me.owner ? { label: "ผูก Machine", onPress: () => router.push("/machines/pair") } : undefined}>
      {visible.length === 0 ? (
        <Empty icon="machine" title="ยังไม่มี Machine ที่คุณดูแล" detail={me.owner ? "ผูก Machine เครื่องแรกด้วย Pairing" : "Owner ผูก Machine ได้ และคนที่มี Manage ที่ Agent บนเครื่องนั้นจะเห็นเครื่องนั้น"} />
      ) : (
        <Section footer="Pairing ทำได้เฉพาะ Owner เพราะเพิ่ม Machine ที่ต้องจ่ายเงิน และ Agent ที่สร้างบนเครื่องนั้นแตะไฟล์ของเครื่องได้ (ADR 0031)">
          {visible.map((machine) => (
            <Row
              key={machine.id}
              icon="machine"
              iconColor={machine.online ? "green" : "tertiaryLabel"}
              title={machine.name}
              detail={`${machine.os} · Runtime ${machine.version} · ${agents.filter((agent) => agent.machineId === machine.id).length} Agent`}
              value={machine.online ? "ออนไลน์" : "ออฟไลน์"}
              href={`/machines/${machine.id}`}
            />
          ))}
        </Section>
      )}
    </Screen>
  );
}
