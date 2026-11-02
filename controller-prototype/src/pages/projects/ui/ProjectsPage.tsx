import { router } from "expo-router";
import { useCurrentMember } from "../../../entities/member";
import { RIGHT_LABEL, rightOf, TEMPLATES, useProjects } from "../../../entities/project";
import { canCreateProject } from "../../../features/project-rules";
import { Empty, Note, Row, Screen, Section } from "../../../shared/ui";

// A Member sees only the Projects they hold a right in (ADR 0046).
export function ProjectsPage() {
  const projects = useProjects();
  const me = useCurrentMember();
  const visible = projects.filter((project) => rightOf(project, me));
  const mayCreate = canCreateProject(me);
  return (
    <Screen title="Project" right={mayCreate ? { label: "สร้าง", onPress: () => router.push("/projects/new") } : undefined}>
      <Note>Project คือที่ทำงานบน Machine หนึ่ง มีไฟล์ wiki และสิทธิ์ของตัวเอง แต่ละงานเลือกให้ Agent ตัวเดียวหรือ Team เข้าไปทำ</Note>
      {visible.length === 0 ? (
        <Empty
          icon="project"
          title="ยังไม่มี Project ที่คุณมีสิทธิ์"
          detail={mayCreate ? "สร้าง Project แรกได้ คุณจะได้ Manage ของ Project นั้น" : "สร้าง Project ได้เฉพาะคนที่มี Manage ที่ Agent อย่างน้อยหนึ่งตัว ขอสิทธิ์ใน Project จากคนที่มี Manage ของ Project นั้น"}
        />
      ) : (
        <Section footer={mayCreate ? undefined : "คุณสร้าง Project ไม่ได้ เพราะยังไม่มี Manage ที่ Agent ตัวไหน"}>
          {visible.map((project) => (
            <Row
              key={project.id}
              icon="project"
              title={project.name}
              detail={`${TEMPLATES[project.template].label} · ผู้ทำงาน ${project.doers.length}`}
              value={RIGHT_LABEL[rightOf(project, me) ?? "view"]}
              href={`/projects/${project.id}`}
            />
          ))}
        </Section>
      )}
    </Screen>
  );
}
