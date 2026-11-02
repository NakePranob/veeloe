import { useState } from "react";
import { accountFor, availableTools, toolKey, type Connector } from "../../../entities/connector";
import { can, useMembers } from "../../../entities/member";
import { useAgent } from "../../../entities/agent";
import { Button, Card, confirm, Row, Section, Select, Text } from "../../../shared/ui";

// ponytail: stands in for a Turn calling a tool. It shows which account the supervisor would
// use and whether the call needs Approval; nothing is sent anywhere.
export function Simulate({ connector, running, stopped }: { connector: Connector; running: boolean; stopped: string | null }) {
  const agent = useAgent(connector.agent);
  const members = useMembers().filter((member) => !member.removed && can(member, connector.agent, "use"));
  const [sender, setSender] = useState(members[0]?.id ?? "");
  const [place, setPlace] = useState<"task" | "channel">("task");
  const [tool, setTool] = useState(connector.pinned[0]?.name ?? "");
  const [result, setResult] = useState<string | null>(null);
  const chosen = connector.pinned.find((item) => item.name === tool) ?? connector.pinned[0];
  const who = members.find((member) => member.id === sender);
  if (!agent || !chosen || !who) return null;

  const call = async () => {
    const key = toolKey(connector, chosen);
    if (!running) return setResult(stopped ? `${key} ตอบ Agent ว่าหยุดอยู่: ${stopped}` : `${key} ตอบ Agent ว่าหยุดอยู่: ต้อง login ใหม่`);
    if (!availableTools(connector).some((item) => item.name === chosen.name)) return setResult(`supervisor ไม่ส่ง ${key} ให้ Agent เพราะ server เปลี่ยนไปจากที่ตรึงไว้`);
    const used = accountFor(connector, sender, place === "channel");
    const notes: string[] = [];
    if (!used.personal && connector.personal[sender]) notes.push("Channel ใช้บัญชีส่วนตัวไม่ได้ จึงใช้บัญชีของ Connector แทน");
    if (!used.personal && !connector.personal[sender]) notes.push(`${who.name} ยังไม่ได้ผูกบัญชีของตัวเอง และไม่ยืมบัญชีคนอื่น`);
    if (used.personal && !connector.personal[sender].always.includes(key)) {
      const ok = await confirm({ title: `Agent ขอใช้บัญชีของ ${who.name}`, message: `${key} ด้วย ${used.account}`, action: "Allow once" });
      if (!ok) return setResult(`${who.name} ไม่อนุญาต ${key} ไม่ได้ถูกเรียก`);
      notes.push("เจ้าของบัญชีกด Allow once");
    }
    const asks = connector.pinned.length > 0 && (chosen.anyUrl || !agent.allowlist.includes(key));
    notes.push(asks ? "ต้องขอ Approval ก่อน เพราะไม่อยู่ใน Allowlist" : "อยู่ใน Allowlist จึงรันได้ทันที");
    setResult(`เรียก ${key} ด้วยบัญชี ${used.account}${used.personal ? " (ส่วนตัว)" : ""}\n${notes.join("\n")}`);
  };

  return (
    <Section title="จำลอง: Turn เรียก tool" footer="บัญชีส่วนตัวของ Member ใช้เฉพาะ Turn ที่คนนั้นส่งข้อความ และไม่ใช้ใน Channel">
      <Row title="คนส่งข้อความ" accessory={<Select label="คนส่งข้อความ" value={sender} options={members.map((member) => ({ value: member.id, label: member.name }))} onChange={setSender} />} />
      <Row
        title="ที่ไหน"
        accessory={
          <Select
            label="ที่ไหน"
            value={place}
            options={[
              { value: "task", label: "Task ในแอป" },
              { value: "channel", label: "Channel" },
            ]}
            onChange={setPlace}
          />
        }
      />
      <Row title="tool" accessory={<Select label="tool" value={chosen.name} options={connector.pinned.map((item) => ({ value: item.name, label: item.name }))} onChange={setTool} />} />
      <Row title="เรียก tool" accessory={<Button label="จำลอง: เรียก" onPress={call} />} />
      {result && (
        <Card style={{ margin: 4 }}>
          <Text variant="footnote" selectable>
            {result}
          </Text>
        </Card>
      )}
    </Section>
  );
}
