import { useLocalSearchParams } from "expo-router";
import { useAgent } from "../../../entities/agent";
import { usePolicy } from "../../../entities/agent-policy";
import { GRANT_LABEL, can, useCurrentMember, useMembers, type Grant } from "../../../entities/member";
import { changeGrant } from "../../../features/membership";
import { setSearch } from "../../../features/agent-settings";
import { ago, useNow } from "../../../shared/lib";
import { Empty, inform, Note, Row, Screen, Section, Select, ToggleRow } from "../../../shared/ui";

const OPTIONS = [{ value: "none", label: "ไม่มี" }, ...(["use", "approve", "manage"] as const).map((value) => ({ value, label: GRANT_LABEL[value] }))] as const;

// Who may do what with one Agent, and what it may tell the people who use it (ADR 0010, 0059, 0060).
export function AgentAccessPage() {
  const { agent: id } = useLocalSearchParams<{ agent: string }>();
  const agent = useAgent(id);
  const me = useCurrentMember();
  const members = useMembers().filter((member) => !member.removed);
  const policy = usePolicy(id);
  const now = useNow();

  if (!agent) return <Screen title="สิทธิ์"><Empty icon="agent" title="ไม่พบ Agent" /></Screen>;
  if (!can(me, agent.id, "manage")) {
    return (
      <Screen title="สิทธิ์">
        <Empty icon="lock" title="ต้องมี Manage" detail={`ดูและแก้สิทธิ์ของ ${agent.name} ได้เฉพาะ Owner และคนที่มี Manage ที่ Agent นี้`} />
      </Screen>
    );
  }
  const run = async (promise: Promise<string | null>) => {
    const why = await promise;
    if (why) inform("ทำไม่ได้", why);
  };

  return (
    <Screen title={`สิทธิ์ของ ${agent.name}`}>
      <Section title="ใครทำอะไรได้" footer="Use ส่งข้อความและกด Stop ได้ Approve ตอบ Approval ได้ Manage แก้ค่าของ Agent แจก Grant และเชิญคนได้ ระดับสูงรวมระดับต่ำ Owner มี Manage ที่ทุก Agent">
        {members.map((member) =>
          member.owner ? (
            <Row key={member.id} icon="shield" title={member.name} detail={`ใช้งานล่าสุด ${ago(member.lastActiveAt, now)}`} value="Owner" />
          ) : (
            <Row
              key={member.id}
              icon="member"
              title={member.name}
              detail={`ใช้งานล่าสุด ${ago(member.lastActiveAt, now)}`}
              accessory={
                <Select
                  label={`Grant ของ ${member.name}`}
                  value={member.grants[agent.id] ?? "none"}
                  options={OPTIONS}
                  onChange={(value) => run(changeGrant(me, member.id, agent.id, value === "none" ? null : (value as Grant)))}
                />
              }
            />
          ),
        )}
      </Section>
      <Note icon="lock">
        คนที่มีแค่ Use หรือ Approve ให้ Agent อ่านได้แค่ Workdir กับ Library ส่วนคนที่มี Manage อ่านได้ตามเดิม ขอบเขตตามคนที่ส่งข้อความของ Turn นั้น และ sandbox เป็นตัวบังคับ (ADR 0059)
      </Note>

      <Section
        title="การค้น Task ของคนอื่น"
        footer="Agent เหมือนเพื่อนร่วมงาน ถามได้ว่าคนอื่นให้ทำอะไรอยู่ แต่ไม่มีหน้าจอให้อ่านแชตของกันทั้งหมด ระบบบังคับที่ tool ค้นหา ไม่ได้ขอให้ LLM ไม่เล่า ค่าถูกตรึงตอนเริ่มแต่ละ Task การเปิดทีหลังไม่ทำให้เรื่องเก่าถูกค้นเจอ แต่ Task เก่าที่เริ่มตอนค่าเปิดอยู่ยังถูกค้นเจอหลังปิด"
      >
        <ToggleRow
          icon="thread"
          title="ค้น Task ของคนอื่นตอนคุยผ่านแอป"
          detail="เปิดไว้เป็นค่าเริ่มต้น"
          value={agent.searchOtherTasks}
          onChange={(value) => run(setSearch(me, agent.id, "controller", value))}
        />
        <ToggleRow
          icon="channel"
          title="ค้น Task อื่นตอนตอบใน Channel"
          detail="ปิดไว้เป็นค่าเริ่มต้น ตอนปิด Agent ค้นได้แค่ Task ของแชตนั้น"
          value={policy.channelSearch}
          onChange={(value) => run(setSearch(me, agent.id, "channel", value))}
        />
      </Section>
      <Note icon="warning" iconColor="orange">
        {agent.searchOtherTasks
          ? `ตอนนี้ ${agent.name} อาจเล่าเรื่องใน Task ของคนอื่นให้คนที่ใช้ Agent นี้ฟังได้ ในแชตจะมีบอกไว้ แชตของฉันไม่ใช่ความลับ เพราะเจ้าของ Machine เข้าถึงข้อมูลได้ และ Workdir กับ Memory ใช้ร่วมกันทุก Task`
          : `ตอนนี้ ${agent.name} ค้น Task ของคนอื่นไม่ได้ในแชตที่เริ่มหลังจากนี้ แต่ Workdir กับ Memory ยังใช้ร่วมกัน เรื่องที่ต้องแยกจริงให้ใช้ Agent อีกตัว`}
      </Note>
      <Section footer="เส้นทางเครือข่ายก็เป็นสิทธิ์ที่ Manage แก้ ตั้งแยกต่อ Agent">
        <Row icon="network" title="Egress" value={policy.internet ? "ทั้งเน็ต" : `${policy.egress.length} โดเมน`} href={`/agents/${agent.id}/egress`} />
      </Section>
    </Screen>
  );
}
