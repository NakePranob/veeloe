import { useState, type Ref } from "react";
import { TextInput, View, type TextInputInstance } from "react-native";
import { getAgent, useAgents } from "../../../entities/agent";
import { useCurrentMember, useMembers } from "../../../entities/member";
import { rightOf, useProject, useTeam } from "../../../entities/project";
import { getTask, getTasks, type Attachment, type Effort } from "../../../entities/task";
import { askQuestion, descendants, getRuntime, parseMentions, sendInProject, sendMessage, stopTurn } from "../../../features/demo-runtime";
import { Button, Card, column, confirm, inform, Label, Select, space, type, useColors } from "../../../shared/ui";

const EFFORTS: { value: Effort; label: string }[] = [
  { value: "low", label: "Effort ต่ำ" },
  { value: "medium", label: "Effort กลาง" },
  { value: "high", label: "Effort สูง" },
  { value: "max", label: "Effort สูงสุด" },
];

// ponytail: stands in for the OS's file picker. The last one is over the cap on purpose (ADR 0050).
const FILES: Attachment[] = [
  { name: "error-screenshot.png", size: 1_200_000 },
  { name: "requirements.pdf", size: 4_400_000 },
  { name: "demo-recording.mov", size: 64_000_000 },
];
const MAX_FILE = 20_000_000;

interface Props {
  agent: string;
  taskId: string;
  // A Turn is running, so the empty field offers Stop instead of send.
  busy: boolean;
  canStop: boolean;
  offline: boolean;
  // Who the Agent is working for instead, when it is another Task.
  busyWith: string | null;
  // Only the Stop button, for someone who may brake but not type.
  stopOnly?: boolean;
  // Ask: a read-only question beside the Turn instead of an order. "only" for someone who may not give orders (ADR 0046).
  ask?: "also" | "only";
  // In a Project room: @ picks people and employees who hold a right there.
  project?: string;
  inputRef: Ref<TextInputInstance>;
}

// Stop can cut work off halfway, so it asks first and lists every Turn that stops with it (ADR 0017).
async function confirmStop(taskId: string, stop: () => void) {
  const queued = getRuntime().queues;
  const stopping = [getTask(taskId), ...descendants(taskId, getTasks())].flatMap((task) => {
    const waiting = !!queued[task?.agent ?? ""]?.some((item) => item.taskId === task?.id);
    return task ? [`• ${getAgent(task.agent)?.name ?? "Agent"} · ${task.title}${waiting ? " (ที่รอคิวอยู่)" : ""}`] : [];
  });
  const below = stopping.length - 1;
  const message = `จะหยุด:\n${stopping.join("\n")}\n\nไฟล์ที่แก้ไปแล้วยังอยู่ และคุยต่อได้${getTask(taskId)?.parent ? "\nTask แม่ที่อยู่ข้างบนไม่ถูกหยุด Entry จะได้รับแจ้งว่า Task นี้ถูกหยุด" : ""}`;
  if (await confirm({ title: below ? `หยุด Turn นี้กับ Task ย่อย ${below} Task?` : "หยุด Turn นี้?", message, action: "หยุด", destructive: true })) stop();
}

