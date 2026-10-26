import { Label } from "../../../shared/ui";
import { STATUS_LABEL, type Status } from "../model/state";

interface Props {
  status: Status;
  // Text after the status, such as the Task's title.
  detail?: string;
  variant?: "subheadline" | "caption";
  // In a list, a Task that needs the Member is set in black and bold, not just marked.
  emphasize?: boolean;
}

// The raised hand appears only when a person is needed, the one state that asks for colour.
export function TaskStatus({ status, detail, variant = "subheadline", emphasize }: Props) {
  const waiting = status === "waiting";
  return (
    <Label
      icon={waiting ? "approval" : undefined}
      iconColor="orange"
      variant={variant}
      tone={waiting && emphasize ? "label" : "secondary"}
      strong={waiting && emphasize}
      numberOfLines={1}
    >
      {detail ? `${STATUS_LABEL[status]} · ${detail}` : STATUS_LABEL[status]}
    </Label>
  );
}
