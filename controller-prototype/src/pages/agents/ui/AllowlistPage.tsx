import { useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { allowed, commandParts, covers, READ_ONLY_COMMANDS, updateAgent, useAgent, type Agent } from "../../../entities/agent";
import { can, useCurrentMember } from "../../../entities/member";
import { authenticate, Button, confirm, Empty, Field, Icon, inform, Note, Row, Screen, Section, space, Text } from "../../../shared/ui";
import { requireOnline } from "../model/guard";

export function AllowlistPage() {
  const { agent: id } = useLocalSearchParams<{ agent: string }>();
  const agent = useAgent(id);
  const me = useCurrentMember();
  if (!agent || !can(me, agent.id, "use")) {
    return (
      <Screen title="Allowlist">
        <Empty icon="shield" title="ไม่พบ Agent นี้" />
      </Screen>
    );
  }
  return <AllowlistView agent={agent} manage={can(me, agent.id, "manage")} />;
}

// Bash prefixes that run without an Approval (ADR 0030). A bash entry is a guard against
// mistakes, not a wall: the wall is the sandbox and Egress (ADR 0008).
function AllowlistView({ agent, manage }: { agent: Agent; manage: boolean }) {
  const [entry, setEntry] = useState("");
  const [sample, setSample] = useState("npm test -- --watch");
  const draft = entry.trim();
  const parts = commandParts(sample);
  const before = allowed(sample, agent.allowlist);
  // The sample as it would run once the entry typed above is added.
  const after = draft ? allowed(sample, [...agent.allowlist, draft]) : before;
  const validDraft = !!draft && commandParts(draft).length === 1 && allowed(draft, [draft]);

  async function change(next: string[], reason: string) {
    if (!requireOnline(agent.machine)) return false;
    if (!(await authenticate(`${reason} ของ ${agent.name}`))) return false;
    updateAgent(agent.id, { allowlist: next });
    return true;
  }

  async function add() {
    if (!validDraft) return inform("เพิ่มไม่ได้", "ใส่คำสั่งเดียวเท่านั้น ห้ามต่อด้วย && ; หรือ | และห้ามมี $( ), backtick หรือ eval");
    if (agent.allowlist.includes(draft)) return inform("มีรายการนี้แล้ว", draft);
    const bare = draft.split(/\s+/).length === 1 && !READ_ONLY_COMMANDS.includes(draft);
    if (bare && !(await confirm({ title: `${draft} กว้างมาก`, message: `รายการ ${draft} ครอบทุกคำสั่งที่ขึ้นต้นด้วย ${draft} ไม่ว่าจะตามด้วยอะไร ตั้งให้แคบเท่าที่ตั้งใจ เช่น ${draft} test`, action: "เพิ่มต่อ" }))) return;
    if (await change([...agent.allowlist, draft], `เพิ่ม ${draft} ใน Allowlist`)) setEntry("");
  }

  return (
    <Screen title="Allowlist">
      <Note icon="info" iconColor="orange">
        Allowlist ไม่ใช่กำแพง Agent ที่โดนหลอกแก้ไฟล์ได้โดยไม่ต้องขอ เช่นแก้ script test ใน package.json แล้วรัน npm test ที่อยู่ในรายการ หรือตั้ง core.fsmonitor ใน .git/config แล้วรัน git status กำแพงจริงคือ sandbox กับ Egress (ADR 0030, 0008)
      </Note>
      <Section title="รันได้เลยไม่ต้องขอ Approval" footer="เทียบทีละคำจากต้นคำสั่ง npm test ครอบ npm test -- --watch คำสั่งที่ต่อด้วย && ; หรือ | ต้องผ่านทุกท่อน และ $( ), backtick กับ eval ขอ Approval ทุกครั้ง การอ่านเขียนไฟล์ไม่ผ่านรายการนี้ เพราะ sandbox คุมอยู่แล้ว">
        {agent.allowlist.length === 0 && <Row title="ยังไม่มีรายการ" detail="ทุกคำสั่งของ Agent ต้องขอ Approval" />}
        {agent.allowlist.map((item) => (
          <Row key={item} title={item} mono icon="shield" accessory={manage ? <Button label="ลบ" onPress={() => change(agent.allowlist.filter((other) => other !== item), `ลบ ${item} ออกจาก Allowlist`)} /> : undefined} />
        ))}
      </Section>

      {manage ? (
        <Section title="เพิ่มรายการ" footer="รายการ git push ครอบ git push --force origin main ด้วย ตั้งให้แคบเท่าที่ตั้งใจ ต้องยืนยันตัวตนทุกครั้งที่เพิ่มหรือลบ (ADR 0012)">
          <Field label="คำนำหน้าของคำสั่ง" value={entry} onChangeText={setEntry} placeholder="เช่น npm test" mono />
          <View style={{ alignItems: "flex-start", padding: space.sm }}>
            <Button label="เพิ่มใน Allowlist" variant="primary" disabled={!draft} onPress={add} />
          </View>
        </Section>
      ) : (
        <Note icon="lock">แก้ Allowlist ได้เฉพาะคนที่มี Manage ถ้า Approval ขอบ่อยเกินไป ขอให้คนที่มี Manage เพิ่มรายการ</Note>
      )}

      <Section title="ลองคำสั่ง" footer={draft && !validDraft ? "รายการที่พิมพ์ยังเพิ่มไม่ได้ จึงยังไม่นับในผลข้างล่าง" : "พิมพ์คำสั่งตัวอย่างเพื่อดูว่า Agent จะรันเลยหรือต้องขอ Approval ถ้าพิมพ์รายการใหม่ไว้ข้างบน ผลจะรวมรายการนั้นให้ดูก่อนเพิ่ม"}>
        <Field label="คำสั่งตัวอย่าง" value={sample} onChangeText={setSample} mono />
        {parts.map((part) => {
          const entryUsed = agent.allowlist.find((item) => covers(item, part));
          const added = validDraft && covers(draft, part);
          return (
            <Row
              key={part}
              mono
              icon={entryUsed || added ? "done" : "approval"}
              iconColor={entryUsed || added ? "green" : "orange"}
              title={part}
              detail={entryUsed ? `ครอบโดย ${entryUsed}` : added ? `ถ้าเพิ่ม ${draft} จะครอบ` : "ไม่อยู่ใน Allowlist"}
            />
          );
        })}
        <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm, padding: space.sm }}>
          <Icon name={(validDraft ? after : before) ? "done" : "approval"} size="md" color={(validDraft ? after : before) ? "green" : "orange"} />
          <Text style={{ flex: 1 }}>
            {(validDraft ? after : before)
              ? validDraft && !before
                ? `รันได้เลยถ้าเพิ่ม ${draft}`
                : "รันได้เลยไม่ต้องขอ Approval"
              : parts.length && parts.every((part) => agent.allowlist.some((item) => covers(item, part)))
                ? "ต้องขอ Approval ทุกครั้ง: แยกท่อนให้แน่ใจไม่ได้ ($( ), backtick หรือ eval)"
                : "ต้องขอ Approval"}
          </Text>
        </View>
      </Section>
    </Screen>
  );
}
