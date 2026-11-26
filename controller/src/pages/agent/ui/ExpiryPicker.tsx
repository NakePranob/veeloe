import { useT } from "../../../shared/i18n";
import { Select } from "../../../shared/ui";

/** The choices the board offers for how long an Approval waits, in minutes. */
const EXPIRIES = [15, 30, 60, 240, 1440] as const;

/** `15 minutes`, `1 hour`, `1 day`, in the reader's language. */
function approvalLabel(seconds: number, t: ReturnType<typeof useT<"agent">>) {
  if (seconds >= 86400 && seconds % 86400 === 0) return t("approval.days", { count: seconds / 86400 });
  return seconds >= 3600 ? t("approval.hours", { count: seconds / 3600 }) : t("approval.minutes", { count: Math.round(seconds / 60) });
}

/** One row that says how long an Approval waits; iOS opens the system sheet of choices. */
export function ExpiryPicker({ seconds, disabled, onPick }: { seconds: number; disabled: boolean; onPick: (seconds: number) => void }) {
  const t = useT("agent");
  // A timeout set elsewhere (not one of the choices) still shows as the value.
  const choices: number[] = EXPIRIES.map((minutes) => minutes * 60);
  if (!choices.includes(seconds)) choices.push(seconds);
  return (
    <Select label={t("approval.waiting")} value={String(seconds)} options={choices.map((s) => ({ value: String(s), label: approvalLabel(s, t) }))} onChange={(next) => onPick(Number(next))} disabled={disabled} cancel={t("delete.cancel")} />
  );
}
