import { Link, router } from "expo-router";
import { FlatList, Pressable, View } from "react-native";
import { Character, useAgents, type Agent } from "../../../entities/agent";
import { can, useCurrentMember, type Member } from "../../../entities/member";
import { hasRight, useProjects, useTeams, type Project, type Team } from "../../../entities/project";
import { lastActivity, moodOf, preview, stateOf, statusOf, TaskStatus, useTasks, type Status, type Task } from "../../../entities/task";
import { inInbox } from "../../../features/access";
import { newTask, newTeamTask } from "../../../features/demo-runtime";
import { ago, useNow } from "../../../shared/lib";
import { column, Icon, Label, radius, space, Text, useColors } from "../../../shared/ui";

const ORDER: Record<Status, number> = { waiting: 0, budget: 1, interrupted: 1, working: 2, done: 3, offline: 4 };

const AVATAR = 44;

interface Row {
  agent: Agent;
  // Set on a Team's row, which shows its Entry's Character.
  team?: Team;
  task?: Task;
  status: Status;
}

// One row per Agent, the ones waiting on you first. A row opens the Agent's Task that needs
// you, or else your latest one. Only Tasks you started or that wait on you are here (ADR 0031).
function rows(agents: Agent[], tasks: Task[], teams: Team[], projects: Project[], me: Member, now: number): Row[] {
  const teamRows = teams.flatMap((team): Row[] => {
    const agent = agents.find((candidate) => candidate.id === team.entry);
    if (!agent) return [];
    const mine = tasks.filter((task) => task.team === team.id && inInbox(me, task, now)).sort((a, b) => lastActivity(b.events) - lastActivity(a.events));
    const task = mine.find((candidate) => stateOf(candidate.events, now) === "waiting") ?? mine[0];
    if (task) return [{ agent, team, task, status: statusOf(task.events, agent.machine.online, now) }];
    return placesOf(team, projects, me).length ? [{ agent, team, status: agent.machine.online ? "done" : "offline" }] : [];
  });
  return [...teamRows, ...agents
    .flatMap((agent): Row[] => {
      const mine = tasks.filter((task) => task.agent === agent.id && !task.team && inInbox(me, task, now)).sort((a, b) => lastActivity(b.events) - lastActivity(a.events));
      const task = mine.find((candidate) => stateOf(candidate.events, now) === "waiting") ?? mine[0];
      if (task) return [{ agent, task, status: statusOf(task.events, agent.machine.online, now) }];
      return can(me, agent.id, "use") ? [{ agent, status: agent.machine.online ? "done" : "offline" }] : [];
    })]
    .sort((a, b) => ORDER[a.status] - ORDER[b.status] || lastActivity(b.task?.events ?? []) - lastActivity(a.task?.events ?? []));
}

const placesOf = (team: Team, projects: Project[], me: Member) => projects.filter((project) => hasRight(project, me, "ask") && project.doers.some((doer) => doer.kind === "team" && doer.id === team.id));

interface Props {
  // In split view the open Task is highlighted and a row replaces it rather than stacking.
  selectedTaskId?: string;
  split?: boolean;
}

// Laid out like Mail: sender and time, a status line, then two lines of preview.
export function AgentInbox({ selectedTaskId, split }: Props) {
  const agents = useAgents();
  const tasks = useTasks();
  const teams = useTeams();
  const projects = useProjects();
  const me = useCurrentMember();
  const now = useNow();
  return (
    <FlatList
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={column}
      data={rows(agents, tasks, teams, projects, me, now)}
      keyExtractor={(row) => row.team?.id ?? row.agent.id}
      // Reviewers and new Members land here first (ADR 0024), so it says plainly that nothing is real.
      ListHeaderComponent={
        <Label icon="info" style={{ paddingHorizontal: space.lg, paddingTop: space.xs, paddingBottom: space.md }}>
          Demo Workspace · ใช้งานในนาม {me.name} คำสั่งที่กดไม่ถูกส่งไปที่ Machine ไหน
        </Label>
      }
      ListEmptyComponent={
        <Text tone="secondary" style={{ textAlign: "center", padding: space.xl }}>
          ยังไม่มี Agent ที่คุณใช้ได้ ขอ Grant จาก Owner หรือคนที่มี Manage
        </Text>
      }
      // No separators: rows are set apart by their spacing, not by lines.
      renderItem={({ item }) => <InboxRow {...item} place={item.team && placesOf(item.team, projects, me)[0]} now={now} selected={!!item.task && item.task.id === selectedTaskId} replace={split} />}
    />
  );
}

function InboxRow({ agent, team, place, task, status, now, selected, replace }: Row & { place?: Project; now: number; selected: boolean; replace?: boolean }) {
  const colors = useColors();
  const content = (pressed: boolean) => {
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
        <Character look={agent.character} mood={task ? moodOf(task.events, agent.machine.online, now) : agent.machine.online ? "idle" : "offline"} size={AVATAR} backdrop={fill} />
        <View style={{ flex: 1, gap: space.xs / 2 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: space.xs }}>
            <Text variant="headline" numberOfLines={1} style={{ flexShrink: 1 }}>
              {team?.name ?? agent.name}
            </Text>
            <Text variant="subheadline" tone="secondary" numberOfLines={1} style={{ flex: 1 }}>
              {agent.machine.name}
            </Text>
            {task && (
              <Text variant="subheadline" tone="secondary">
                {ago(lastActivity(task.events), now)}
              </Text>
            )}
            {!replace && <Icon name="disclosure" size="xs" color="tertiaryLabel" weight="semibold" />}
          </View>
          {task ? <TaskStatus status={status} detail={task.title} emphasize /> : <TaskStatus status={status} />}
          <Text variant="subheadline" tone="secondary" numberOfLines={2} mono={status === "waiting"}>
            {task ? preview(task.events, now) : `เริ่มคุยกับ ${team?.name ?? agent.name}`}
          </Text>
        </View>
      </View>
    );
  };
  // Tapping goes straight into the chat; an Agent with no Task yet gets an empty one.
  if (!task) {
    return (
      <Pressable role="button" onPress={() => router.push(`/tasks/${(team ? newTeamTask(team, place) : newTask(agent.id)).id}`)}>
        {({ pressed }) => content(pressed)}
      </Pressable>
    );
  }
  // Link's Slot drops a Pressable style function on web, so the layout lives on an inner View.
  return (
    <Link href={`/tasks/${task.id}`} replace={replace} asChild>
      <Pressable aria-selected={selected}>{({ pressed }) => content(pressed)}</Pressable>
    </Link>
  );
}
