import { Link, Stack, useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useHeaderHeight } from "expo-router/react-navigation";
import { useCallback, useRef, useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Pressable, ScrollView, View, type ScrollViewInstance, type TextInputInstance, type ViewInstance } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";
import { Character, useAgent, useAgents } from "../../../entities/agent";
import { useChannels } from "../../../entities/channel";
import { can, memberName, useCurrentMember, useMembers } from "../../../entities/member";
import { hasRight, useProject, useTeam, useWorktree } from "../../../entities/project";
import { append, approvals, moodOf, statusOf, TaskStatus, toolResults, turnOpen, updateTask, useTask, useTasks, type Attachment, type TaskEvent } from "../../../entities/task";
import { canAsk, canRead, canSend, canStop, waitingOn } from "../../../features/access";
import { askBlocked, markMentionsRead, queuePosition, sendMessage, setViewing, useRuntime } from "../../../features/demo-runtime";
import { ago, useNow } from "../../../shared/lib";
import { Button, Card, column, confirm, HeaderAction, Icon, inform, Label, motion, radius, space, Text, useColors } from "../../../shared/ui";
import { items } from "../model/items";
import { AgentText } from "./AgentText";
import { ApprovalCard } from "./ApprovalCard";
import { Composer } from "./Composer";
import { ProjectPicker } from "./ProjectPicker";
import { SubTasks } from "./SubTasks";
import { ToolCalls } from "./ToolCalls";
import { WorktreeCard } from "./WorktreeCard";

const size = (bytes: number) => `${(bytes / 1_000_000).toFixed(1)} MB`;

const FADE = space.xl + space.sm;

// The log fades out into the screen's colour above the composer, instead of being cut at a straight edge.
// Zero height, so it takes no room and draws upward over the end of the log.
function LogFade() {
  const colors = useColors();
  return (
    <View style={{ height: 0, pointerEvents: "none" }}>
      <Svg width="100%" height={FADE} style={{ position: "absolute", left: 0, right: 0, bottom: 0 }}>
        <Defs>
          <LinearGradient id="log-fade" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={colors.background} stopOpacity={0} />
            <Stop offset="1" stopColor={colors.background} />
          </LinearGradient>
        </Defs>
        <Rect width="100%" height="100%" fill="url(#log-fade)" />
      </Svg>
    </View>
  );
}

interface BubbleProps {
  text: string;
  attachments?: Attachment[];
  waiting: string | null;
  // The sender's name, when it is not the person reading.
  sender?: string;
}

// The Member's message, in an accent bubble on the right as in Messages.
function Bubble({ text, attachments, waiting, sender }: BubbleProps) {
  const colors = useColors();
  return (
    <View style={{ alignSelf: "flex-end", alignItems: "flex-end", maxWidth: "80%", gap: space.xs }}>
      {sender && (
        <Text variant="caption" tone="secondary">
          {sender}
        </Text>
      )}
      {attachments?.map((file) => (
        <Label key={file.name} icon="attach">
          {file.name} · {size(file.size)}
        </Label>
      ))}
      {!!text && (
        <View style={{ paddingHorizontal: space.md, paddingVertical: space.sm, borderRadius: radius.lg, borderCurve: "continuous", backgroundColor: colors.accent }}>
          <Text selectable style={{ color: colors.onAccent }}>
            {text}
          </Text>
        </View>
      )}
      {waiting && (
        <Label icon="time" variant="caption">
          {waiting}
        </Label>
      )}
    </View>
  );
}

