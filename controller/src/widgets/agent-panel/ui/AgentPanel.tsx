import { Link } from "expo-router";
import { Check, ChevronRight, Cloud, Globe, Hand, Layers, Monitor, Route, Shield, Timer, X } from "lucide-react-native";
import type { ReactNode } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { delegatesFrom, useAgent } from "@/src/entities/agent";
import { agentState, StateDot, stateLabel, tasksOf, useTask, useTasks, type Step } from "@/src/entities/task";
import { t } from "@/src/shared/i18n";
import { cn } from "@/src/shared/lib";
import { Button, Character, Icon, Text } from "@/src/shared/ui";

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View className="mt-6">
      <Text className="text-muted-foreground mb-1 text-xs font-medium">{title}</Text>
      {children}
    </View>
  );
}

function Row({ icon, name, detail, current, link }: { icon: typeof Monitor; name: string; detail?: string; current?: boolean; link?: boolean }) {
  return (
    <View className={cn("min-h-12 flex-row items-center gap-3 py-1.5", current && "bg-secondary -mx-2 rounded-xl px-2")}>
      <Icon as={icon} className="text-muted-foreground size-[18px]" />
      <View className="min-w-0 flex-1">
        <Text numberOfLines={1} className="text-[15px] font-medium">
          {name}
        </Text>
        {detail ? (
          <Text numberOfLines={1} className="text-muted-foreground text-xs">
            {detail}
          </Text>
        ) : null}
      </View>
      {link && <Icon as={ChevronRight} className="text-muted-foreground size-4" />}
    </View>
  );
}

const STEP_ICON = { done: Check, live: Hand, next: Cloud };

function Steps({ steps }: { steps: Step[] }) {
  return (
    <View>
      {steps.map((step) => (
        <View key={step.label} className="min-h-10 flex-row items-center gap-3">
          <Icon as={STEP_ICON[step.state]} className={cn("size-[18px]", step.state === "live" ? "text-foreground" : "text-muted-foreground")} />
          <Text className={cn("flex-1 text-[15px]", step.state === "next" && "text-muted-foreground")}>{step.label}</Text>
          {step.seconds !== undefined && <Text className="text-muted-foreground text-xs tabular-nums">{step.seconds} s</Text>}
        </View>
      ))}
    </View>
  );
}

// The Agent's details: the open Task's steps, its other Tasks, its Machine and what it may do.
// The desktop panel and the phone profile are the same thing.
export function AgentPanel({ agentId, taskId, onClose }: { agentId: string; taskId?: string; onClose?: () => void }) {
  const agent = useAgent(agentId);
  const tasks = useTasks();
  const task = useTask(taskId ?? "");
  if (!agent) return null;
  const { state, mood } = agentState(tasks, agent.id, agent.machine.online);
  const from = delegatesFrom(agent.id);

  return (
    <View className="flex-1">
      {onClose && (
        <View className="border-border min-h-[62px] flex-row items-center border-b pr-2 pl-4">
          <Text className="flex-1 text-[15px] font-semibold">{agent.id}</Text>
          <Button variant="ghost" size="icon" onPress={onClose} accessibilityLabel={t("details.close")}>
            <Icon as={X} className="size-[18px]" />
          </Button>
        </View>
      )}
      <ScrollView>
        <View className="px-5 pt-5 pb-8">
          <View className="items-center">
            <Character character={agent.character} mood={mood} size={96} label={agent.id} />
            <Text className="mt-1.5 text-2xl font-bold">{agent.id}</Text>
            <Text className="text-muted-foreground text-sm">
              {t("agent.on")} {agent.machine.id} · <Text className="text-muted-foreground font-mono text-sm">{agent.workdir}</Text>
            </Text>
            <View className="bg-secondary mt-3 flex-row items-center gap-2 rounded-full px-3 py-1.5">
              <StateDot state={state} />
              <Text className="text-sm font-medium">{stateLabel(state)}</Text>
            </View>
          </View>

          {task?.steps && (
            <Section title={t("panel.thisTask")}>
              <Steps steps={task.steps} />
            </Section>
          )}

          <Section title={t("panel.tasks")}>
            {tasksOf(tasks, agent.id).map((item) => (
              <Link key={item.id} href={`/agents/${agent.id}/tasks/${item.id}`} asChild>
                <Pressable className="active:opacity-60">
                  <Row icon={Layers} name={item.title} detail={item.when} current={item.id === taskId} link />
                </Pressable>
              </Link>
            ))}
          </Section>

          <Section title={t("panel.machine")}>
            <Row icon={Monitor} name={agent.machine.id} detail={`${t(agent.machine.online ? "machine.online" : "machine.offline")} · Runtime ${agent.machine.runtime}`} />
            <Row icon={Globe} name={t("panel.egress")} detail={agent.machine.egress.join(", ")} />
          </Section>

          <Section title={t("panel.permissions")}>
            <Row icon={Shield} name={t("panel.allowlist")} detail={agent.allowlist.join(" · ")} />
            <Row icon={Timer} name="Approval" detail={`${agent.expiryMinutes} min`} />
          </Section>

          <Section title={t("panel.flow")}>
            <Row icon={Route} name={t("panel.flowOut")} detail={agent.delegatesTo.join(", ") || t("panel.noLines")} />
            <Row icon={Route} name={t("panel.flowIn")} detail={from.join(", ") || t("panel.noLines")} />
          </Section>
        </View>
      </ScrollView>
    </View>
  );
}
