import { View } from "react-native";
import { useCurrentMember } from "../../../entities/member";
import { hasRight, useProjects, type Project } from "../../../entities/project";
import type { Task } from "../../../entities/task";
import { setTaskProject } from "../../../features/demo-runtime";
import { Label, Select, space } from "../../../shared/ui";

// Where this chat works, chosen in the middle of the empty chat. It locks with the first message,
// because the files, Worktree and rights are the Project's from then on (ADR 0064).
export function ProjectPicker({ task }: { task: Task }) {
  const me = useCurrentMember();
  const places = useProjects().filter((project) => hasRight(project, me, "ask") && project.doers.some((doer) => (task.team ? doer.kind === "team" && doer.id === task.team : doer.kind === "agent" && doer.id === task.agent)));
  const chosen: Project | undefined = places.find((project) => project.id === task.project);
  if (!places.length) return task.team ? <Label icon="lock">Team นี้ยังไม่อยู่ใน Project ที่คุณมีสิทธิ์ จึงเริ่มงานไม่ได้</Label> : null;
  return (
    <View style={{ alignItems: "center", gap: space.sm }}>
      <Select
        raised
        label="Project"
        value={task.project ?? ""}
        // A Team works only in a Project, so it has no "none" (ADR 0064).
        options={[...(task.team ? [] : [{ value: "", label: "ไม่มี Project" }]), ...places.map((project) => ({ value: project.id, label: project.name }))]}
        onChange={(id) => setTaskProject(task.id, places.find((project) => project.id === id), places.find((project) => project.id === id)?.worktreeDefault ?? false)}
      />
      {!!chosen?.repos.length && hasRight(chosen, me, "use") && (
        <Select
          raised
          label="Worktree"
          value={task.worktree ? "on" : "off"}
          options={[
            { value: "on", label: "ใช้ Worktree" },
            { value: "off", label: "ใช้ checkout หลัก" },
          ]}
          onChange={(value) => setTaskProject(task.id, chosen, value === "on")}
        />
      )}
    </View>
  );
}