// Like the AI apps on iOS: the field on top and, inside the same box, the
// Effort menu and the main action. That action is send, dimmed until there is
// something to send, or Stop while the Agent is working and the field is empty.
export function Composer({ agent, taskId, busy, canStop, offline, busyWith, stopOnly, ask, project: projectId, inputRef }: Props) {
  const colors = useColors();
  const project = useProject(projectId);
  const team = useTeam(getTask(taskId)?.team);
  const agents = useAgents();
  const members = useMembers();
  const me = useCurrentMember();
  const [mode, setMode] = useState<"order" | "ask">(ask === "only" ? "ask" : "order");
  const asking = ask === "only" || (ask === "also" && mode === "ask");
  const [text, setText] = useState("");
  // ponytail: high, the Messages API default; per-Agent defaults come with Agent settings.
  const [effort, setEffort] = useState<Effort>("high");
  const [picking, setPicking] = useState(false);
  const [files, setFiles] = useState<Attachment[]>([]);
  const message = text.trim();
  const ready = !!message || files.length > 0;
  const stopping = busy && !ready && canStop;

  function send() {
    if (asking) {
      const why = askQuestion(taskId, message);
      if (why) return inform("ถามไม่ได้", why);
    } else if (project) sendInProject(taskId, message, effort, files);
    else sendMessage(taskId, message, effort, files);
    setText("");
    setFiles([]);
    setPicking(false);
  }

  function attach(file: Attachment) {
    if (file.size > MAX_FILE) return inform("ไฟล์ใหญ่เกินไป", "ไฟล์ละไม่เกิน 20 MB ไฟล์ใหญ่กว่านี้ให้ส่งทาง git หรือ Connector");
    setFiles([...files.filter((old) => old.name !== file.name), file]);
    setPicking(false);
  }

  if (stopOnly) return <Button label="หยุด Turn นี้" onPress={() => confirmStop(taskId, () => stopTurn(taskId))} />;

  // "@" at the end of the text opens the people and employees who may be named in this Project (ADR 0046).
  const partial = project ? /@([^\s@]*)$/.exec(text)?.[1] : undefined;
  const choices =
    partial === undefined || !project
      ? []
      : [
          ...members.filter((member) => !member.removed && member.id !== me.id && rightOf(project, member)).map((member) => member.name),
          ...(team?.employees ?? []).flatMap((id) => agents.find((candidate) => candidate.id === id)?.name ?? []),
        ].filter((name) => name.toLowerCase().startsWith(partial.toLowerCase()));
  const outside = project ? parseMentions(text, project, team).outside : [];

  const placeholder = asking ? `ถาม ${project ? "Entry หรือ @พนักงาน" : agent} (อ่านอย่างเดียว)` : offline ? "ข้อความจะรอบนเครื่องนี้จนกว่า Machine จะกลับมา" : busyWith ? `ไม่ว่าง ${busyWith} ข้อความจะต่อคิว` : busy ? `ส่งต่อให้ ${agent} หลัง Turn นี้จบ` : `ส่งข้อความถึง ${agent}`;

  return (
    <View style={{ paddingTop: space.sm, paddingHorizontal: space.lg, paddingBottom: space.sm, backgroundColor: colors.background }}>
      <Card raised style={[column, { gap: space.xs, padding: space.sm }]}>
        {!asking && files.map((file) => (
          <Label key={file.name} icon="attach" style={{ paddingHorizontal: space.sm }}>
            {file.name} · {(file.size / 1_000_000).toFixed(1)} MB
          </Label>
        ))}
        {choices.length > 0 && (
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.xs, paddingHorizontal: space.xs }}>
            {choices.map((name) => (
              <Button key={name} label={`@${name}`} onPress={() => setText(text.replace(/@[^\s@]*$/, `@${name} `))} />
            ))}
          </View>
        )}
        {outside.length > 0 && (
          <Label icon="info" iconColor="orange" style={{ paddingHorizontal: space.sm }}>
            {outside.map((name) => `@${name}`).join(" ")} ไม่มีสิทธิ์ใน Project หรือไม่ได้อยู่ในทีมของงานนี้ จึงเป็นแค่ข้อความ ไม่มี push
          </Label>
        )}
        {ask === "only" && (
          <Label icon="ask" style={{ paddingHorizontal: space.sm }}>
            คุณมีสิทธิ์ Ask ถามได้อย่างเดียว ไม่มี bash ไม่ส่งงานต่อ และอ่านได้เท่าที่ Project เปิด
          </Label>
        )}
        {picking && !asking && (
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.xs, paddingHorizontal: space.xs }}>
            {FILES.map((file) => (
              <Button key={file.name} label={file.name} onPress={() => attach(file)} />
            ))}
          </View>
        )}
        <TextInput
          ref={inputRef}
          value={text}
          onChangeText={setText}
          multiline
          rows={1}
          placeholder={placeholder}
          placeholderTextColor={colors.tertiaryLabel}
          aria-label={`ส่งข้อความถึง ${agent}`}
          // One line of Thai at its natural height plus padding, so web shows no scrollbar.
          style={[type.body, { minHeight: 40, maxHeight: 140, paddingHorizontal: space.sm, paddingVertical: space.sm, color: colors.label }]}
        />
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
          <View style={{ flex: 1, flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space.xs }}>
            {!asking && <Button label="แนบไฟล์" icon="attach" onPress={() => setPicking(!picking)} />}
            {ask === "also" && (
              <Select
                label="ส่งแบบไหน"
                value={mode}
                options={[
                  { value: "order", label: busyWith ? "ต่อคิว" : "สั่งงาน" },
                  { value: "ask", label: "ถาม (Ask)" },
                ]}
                onChange={setMode}
              />
            )}
            {!asking && <Select label="Effort" value={effort} options={EFFORTS} onChange={setEffort} />}
          </View>
          {stopping && !asking ? (
            <Button label="หยุด" icon="stop" variant="primary" onPress={() => confirmStop(taskId, () => stopTurn(taskId))} />
          ) : (
            <Button label={asking ? "ถาม" : "ส่ง"} icon="send" variant="primary" disabled={asking ? !message : !ready} onPress={send} />
          )}
        </View>
      </Card>
    </View>
  );
}
