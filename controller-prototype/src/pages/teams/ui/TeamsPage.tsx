import { router } from "expo-router";
import { useAgents } from "../../../entities/agent";
import { useCurrentMember } from "../../../entities/member";
import { useProjects, useTeams } from "../../../entities/project";
import { canCreateTeam } from "../../../features/project-rules";
import { Empty, Note, Row, Screen, Section } from "../../../shared/ui";

// Who works, apart from where: one Team can work in several Projects (ADR 0064).
export function TeamsPage() {
  const me = useCurrentMember();
  const teams = useTeams();
  const agents = useAgents();
  const projects = useProjects();
  const mayCreate = canCreateTeam(me);
  return (
    <Screen title="Team" right={mayCreate ? { label: "สร้าง", onPress: () => router.push("/teams/new") } : undefined}>
      <Note>Team คือกลุ่ม Agent บน Machine เดียว แชตกับทีมแล้วเลือก Project ที่จะทำงาน ข้อความไปที่ Entry แล้ว Entry ส่งงานให้พนักงานได้ชั้นเดียว</Note>
      {teams.length === 0 ? (
        <Empty icon="members" title="ยังไม่มี Team" detail="งานที่ Agent ตัวเดียวทำได้ ไม่ต้องมี Team" />
      ) : (
        <Section>
          {teams.map((team) => (
            <Row
              key={team.id}
              icon="members"
              title={team.name}
              detail={`Entry ${agents.find((agent) => agent.id === team.entry)?.name ?? "?"} · ${team.employees.length} พนักงาน`}
              value={`${projects.filter((project) => project.doers.some((doer) => doer.kind === "team" && doer.id === team.id)).length} Project`}
              href={`/teams/${team.id}`}
            />
          ))}
        </Section>
      )}
    </Screen>
  );
}
