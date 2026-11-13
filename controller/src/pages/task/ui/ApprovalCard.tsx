import { useState } from "react";
import { View } from "react-native";
import { covers, missingParts } from "../../../entities/agent";
import { useT } from "../../../shared/i18n";
import { keySession } from "../../../shared/keystore";
import { fromNow } from "../../../shared/lib";
import { Button, Card, Field, Icon, Label, radius, space, Text, useColors, type IconName } from "../../../shared/ui";
import type { Approval, ApprovalStatus } from "../model/items";

interface Props {
  approval: Approval;
  /** The Agent's name, as the card says who is asking. */
  agentName: string;
  /** The Allowlist as the Machine last sent it, for "allow always" and the coverage hints. */
  allowlist: readonly string[];
  canAnswer: boolean;
  canManage: boolean;
  online: boolean;
  now: number;
  /** Answers it and shows "sent" until the Machine's `approval.answered` lands. */
  onAnswer: (answer: { decision: "approve" | "deny" | "always"; allowAlways?: string[] }) => string | null;
  /** Puts the cursor in the composer so the Member can say what to do instead. */
  onSteer: () => void;
}

const OUTCOME: Record<Exclude<ApprovalStatus, "open">, { icon: IconName; color: "green" | "red"; key: string }> = {
  approved: { icon: "done", color: "green", key: "approval.approved" },
  denied: { icon: "failed", color: "red", key: "approval.denied" },
  expired: { icon: "failed", color: "red", key: "approval.expired" },
  closed: { icon: "failed", color: "red", key: "approval.closed" },
};

// The one orange thing on the screen while it waits; once answered it settles
// into the log like any other event (controller-prototype's ApprovalCard).
export function ApprovalCard({ approval, agentName, allowlist, canAnswer, canManage, online, now, onAnswer, onSteer }: Props) {
  const t = useT("task");
  const colors = useColors();
  const open = approval.status === "open";
  // A domain approval is the proxy asking for one host outside the Agent's
  // Egress (issue #44): the same card, with three answers and no Allowlist.
  const domain = approval.kind === "domain";
  // "Allow always": one entry per part still missing from the Allowlist, trimmed to the prefix the
  // Member means. Each is checked against the part it came from, not the whole command (ADR 0030).
  const [entries, setEntries] = useState<{ entry: string; part: string }[] | null>(null);
  const [sent, setSent] = useState(false);
  const by = approval.answeredBy ? t("approval.by", { member: approval.answeredBy.member }) : "";

  // Answering takes a fresh unlock, so a phone left open cannot approve (ADR 0012).
  async function respond(decision: "approve" | "deny" | "always", allowAlways?: string[]) {
    if (sent) return;
    if (decision === "approve" || decision === "always") {
      const prompt = domain
        ? t(decision === "always" ? "authenticate.domainAlways" : "authenticate.domain", { domain: approval.domain ?? "", name: agentName })
        : allowAlways?.length
          ? t("authenticate.always", { entries: allowAlways.join(", ") })
          : t("authenticate.approve", { name: agentName });
      let sig: string | null = null;
      await keySession.withFreshAuthentication(prompt, () => void (sig = onAnswer({ decision, ...(allowAlways && allowAlways.length > 0 && { allowAlways }) })));
      if (sig) setSent(true);
      return;
    }
    const sig = onAnswer({ decision });
    if (sig) setSent(true);
  }

  async function allowAlways() {
    if (!entries) return;
    const cleaned = entries.map((item) => item.entry.trim()).filter(Boolean);
    if (cleaned.length === 0) return;
    await respond("approve", cleaned);
  }

  const outcome = open ? null : OUTCOME[approval.status as Exclude<ApprovalStatus, "open">];
  return (
    <Card>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
        <Icon name="approval" size="md" color={open ? "orange" : "tertiaryLabel"} />
        <Text variant="headline" style={{ flex: 1 }}>
          {domain ? t("approval.domainTitle", { name: agentName }) : t("approval.title", { name: agentName })}
        </Text>
        {open && (
          <Label icon="time" iconColor="orange">
            {fromNow(approval.expiresAt, now).unit === "hour"
              ? t("approval.expiresInHours", { count: fromNow(approval.expiresAt, now).count })
              : t("approval.expiresIn", { count: fromNow(approval.expiresAt, now).count })}
          </Label>
        )}
      </View>
      {approval.reason && <Text selectable>{approval.reason}</Text>}
      {domain && (
        <Text variant="footnote" tone="secondary">
          {t("approval.domainBody", { name: agentName })}
        </Text>
      )}
      <View style={{ paddingHorizontal: space.md, paddingVertical: space.sm, borderRadius: radius.sm, borderCurve: "continuous", backgroundColor: colors.fill }}>
        <Text variant="footnote" mono selectable>
          {domain ? approval.domain : approval.command}
        </Text>
      </View>
      {outcome && (
        <Label icon={outcome.icon} iconColor={outcome.color}>
          {t(outcome.key as "approval.approved" | "approval.denied" | "approval.expired" | "approval.closed")}
          {by}
        </Label>
      )}
      {open && !canAnswer && (
        <Text variant="footnote" tone="secondary">
          {t("approval.waitingForApprover")}
        </Text>
      )}
      {open && canAnswer && sent && (
        <Label icon="time" iconColor="orange">
          {t("approval.sent")}
        </Label>
      )}
      {open && canAnswer && !sent && entries === null && (
        <>
          {!domain && (
            <Text variant="footnote" tone="secondary">
              {t("approval.notInAllowlist")}
            </Text>
          )}
          {/* One ink pill for the answer the card asks for; quiet chips beside it. "Tell it what to do
              instead" is Codex's "Tell Codex what to do": a no that steers instead of ending the conversation. */}
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm, marginTop: space.xs }}>
            <Button label={t(domain ? "approval.allowOnce" : "approval.approve")} variant="primary" disabled={!online} onPress={() => void respond("approve")} />
            {domain && canManage && <Button label={t("approval.allowAlways")} disabled={!online} onPress={() => void respond("always")} />}
            <Button label={t("approval.deny")} disabled={!online} onPress={() => void respond("deny")} />
            {canManage && !domain && (
              <Button
                label={t("approval.always")}
                disabled={!online}
                // The Protocol takes at most 20, so the card offers at most that many.
                onPress={() => setEntries(missingParts(approval.command, allowlist).slice(0, 20).map((part) => ({ entry: part, part })))}
              />
            )}
            {!domain && <Button label={t("approval.steer")} disabled={!online} onPress={onSteer} />}
          </View>
        </>
      )}
      {open && canAnswer && !sent && entries !== null && (
        <>
          {entries.map((item, index) => (
            <Field
              key={item.part}
              mono
              label={t("approval.addToAllowlist")}
              value={item.entry}
              onChangeText={(text) => setEntries(entries.map((old, i) => (i === index ? { ...old, entry: text } : old)))}
              footer={t(covers(item.entry, item.part) ? "approval.covers" : "approval.doesNotCover")}
            />
          ))}
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
            <Button label={t("approval.signAndApprove")} variant="primary" disabled={!online} onPress={() => void allowAlways()} />
            <Button label={t("approval.cancel")} onPress={() => setEntries(null)} />
          </View>
        </>
      )}
    </Card>
  );
}
