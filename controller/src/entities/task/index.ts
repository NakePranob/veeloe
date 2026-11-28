import en from "./i18n/en.json";
import th from "./i18n/th.json";

export const taskStatusI18n = { th, en };
export {
  addListedTasks,
  answersFromInbox,
  addPendingMessage,
  dismissPendingMessage,
  failPendingMessage,
  hideThread,
  isBudgetOut,
  isQuiet,
  latestEvents,
  latestOf,
  markRead,
  markPendingSent,
  needsYou,
  previewOf,
  pruneQuietRounds,
  saveTaskEvents,
  STATUS_DOT,
  statusOf,
  type Latest,
  type PendingRow,
  type TaskEventRow,
  type TaskStatus,
  titleOf,
  titleOfEvents,
  type TaskSummary,
} from "./model/tasks";
export { useAgentTaskCount, useAgentTaskSummaries, useHiddenThreads, useLatestTasks, useOpenTasks, usePendingMessages, useTaskEvents, useTaskRow, useTasksByIds, useThreadHeads, useTriggerRounds } from "./model/use-tasks";
export { headsOf, originOf, threadsOf } from "./model/threads";
export { TaskStatusDot } from "./ui/TaskStatusDot";
export { TaskStatusLabel } from "./ui/TaskStatusLabel";
