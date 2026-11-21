import { useT } from "../../../shared/i18n";
import { DotLabel } from "../../../shared/ui";
import { needsYou, STATUS_DOT, type TaskStatus } from "../model/tasks";

// An Agent's state under its name: the dot in the state's colour and its word, bold when a person is
// needed. A Budget used up today says so instead, in red (isSpent from the agent entity).
export function TaskStatusDot({ status, spent }: { status: TaskStatus; spent?: boolean }) {
  const t = useT("task-status");
  const loud = needsYou(status);
  return (
    <DotLabel color={spent ? "red" : STATUS_DOT[status]} tone={spent ? "danger" : loud ? "label" : "body"} strong={spent || loud}>
      {spent ? t("spent") : t(status)}
    </DotLabel>
  );
}
