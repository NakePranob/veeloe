import { useAgents } from "../../../entities/agent";
import { GRANT_LABEL, memberName, useCurrentMember, useMembers, type Member } from "../../../entities/member";
import { canInvite, setOwner } from "../../../features/membership";
import { ago, useNow } from "../../../shared/lib";
import { inform, Note, Row, Screen, Section, ToggleRow } from "../../../shared/ui";

function detailOf(member: Member, now: number) {
  const active = `ใช้งานล่าสุด ${ago(member.lastActiveAt, now)}`;
  return member.invitedBy ? `เชิญโดย ${memberName(member.invitedBy)} · ${active}` : `เป็นคนตั้ง Workspace · ${active}`;
}

// Everyone in the Workspace, who brought them in and when they last used it (ADR 0059).
export function MembersPage() {
  const me = useCurrentMember();
  useAgents();
  const now = useNow();
  const members = useMembers()
    .filter((member) => !member.removed)
    .sort((a, b) => Number(b.owner) - Number(a.owner));
  const owners = members.filter((member) => member.owner).length;
  return (
    <Screen title="Member">
      <Section footer="Invitation เป็นลิงก์ที่ใช้ได้ครั้งเดียวและหมดอายุใน 24 ชั่วโมง ออกโดย Owner หรือคนที่มี Manage ที่ Agent อย่างน้อยหนึ่งตัว">
        {canInvite(me) ? <Row icon="add" title="เชิญ Member ใหม่" href="/members/invite" /> : <Row icon="lock" title="เชิญ Member ใหม่" detail="ต้องเป็น Owner หรือมี Manage ที่ Agent อย่างน้อยหนึ่งตัว" />}
      </Section>
      {members.map((member) => {
        const grants = Object.keys(member.grants).length;
        return (
          <Section key={member.id}>
            <Row
              icon={member.owner ? "shield" : "member"}
              title={member.id === me.id ? `${member.name} (คุณ)` : member.name}
              detail={detailOf(member, now)}
              value={member.owner ? "Owner" : grants ? `${grants} Agent` : "ยังไม่มี Grant"}
              href={`/members/${member.id}`}
            />
            {me.owner && (
              <ToggleRow
                title="เป็น Owner"
                detail={member.owner && owners <= 1 ? "Owner คนสุดท้าย ออกไม่ได้จนกว่าจะมี Owner คนอื่น" : "Owner มี Manage ทุก Agent เชิญคน และ Pair เครื่องได้"}
                value={member.owner}
                onChange={async (value) => {
                  const refusal = await setOwner(me, member.id, value);
                  if (refusal) inform("ทำไม่ได้", refusal);
                }}
              />
            )}
          </Section>
        );
      })}
      <Note>
        ระดับ Grant มีสามอย่าง: {Object.values(GRANT_LABEL).join(", ")} ที่ตั้งต่อ Agent แต่ละตัว Owner หลายคนได้ แต่ยิ่งมี Owner มาก ยิ่งมีกุญแจที่ทำได้ทุกอย่างหลายดอก
      </Note>
    </Screen>
  );
}
