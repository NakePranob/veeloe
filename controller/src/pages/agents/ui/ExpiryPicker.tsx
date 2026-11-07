import { useState } from "react";
import { useT } from "../../../shared/i18n";
import { Icon, Row } from "../../../shared/ui";

/** The choices the prototype offers for how long an Approval waits (controller-prototype's EXPIRIES). */
export const EXPIRIES = [15, 30, 60, 240, 1440] as const;

/** `15 minutes`, `1 hour`, `24 hours`, in the reader's language. */
export function approvalLabel(seconds: number, t: ReturnType<typeof useT<"agents">>) {
  return seconds >= 3600 ? t("approval.hours", { count: seconds / 3600 }) : t("approval.minutes", { count: Math.round(seconds / 60) });
}

/**
 * One row that says how long an Approval waits and opens the choices in place,
 * as the prototype's Select does: the value on the right, the other options
 * under it with a tick on the one in use.
 */
export function ExpiryPicker({ seconds, disabled, onPick }: { seconds: number; disabled: boolean; onPick: (seconds: number) => void }) {
  const t = useT("agents");
  const [open, setOpen] = useState(false);
  return (
    <>
      <Row
        title={t("approval.waiting")}
        value={approvalLabel(seconds, t)}
        onPress={disabled ? undefined : () => setOpen((was) => !was)}
        accessory={<Icon name={open ? "collapse" : "expand"} size="sm" color="tertiaryLabel" />}
      />
      {open &&
        EXPIRIES.map((minutes) => (
          <Row
            key={minutes}
            title={approvalLabel(minutes * 60, t)}
            onPress={() => {
              setOpen(false);
              if (minutes * 60 !== seconds) onPick(minutes * 60);
            }}
            accessory={minutes * 60 === seconds ? <Icon name="check" size="md" color="label" weight="semibold" /> : undefined}
          />
        ))}
    </>
  );
}
