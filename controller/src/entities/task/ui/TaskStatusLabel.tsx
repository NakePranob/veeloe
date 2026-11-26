import { useT } from "../../../shared/i18n";
import { Label } from "../../../shared/ui";
import type { TaskStatus } from "../model/tasks";

// What a Task is doing, in one line, with its title after it when there is one.
export function TaskStatusLabel({ status, detail, variant = "subheadline" }: { status: TaskStatus; detail?: string; variant?: "subheadline" | "caption" }) {
  const t = useT("task-status");
  return (
    <Label variant={variant} numberOfLines={1}>
      {detail ? `${t(status)} · ${detail}` : t(status)}
    </Label>
  );
}