// A file the Agent sent with send_file: the Controller fetches it only when opened (ADR 0050).
function FileCard({ name, bytes, online }: { name: string; bytes: number; online: boolean }) {
  const [cached, setCached] = useState(false);
  return (
    <Pressable
      role="button"
      onPress={() => {
        if (cached) return inform(name, "เปิดจากแคชบนเครื่องนี้");
        if (!online) return inform("เปิดไม่ได้ตอนนี้", "ไฟล์อยู่บน Machine ซึ่งปิดอยู่ และยังไม่อยู่ในแคชของแอป");
        setCached(true);
        inform(name, "ดึงมาด้วยคำขอที่เซ็นแล้ว และเก็บในแคชของแอป");
      }}
    >
      <Card style={{ flexDirection: "row", alignItems: "center", padding: space.md }}>
        <Icon name="file" size="md" />
        <View style={{ flex: 1 }}>
          <Text numberOfLines={1}>{name}</Text>
          <Text variant="caption" tone="secondary">
            {size(bytes)} · {cached ? "อยู่ในแคชแล้ว" : "กดเพื่อดึงจาก Machine"}
          </Text>
        </View>
        <Icon name="download" size="md" color="tertiaryLabel" />
      </Card>
    </Pressable>
  );
}

// Laid out like Messages: the Agent at the top, your messages in accent bubbles
// on the right. The Agent's replies have no bubble, because they run long and carry code.
export function TaskPage() {
  const { task: id } = useLocalSearchParams<{ task: string }>();
  const task = useTask(id);
  const agent = useAgent(task?.agent);
  const me = useCurrentMember();
  const members = useMembers();
  const tasks = useTasks();
  const agents = useAgents();
  const runtime = useRuntime();
  const now = useNow();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const frame = useRef<ViewInstance>(null);
  const [top, setTop] = useState(0);
  const scroll = useRef<ScrollViewInstance>(null);
  const contentSize = useRef({ content: 0, view: 0 });
  const headerHeight = useHeaderHeight();
  const input = useRef<TextInputInstance>(null);
  const [opened, setOpened] = useState(false);
  const project = useProject(task?.project);
  const team = useTeam(task?.team);
  const tree = useWorktree(task?.id);
  const channels = useChannels();

  useFocusEffect(
    useCallback(() => {
      setViewing(id ?? null);
      // Opening a Task reads the Mentions waiting in it (ADR 0046).
      if (id) markMentionsRead(id, me.id);
      return () => setViewing(null);
    }, [id, me.id]),
  );

  if (!task || !agent) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
        <Stack.Screen options={{ title: "Task" }} />
        <Text tone="secondary">ไม่พบ Task นี้</Text>
      </View>
    );
  }

  const { id: taskId } = task;
  const { name: agentName } = agent;
  const readable = canRead(me, task);
  const waiting = waitingOn(me, task, now);

  if (!readable && !waiting) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: space.xl, gap: space.sm }}>
        <Stack.Screen options={{ title: agentName }} />
        <Icon name="lock" size="xl" color="tertiaryLabel" />
        <Text tone="secondary" style={{ textAlign: "center" }}>
          {task.project
            ? "Task นี้เป็นของ Project ที่คุณไม่มีสิทธิ์ หรือห้องนี้ปิดจาก Ask ขอสิทธิ์จากคนที่มี Manage ของ Project"
            : `${memberName(task.starter)} ยังไม่ได้เปิด Task นี้ให้เห็น ถ้าอยากรู้เรื่องนี้ ถาม ${agentName} ได้`}
        </Text>
      </View>
    );
  }

  const showHistory = readable || opened;
  // Nobody has written yet, so the one who opened it may still choose where it works (ADR 0064).
  const choosing = task.events.length === 0 && !task.parent && task.starter === me.id && (task.source === "app" || task.source === "project");
  const status = statusOf(task.events, agent.machine.online, now);
  const approvalStatus = approvals(task.events, now);
  const results = toolResults(task.events);
  const canApprove = can(me, agent.id, "approve");
  const canManage = can(me, agent.id, "manage");
  const othersWithUse = members.filter((member) => member.id !== me.id && !member.removed && can(member, agent.id, "use"));

  // The Agent is on someone's work: who, without what (ADR 0060).
  const runningId = runtime.running[agent.id];
  const runningTask = runningId && runningId !== taskId ? tasks.find((candidate) => candidate.id === runningId) : undefined;
  const busyWith = runningTask && !task.worktree ? (runningTask.starter === me.id ? `มี Task อื่นของคุณ` : `มีงานของ ${memberName(runningTask.starter)}`) : null;

  const children = tasks.filter((candidate) => candidate.parent === taskId);
  const parentTask = task.parent ? tasks.find((candidate) => candidate.id === task.parent) : undefined;
  const channel = task.source === "channel" ? channels.find((candidate) => candidate.taskId === taskId || `${candidate.platform} · ${candidate.chatName}` === task.title) : undefined;
  // Ask: beside a Turn in a Project room, or outside a Project instead of queueing behind another Task (ADR 0011, 0046).
  const askRight = canAsk(me, task);
  const askNow = askRight && !askBlocked(task, me);
  const ask = project ? (canSend(me, task) ? "also" : askRight ? "only" : undefined) : askNow && canSend(me, task) ? "also" : undefined;
  const askAnswered = new Set(task.events.flatMap((event) => (event.type === "ask_answer" ? [event.id] : [])));

  function waitLabel(seq: number) {
    if (task?.outbox?.includes(seq)) return "รอส่ง · จะส่งเมื่อ Machine กลับมา";
    const position = queuePosition(runtime, agent!.id, seq, taskId);
    if (!position) return null;
    return busyWith ? `รอคิวที่ ${position} · ไม่ว่าง ${busyWith}` : `รอคิวที่ ${position} · ${agentName} จะอ่านเมื่อถึงคิว`;
  }

  // scrollToEnd clamps at 0, but under iOS 26's glass header the list rests above 0 by
  // the header's height, so a short Task would slide its first lines under the header.
  // Scroll only as far as the end needs, and not at all when everything fits.
  function toEnd(animated: boolean) {
    const { content, view } = contentSize.current;
    const y = content - view;
    if (view && y > top - headerHeight) scroll.current?.scrollTo({ y, animated });
  }

  function agentsById(agentId: string) {
    return agents.find((candidate) => candidate.id === agentId)?.name;
  }

  function who(member?: string) {
    return !member || member === me.id ? "คุณ" : memberName(member);
  }

  function render(event: TaskEvent) {
    switch (event.type) {
      case "message":
        if (!showHistory) return null;
        return <Bubble key={event.seq} text={event.text} attachments={event.attachments} waiting={waitLabel(event.seq)} sender={event.member && event.member !== me.id ? memberName(event.member) : undefined} />;
      case "text":
        return showHistory ? <AgentText key={event.seq} text={event.text} /> : null;
      case "approval_request":
        return (
          <ApprovalCard
            key={event.seq}
            taskId={taskId}
            agent={agent!}
            request={event}
            status={approvalStatus.get(event.id) ?? "open"}
            answeredBy={task?.events.find((candidate) => candidate.type === "approval_answer" && candidate.id === event.id)}
            canAnswer={canApprove}
            canManage={canManage}
            now={now}
            onSteer={() => input.current?.focus()}
            onOpenConversation={
              showHistory
                ? undefined
                : () => {
                    append(taskId, { type: "opened", member: me.id });
                    setOpened(true);
                  }
            }
          />
        );
      case "ask":
        if (!showHistory) return null;
        return (
          <View key={event.seq} style={{ gap: space.xs }}>
            <Bubble text={event.text} waiting={null} sender={event.member && event.member !== me.id ? memberName(event.member) : undefined} />
            <Label icon="ask" variant="caption" style={{ alignSelf: "flex-end" }}>
              Ask · ถาม {agentsById(event.to) ?? agentName}
            </Label>
            {!askAnswered.has(event.id) && (
              <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
                <ActivityIndicator size="small" />
                <Text variant="footnote" tone="secondary">
                  กำลังอ่านเพื่อตอบ…
                </Text>
              </View>
            )}
          </View>
        );
      case "ask_answer": {
        if (!showHistory) return null;
        const question = task!.events.find((candidate) => candidate.type === "ask" && candidate.id === event.id);
        const who = (question?.type === "ask" && agentsById(question.to)) || agentName;
        return (
          <Card key={event.seq}>
            <Label icon={event.refused ? "lock" : "ask"} iconColor={event.refused ? "orange" : "secondaryLabel"} strong tone="label">
              {who} ตอบด้วย Ask{question?.type === "ask" ? ` · “${question.text.slice(0, 28)}”` : ""}
            </Label>
            <AgentText text={event.text} />
            <Label icon="info" variant="caption">
              อ่านอย่างเดียว ไม่ใช้ bash ไม่ส่งงานต่อ ไม่เรียก Connector{event.tools.length ? ` · ${event.tools.join(", ")}` : ""}
            </Label>
          </Card>
        );
      }
      case "stop":
        return (
          <Label key={event.seq} icon="stopped" style={{ alignSelf: "center" }}>
            {who(event.member)}หยุด Turn นี้ · {ago(event.at, now)}
          </Label>
        );
      case "interrupted":
        return (
          <Card key={event.seq}>
            <Label icon="restart">{agent!.machine.name} เริ่มใหม่กลาง Turn</Label>
            <Text>ไฟล์ที่แก้ไว้ยังอยู่ และ {agentName} จะไม่ทำต่อเอง เพราะอาจรันคำสั่งเดิมซ้ำ</Text>
            {canSend(me, task!) && status === "interrupted" && (
              <View style={{ flexDirection: "row" }}>
                <Button label="ทำต่อ" variant="primary" onPress={() => sendMessage(taskId, "ทำต่อ", "high")} />
              </View>
            )}
          </Card>
        );
      case "budget_out":
        return (
          <Card key={event.seq}>
            <Label icon="info" iconColor="orange">
              Budget ของวันนี้หมดแล้ว
            </Label>
            <Text>งานใหม่จะเริ่มตอน 04:00 ตามเวลาของ {agent!.machine.name} หรือเมื่อเพิ่ม Budget ไฟล์ที่แก้ไว้ยังอยู่</Text>
            {canManage && status === "budget" && (
              <View style={{ flexDirection: "row" }}>
                <Button label="เพิ่ม Budget" variant="primary" onPress={() => router.push(`/agents/${agent!.id}`)} />
              </View>
            )}
          </Card>
        );
      case "budget_restored":
        return (
          <Label key={event.seq} icon="done" iconColor="green" style={{ alignSelf: "center" }}>
            Budget พร้อมใช้แล้ว
          </Label>
        );
      case "file":
        return <FileCard key={event.seq} name={event.name} bytes={event.size} online={agent!.machine.online} />;
      case "compaction":
        return (
          <Label key={event.seq} icon="thread" style={{ alignSelf: "center" }}>
            ย่อ context แล้ว คุณยังเห็นประวัติเต็ม
          </Label>
        );
      case "opened":
        return (
          <Label key={event.seq} icon="watch" style={{ alignSelf: "center" }}>
            {who(event.member)}เปิดดูบทสนทนานี้จาก Approval · {ago(event.at, now)}
          </Label>
        );
      default:
        return null;
    }
  }

  return (
    // The keyboard offset is where this screen starts in the window, measured: 0 under
    // iOS 26's glass header, the header's height under an opaque one. The home
    // indicator's inset sits outside the avoiding view so the keyboard never counts it twice.
    <View ref={frame} style={{ flex: 1, paddingBottom: insets.bottom }} onLayout={() => frame.current?.measureInWindow((_x, y) => setTop(y))}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={process.env.EXPO_OS === "ios" ? "padding" : undefined} keyboardVerticalOffset={top}>
        <ScrollView
          ref={scroll}
          contentInsetAdjustmentBehavior="automatic"
          keyboardDismissMode="interactive"
          keyboardShouldPersistTaps="handled"
          // The end of the log rests clear of the fade.
          contentContainerStyle={[column, { padding: space.lg, paddingBottom: FADE, gap: space.lg }, choosing && { flexGrow: 1, justifyContent: "center" }]}
          onContentSizeChange={(_w, h) => {
            contentSize.current.content = h;
            toEnd(false);
          }}
          // The view shrinks when the keyboard opens; keep the latest event above the composer, as Messages does.
          onLayout={(e) => {
            contentSize.current.view = e.nativeEvent.layout.height;
            toEnd(true);
          }}
        >
          {/* The Agent's name with what it is doing under it, so the state stays in view however far the log scrolls. */}
          <Stack.Screen
            options={{
              title: team?.name ?? agentName,
              headerTitle: () => (
                <View style={{ alignItems: "center" }}>
                  <Text variant="headline" numberOfLines={1}>
                    {team?.name ?? agentName}
                  </Text>
                  {/* A Task nobody has written in is not "done" yet. */}
                  {(task.events.length > 0 || status !== "done") && <TaskStatus status={status} variant="caption" />}
                </View>
              ),
            }}
          />
          {/* Other Tasks, a new Task and the settings all live on the Agent's page, or the Team's. */}
          {team ? (
            <HeaderAction label="ตั้งค่า Team" icon="settings" onPress={() => router.push(`/teams/${team.id}`)} />
          ) : (
            can(me, agent.id, "use") && <HeaderAction label="ตั้งค่า Agent" icon="settings" onPress={() => router.push(`/agents/${agent.id}`)} />
          )}
          <View style={{ alignItems: "center", gap: space.xs, paddingBottom: space.sm }}>
            {/* Tapping the Agent's Character opens the Agent (Link's Slot drops a style function on web, hence the inner View). */}
            <Link href={`/agents/${agent.id}`} asChild>
              <Pressable role="button" aria-label={`เปิดหน้า ${agentName}`} hitSlop={space.xs}>
                {({ pressed }) => (
                  <View style={{ transform: [{ scale: pressed ? motion.press : 1 }] }}>
                    <Character look={agent.character} mood={moodOf(task.events, agent.machine.online, now)} size={56} />
                  </View>
                )}
              </Pressable>
            </Link>
            <Text variant="footnote" tone="secondary" style={{ textAlign: "center" }}>
              {task.title}
            </Text>
            <Text variant="caption" tone="secondary">
              {agent.machine.name} · {task.events[0] ? ago(task.events[0].at, now) : "ยังไม่ได้เริ่ม"}
            </Text>
            {project && !choosing && (
              <Link href={`/projects/${project.id}`} asChild>
                <Pressable role="link">
                  <Label icon="project" variant="caption">
                    Project {project.name}
                    {parentTask ? ` · Task ย่อยของ “${parentTask.title}”` : ""}
                  </Label>
                </Pressable>
              </Link>
            )}
            {task.source === "channel" && (
              <Link href={channel ? `/channels/${channel.id}` : "/channels"} asChild>
                <Pressable role="link">
                  <Label icon="channel" variant="caption">
                    มาจาก Channel · {channel?.chatName ?? "แชต"} · ปิดไม่ให้พิมพ์จากแอป
                  </Label>
                </Pressable>
              </Link>
            )}
            {/* The starter alone sees it until they open it, which cannot be undone (ADR 0060). It is tidiness, not a secret, so the word is never "private". */}
            {task.source === "app" && !task.project && (
              task.shared ? (
                <Label icon="members" variant="caption">
                  คนที่มี Use เห็น Task นี้
                </Label>
              ) : task.starter === me.id ? (
                <View style={{ alignItems: "center", gap: space.xs }}>
                  <Label icon="member" variant="caption">
                    แชตของฉัน{agent.searchOtherTasks && othersWithUse.length ? ` · ${agentName} อาจเล่าเรื่องนี้ให้คนอื่นที่ใช้ตัวนี้ฟังได้` : ""}
                  </Label>
                  {othersWithUse.length > 0 && (
                    <Button
                      label="เปิดให้คนที่มี Use เห็น"
                      onPress={async () => {
                        if (await confirm({ title: "เปิด Task นี้ให้คนอื่นเห็น?", message: `${othersWithUse.map((member) => member.name).join(", ")} จะเปิดดูได้ และย้อนกลับไม่ได้`, action: "เปิดให้เห็น" })) updateTask(taskId, { shared: true });
                      }}
                    />
                  )}
                </View>
              ) : null
            )}
          </View>
          {choosing && <ProjectPicker task={task} />}
          {tree && !task.parent && <WorktreeCard tree={tree} canUse={!!project && hasRight(project, me, "use")} />}
          {project && !task.worktree && !task.parent && status === "working" && (
            <Label icon="branch" variant="caption" style={{ alignSelf: "center" }}>
              ไม่ได้ติ๊ก Worktree ใช้ checkout หลักร่วมกัน ทีละ Turn
            </Label>
          )}
          {items(task.events).map((item) =>
            item.kind === "tools" ? showHistory ? <ToolCalls key={item.calls[0].seq} calls={item.calls} results={results} /> : null : render(item.event),
          )}
          {team && project && !task.parent && task.events.length === 0 && hasRight(project, me, "use") && (
            <Card>
              <Label icon="info" strong tone="label">
                ลองสั่งดู (Demo Workspace)
              </Label>
              <Text variant="footnote" tone="secondary">
                • “@Deployer ตรวจ build” Entry ส่งงานให้ตัวที่แท็ก{"\n"}• “… แตก 8 งาน” ส่งเกินเพดาน ครั้งที่เกินได้ error{"\n"}• “… แล้วส่งต่อให้ตัวอื่น” พนักงานส่งต่อไม่ได้{"\n"}• “wiki: หัวข้อ: เนื้อหา” เขียน wiki ได้เฉพาะผู้เขียนคนเดียว{"\n"}• “@ชื่อคน” ส่ง push ให้คนนั้น{"\n"}• เปลี่ยนเป็น “ถาม (Ask)” ที่ปุ่มข้างช่องพิมพ์ แล้วลองถามถึง secrets/ หรือเรื่องที่ห้ามตอบ
              </Text>
            </Card>
          )}
          {children.length > 0 && <SubTasks children={children} now={now} />}
          {status === "working" && (runtime.running[agent.id] === taskId || task.worktree) && (
            <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
              <ActivityIndicator size="small" />
              <Text variant="footnote" tone="secondary">
                กำลังทำงาน…
              </Text>
            </View>
          )}
        </ScrollView>
        <LogFade />
        {task.team && !project ? null : canSend(me, task) || (project && askRight) ? (
          <Composer agent={agentName} taskId={taskId} busy={turnOpen(task.events)} canStop={canStop(me, task)} offline={!agent.machine.online} busyWith={busyWith} ask={ask} project={project?.id} inputRef={input} />
        ) : (
          <View style={{ padding: space.lg, gap: space.sm, alignItems: "center" }}>
            {turnOpen(task.events) && canStop(me, task) && <Composer stopOnly agent={agentName} taskId={taskId} busy canStop offline={false} busyWith={null} inputRef={input} />}
            <Label icon="lock">
              {task.parent
                ? "นี่คือ Task ย่อยของพนักงาน อ่านและหยุดได้ แต่พิมพ์ไม่ได้ ให้สั่งที่ห้องของ Entry"
                : task.source === "channel"
                  ? "Task นี้มาจาก Channel อ่านได้อย่างเดียว หยุดและตอบ Approval ได้ แต่พิมพ์ไม่ได้"
                  : task.readOnly
                    ? "ห้องนี้ปิดแล้ว อ่านได้อย่างเดียว"
                    : "คุณอ่าน Task นี้ได้ แต่พิมพ์ไม่ได้"}
            </Label>
          </View>
        )}
      </KeyboardAvoidingView>
    </View>
  );
}
