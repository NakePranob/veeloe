import en from "./i18n/en.json";
import th from "./i18n/th.json";

export const taskStatusI18n = { th, en };
export {
  addListedTasks,
  addPendingMessage,
  dismissPendingMessage,
  failPendingMessage,
  isBudgetOut,
  latestEvents,
  latestOf,
  latestTaskOf,
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
  type TaskRow,
  type TaskStatus,
  type TaskSummary,
} from "./model/tasks";
export { usePendingMessages, useTaskEvents, useTaskRow, useTaskSummaries } from "./model/use-tasks";
export { TaskStatusDot } from "./ui/TaskStatusDot";
export { TaskStatusLabel } from "./ui/TaskStatusLabel";
