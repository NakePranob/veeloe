import { Link } from "expo-router";
import { FlatList, Pressable, View } from "react-native";
import { Character, useAgents, type Agent } from "../../../entities/agent";
import { lastActivity, moodOf, preview, stateOf, statusOf, TaskStatus, useTasks, type Status, type Task } from "../../../entities/task";
import { ago, useNow } from "../../../shared/lib";
import { column, Icon, Label, radius, space, Text, useColors } from "../../../shared/ui";

const ORDER: Record<Status, number> = { waiting: 0, working: 1, done: 2, offline: 3 };

const AVATAR = 44;

interface Row {
  agent: Agent;
  task: Task;
  status: Status;
}

// One row per Agent, the ones waiting on you first. A row opens the Agent's
// Task that needs you, or else its latest one.
function rows(agents: Agent[], tasks: Task[], now: number): Row[] {
  return agents
    .flatMap((agent) => {
      const mine = tasks.filter((task) => task.agent === agent.id).sort((a, b) => lastActivity(b.events) - lastActivity(a.events));
      const task = mine.find((candidate) => stateOf(candidate.events, now) === "waiting") ?? mine[0];
      return task ? [{ agent, task, status: statusOf(task.events, agent.machine.online, now) }] : [];
    })
    .sort((a, b) => ORDER[a.status] - ORDER[b.status] || lastActivity(b.task.events) - lastActivity(a.task.events));
}

interface Props {
  // In split view the open Task is highlighted and a row replaces it rather than stacking.
  selectedTaskId?: string;
  split?: boolean;
}

// Laid out like Mail: sender and time, a status line, then two lines of preview.
export function AgentInbox({ selectedTaskId, split }: Props) {
  const agents = useAgents();
  const tasks = useTasks();
  const now = useNow();
  return (
    <FlatList
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={column}
      data={rows(agents, tasks, now)}
      keyExtractor={(row) => row.agent.id}
      // Reviewers and new Members land here first (ADR 0024), so it says plainly that nothing is real.
      ListHeaderComponent={
        <Label icon="info" style={{ paddingHorizontal: space.lg, paddingTop: space.xs, paddingBottom: space.md }}>
          Demo Workspace · ข้อมูลตัวอย่าง คำสั่งที่กดไม่ถูกส่งไปที่ Machine ไหน
        </Label>
      }
      // No separators: rows are set apart by their spacing, not by lines.
      renderItem={({ item }) => <InboxRow {...item} now={now} selected={item.task.id === selectedTaskId} replace={split} />}
    />
  );
}

function InboxRow({ agent, task, status, now, selected, replace }: Row & { now: number; selected: boolean; replace?: boolean }) {
  const colors = useColors();
  // Link's Slot drops a Pressable style function on web, so the layout lives on an inner View.
  return (
    <Link href={`/tasks/${task.id}`} replace={replace} asChild>
      <Pressable aria-selected={selected}>
        {({ pressed }) => {
          // What the row is painted with: the sidebar card in split view, else the screen.
          const fill = pressed ? "chipPressed" : selected ? "chip" : replace ? "surface" : "background";
          return (
            // An inset rounded highlight, as in an iPadOS sidebar, so it sits inside the card's
            // curve rather than cutting across it; content still lines up at space.lg.
            <View
              style={{
                flexDirection: "row",
                gap: space.md,
                marginHorizontal: space.sm,
                paddingHorizontal: space.sm,
                paddingVertical: space.md,
                borderRadius: radius.lg,
                borderCurve: "continuous",
                backgroundColor: colors[fill],
              }}
            >
              <Character look={agent.character} mood={moodOf(task.events, agent.machine.online, now)} size={AVATAR} backdrop={fill} />
              <View style={{ flex: 1, gap: space.xs / 2 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: space.xs }}>
                  <Text variant="headline" numberOfLines={1} style={{ flexShrink: 1 }}>
                    {agent.name}
                  </Text>
                  <Text variant="subheadline" tone="secondary" numberOfLines={1} style={{ flex: 1 }}>
                    {agent.machine.name}
                  </Text>
                  <Text variant="subheadline" tone="secondary">
                    {ago(lastActivity(task.events), now)}
                  </Text>
                  {!replace && <Icon name="disclosure" size="xs" color="tertiaryLabel" weight="semibold" />}
                </View>
                <TaskStatus status={status} detail={task.title} emphasize />
                <Text variant="subheadline" tone="secondary" numberOfLines={2} mono={status === "waiting"}>
                  {preview(task.events, now)}
                </Text>
              </View>
            </View>
          );
        }}
      </Pressable>
    </Link>
  );
}
