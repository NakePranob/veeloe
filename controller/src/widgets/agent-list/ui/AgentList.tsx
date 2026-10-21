import { Link, useGlobalSearchParams, type Href } from "expo-router";
import { Pressable, View } from "react-native";
import { useAgents, type Agent } from "@/src/entities/agent";
import { agentState, preview, stateLabel, tasksOf, useTasks, type Task } from "@/src/entities/task";
import { t } from "@/src/shared/i18n";
import { cn } from "@/src/shared/lib";
import { Character, Text } from "@/src/shared/ui";

// An Agent opens on the Task that needs you, else its latest Task, else its profile.
function hrefFor(agent: Agent, tasks: Task[]): Href {
  const mine = tasksOf(tasks, agent.id);
  const task = mine.find((candidate) => candidate.state === "waiting") ?? mine[0];
  return task ? `/agents/${agent.id}/tasks/${task.id}` : `/agents/${agent.id}`;
}

function NeedsYou() {
  return (
    <View className="bg-waiting-soft rounded-full px-2 py-px">
      <Text className="text-waiting text-xs font-semibold">{t("state.waiting")}</Text>
    </View>
  );
}

const UnreadDot = () => <View className="bg-primary size-[9px] rounded-full" />;

// Pinned Agents show as big Characters on top; the rest are rows, flat on the surface,
// with whoever needs you first.
export function AgentList({ tileSize }: { tileSize: number }) {
  const agents = useAgents();
  const tasks = useTasks();
  const { agent: selected } = useGlobalSearchParams<{ agent?: string }>();
  const pinned = agents.filter((agent) => agent.pinned).slice(0, 3);
  const rest = agents
    .filter((agent) => !pinned.includes(agent))
    .sort((a, b) => Number(agentState(tasks, b.id, b.machine.online).state === "waiting") - Number(agentState(tasks, a.id, a.machine.online).state === "waiting"));

  return (
    <View>
      <View className="flex-row gap-1.5 py-3">
        {pinned.map((agent) => {
          const { state, mood } = agentState(tasks, agent.id, agent.machine.online);
          const unread = tasksOf(tasks, agent.id).some((task) => task.unread);
          return (
            <Link key={agent.id} href={hrefFor(agent, tasks)} asChild>
              <Pressable className={cn("active:bg-accent flex-1 items-center gap-0.5 rounded-2xl px-1 pt-2.5 pb-2", selected === agent.id && "bg-sidebar-accent")}>
                <View className={cn("mb-1 rounded-full p-0.5", state === "waiting" && "border-waiting border-[2.5px]")}>
                  <Character character={agent.character} mood={mood} size={tileSize} label={agent.id} />
                </View>
                <View className="flex-row items-center gap-1">
                  {unread && <UnreadDot />}
                  <Text className="text-sm font-semibold">{agent.id}</Text>
                </View>
                <Text className={cn("text-muted-foreground text-xs", state === "waiting" && "text-waiting font-semibold")}>{stateLabel(state)}</Text>
              </Pressable>
            </Link>
          );
        })}
      </View>
      {rest.map((agent) => {
        const { state, mood } = agentState(tasks, agent.id, agent.machine.online);
        const latest = tasksOf(tasks, agent.id)[0];
        const unread = tasksOf(tasks, agent.id).some((task) => task.unread);
        const line = !agent.machine.online ? `${agent.machine.id} · ${stateLabel("offline")}` : latest ? preview(latest) : "";
        return (
          <Link key={agent.id} href={hrefFor(agent, tasks)} asChild>
            <Pressable className={cn("active:bg-accent -mx-2.5 flex-row items-center gap-3 rounded-2xl px-2.5 py-2.5", selected === agent.id && "bg-sidebar-accent")}>
              <Character character={agent.character} mood={mood} size={44} label={agent.id} />
              <View className="min-w-0 flex-1">
                <View className="flex-row items-center gap-2">
                  <Text numberOfLines={1} className={cn("flex-1 font-semibold", state === "offline" && "text-muted-foreground")}>
                    {agent.id}
                  </Text>
                  <Text className="text-muted-foreground text-xs">{latest?.when}</Text>
                </View>
                <View className="flex-row items-center gap-2">
                  <Text numberOfLines={1} className={cn("text-muted-foreground flex-1 text-sm", unread && "text-foreground")}>
                    {line}
                  </Text>
                  {state === "waiting" ? <NeedsYou /> : unread ? <UnreadDot /> : null}
                </View>
              </View>
            </Pressable>
          </Link>
        );
      })}
    </View>
  );
}
