import { View } from "react-native";
import { t } from "@/src/shared/i18n";
import { cn } from "@/src/shared/lib";
import type { AgentState } from "../model/tasks";

const DOT: Record<AgentState, string> = {
  waiting: "bg-waiting",
  done: "bg-done",
  stopped: "bg-destructive",
  working: "bg-muted-foreground",
  idle: "bg-muted-foreground",
  offline: "bg-muted-foreground",
};

export function StateDot({ state, className }: { state: AgentState; className?: string }) {
  return <View className={cn("size-[7px] rounded-full", DOT[state], className)} />;
}

const LABEL = {
  waiting: "state.waiting",
  working: "state.working",
  done: "state.done",
  idle: "state.idle",
  stopped: "state.stopped",
  offline: "state.offline",
} as const;

export function stateLabel(state: AgentState) {
  return t(LABEL[state]);
}
