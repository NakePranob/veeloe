import { View } from "react-native";
import { useProject, type Worktree } from "../../../entities/project";
import { askToMerge, removeWorktree, treeBusy } from "../../../features/demo-runtime";
import { Button, Card, confirm, inform, Label, space, Text } from "../../../shared/ui";

const STATE = { open: "ยังไม่ได้รวม", merged: "รวมเข้า main แล้ว", removed: "ลบสำเนาแล้ว" } as const;

// A Task's own copy of the Project's repos, on one branch, so its Turns run beside other Tasks' (ADR 0047).
export function WorktreeCard({ tree, canUse }: { tree: Worktree; canUse: boolean }) {
  const project = useProject(tree.project);
  const code = tree.repos.length > 0;
  const busy = treeBusy(tree.taskId);

  async function remove() {
    const lost = tree.state === "open" && tree.changed > 0;
    if (!(await confirm({ title: "ลบสำเนาของห้องนี้?", message: lost ? `ยังมี ${tree.changed} ไฟล์ที่ยังไม่ได้รวม จะหายไปพร้อมสำเนา` : "ผลงานที่รวมแล้วอยู่ใน main ไม่หาย", action: "ลบ", destructive: true }))) return;
    const why = removeWorktree(tree.taskId);
    if (why) inform("ลบไม่ได้", why);
  }

  return (
    <Card>
      <Label icon="branch" strong tone="label">
        {code ? "สำเนาของห้อง (Worktree)" : "โฟลเดอร์ของห้องนี้"} · {STATE[tree.state]}
      </Label>
      <Text variant="footnote" tone="secondary" mono selectable>
        {code ? `branch ${tree.branch}` : tree.folder}
      </Text>
      {code && (
        <Text variant="footnote" tone="secondary">
          repo {tree.repos.join(", ")} · แก้แล้ว {tree.changed} ไฟล์ · {project?.name}
        </Text>
      )}
      {tree.state === "open" && (
        <Label icon="info" variant="caption">
          PORT={tree.port} ถูกตั้งให้สำเนานี้ dev server ไม่ชนกับ Task อื่น แต่ node_modules ซ้ำ และ test ที่ใช้ database ในเครื่องเดียวกันยังชนกันได้
        </Label>
      )}
      {canUse && tree.state !== "removed" && (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
          {code && tree.state === "open" && (
            <Button
              label="สั่ง Entry รวมงาน"
              disabled={tree.changed === 0 || busy}
              onPress={() => askToMerge(tree.taskId)}
            />
          )}
          <Button label="ลบสำเนา" onPress={remove} />
        </View>
      )}
      {code && tree.state === "open" && tree.changed === 0 && (
        <Text variant="caption" tone="secondary">
          ยังไม่มีอะไรให้รวม สั่งงานในห้องแล้วค่อยกลับมา
        </Text>
      )}
      {code && tree.state === "open" && (
        <Text variant="caption" tone="secondary">
          การรวมเป็นคำสั่ง git merge ที่ Entry รัน ถ้าไม่อยู่ใน Allowlist จะขอ Approval จากคนที่มี Approve ที่ Entry
        </Text>
      )}
      {!code && (
        <Text variant="caption" tone="secondary">
          Project นี้ไม่มี repo จึงไม่ต้องรวมงานกลับ ลบโฟลเดอร์ได้เมื่อไม่ใช้แล้ว
        </Text>
      )}
    </Card>
  );
}
