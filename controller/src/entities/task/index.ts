import en from "./i18n/en.json";
import th from "./i18n/th.json";

export const taskStatusI18n = { th, en };
export {
  addListedTasks,
  addPendingMessage,
  dismissPendingMessage,
  failPendingMessage,
  isBudgetOut,
  isQuiet,
  latestEvents,
  latestOf,
  listTasks,
  markPendingSent,
  needsYou,
  previewOf,
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
export { usePendingMessages, useTaskEvents, useTaskRow, useTaskSummaries } from "./model/use-tasks";
export { TaskStatusDot } from "./ui/TaskStatusDot";
export { TaskStatusLabel } from "./ui/TaskStatusLabel";
