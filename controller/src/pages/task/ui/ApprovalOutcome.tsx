import { Fragment, type ReactNode } from "react";
import { useT } from "../../../shared/i18n";
import { mark, splitMarks } from "../../../shared/lib";
import { Card, Icon, radius, space, Text, type IconName } from "../../../shared/ui";
import type { Approval, ApprovalStatus } from "../model/items";

// The board's settled pills: green and red for an answer, a grey clock for one that timed out, a grey stop for one its Turn closed.
const OUTCOME: Record<Exclude<ApprovalStatus, "open" | "closed">, { icon: IconName; color: "green" | "red" | "secondaryLabel"; key: "approval.approved" | "approval.denied" | "approval.expired" }> = {
  approved: { icon: "done", color: "green", key: "approval.approved" },
  denied: { icon: "failed", color: "red", key: "approval.denied" },
  expired: { icon: "time", color: "secondaryLabel", key: "approval.expired" },
};

/** Answered, an Approval settles into the log as a small grey pill: the outcome, who, and what. */
export function ApprovalOutcome({ approval, target }: { approval: Approval; target: string }) {
  const t = useT("task");
  if (approval.status === "closed")
    return (
      <Pill icon="stopped" color="secondaryLabel">
        {/* ponytail: the board draws a minus in a circle; Icon has no minus yet, so the stop circle stands in. */}
        <Text variant="footnote" tone="secondary" style={{ flexShrink: 1 }}>
          {t("approval.closed")}
        </Text>
      </Pill>
    );
  const outcome = OUTCOME[approval.status as keyof typeof OUTCOME];
  // A permanent yes says so and what it added. Only a domain answer carries "always": a command's allow-always
  // goes out as an approve with entries, and the log does not say which entries (ponytail: show it when it does).
  const always = approval.answeredBy?.decision === "always";
  const member = approval.answeredBy?.member;
  const marks = { outcome: mark(0), target: mark(1) };
  const line = always ? t("approval.outcomeAlways", marks) : approval.status === "expired" ? t("approval.outcomeExpired", marks) : member ? t("approval.outcomeBy", { ...marks, member }) : t("approval.outcome", marks);
  const parts: ReactNode[] = [
    <Text key="outcome" variant="footnote" strong>
      {always ? t("approval.always") : t(outcome.key)}
    </Text>,
    <Text key="target" variant="caption" mono>
      {target}
    </Text>,
  ];
  return (
    <Pill icon={outcome.icon} color={outcome.color}>
      <Text variant="footnote" style={{ flexShrink: 1 }}>
        {/* biome-ignore lint/suspicious/noArrayIndexKey: the pieces of one fixed sentence, never reordered */}
        {splitMarks(line).map((piece, index) => (typeof piece === "number" ? <Fragment key={index}>{parts[piece]}</Fragment> : piece))}
      </Text>
    </Pill>
  );
}

function Pill({ icon, color, children }: { icon: IconName; color: "green" | "red" | "secondaryLabel"; children: ReactNode }) {
  return (
    <Card style={{ alignSelf: "flex-start", flexDirection: "row", alignItems: "center", gap: space.sm, paddingHorizontal: space.md, paddingVertical: 7, borderRadius: radius.md }}>
      <Icon name={icon} size="sm" color={color} />
      {children}
    </Card>
  );
}
