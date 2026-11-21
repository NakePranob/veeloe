import { useState } from "react";
import { Pressable, useColorScheme, View } from "react-native";
import { covers, missingParts } from "../../../entities/agent";
import { useT } from "../../../shared/i18n";
import { keySession } from "../../../shared/keystore";
import { fromNow } from "../../../shared/lib";
import { AgentCard, Character, type Look } from "../../../entities/character";
import { Button, Card, Field, font, Icon, Inset, Label, radius, space, Text, type IconName } from "../../../shared/ui";
import { canAllowAlways } from "../model/allow-always";
import type { Approval, ApprovalStatus } from "../model/items";

interface Props {
  approval: Approval;
  /** The Agent's name, as the card says who is asking. */
  agentName: string;
  /** The asking Agent's Character: the card takes its colour, and the head waits with a raised hand. */
  look: Look;
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

// The board's settled pills: green and red for an answer, a grey clock for one that timed out, a grey stop for one its Turn closed.
const OUTCOME: Record<Exclude<ApprovalStatus, "open">, { icon: IconName; color: "green" | "red" | "secondaryLabel"; key: string }> = {
  approved: { icon: "done", color: "green", key: "approval.approved" },
  denied: { icon: "failed", color: "red", key: "approval.denied" },
  expired: { icon: "time", color: "secondaryLabel", key: "approval.expired" },
  // ponytail: the board draws a minus in a circle; Icon has no minus yet, so the stop circle stands in.
  closed: { icon: "stopped", color: "secondaryLabel", key: "approval.closed" },
};

// Where the target goes in a sentence, so each language keeps its own order around the mono part.
const MARK = "\u0000";

// The one orange thing on the screen while it waits; once answered it settles
// into the log like any other event (controller-prototype's ApprovalCard).
export function ApprovalCard({ approval, agentName, look, allowlist, canAnswer, canManage, online, now, onAnswer, onSteer }: Props) {
  const t = useT("task");
  const open = approval.status === "open";
  // A domain approval is the proxy asking for one host outside the Agent's
  // Egress (issue #44): the same card, with three answers and no Allowlist.
  const domain = approval.kind === "domain";
  // "Allow always": one entry per part still missing from the Allowlist, trimmed to the prefix the
  // Member means. Each is checked against the part it came from, not the whole command (ADR 0030).
  const [entries, setEntries] = useState<{ entry: string; part: string }[] | null>(null);
  const [sent, setSent] = useState(false);
  // An answer waiting on the fresh unlock, so a second tap cannot sign it twice.
  const [busy, setBusy] = useState(false);
  // The rarer answers wait behind the board's one "Other options" link.
  const [more, setMore] = useState(false);
  const dark = useColorScheme() === "dark";
  const by = approval.answeredBy ? t("approval.by", { member: approval.answeredBy.member }) : "";

  // Answering takes a fresh unlock, so a phone left open cannot approve (ADR 0012).
  async function respond(decision: "approve" | "deny" | "always", allowAlways?: string[]) {
    if (sent || busy) return;
    if (decision === "approve" || decision === "always") {
      const prompt = domain
        ? t(decision === "always" ? "authenticate.domainAlways" : "authenticate.domain", { domain: approval.domain ?? "", name: agentName })
        : allowAlways?.length
          ? t("authenticate.always", { entries: allowAlways.join(", ") })
          : t("authenticate.approve", { name: agentName });
      setBusy(true);
      try {
        if ((await keySession.signed(prompt, () => onAnswer({ decision, ...(allowAlways && allowAlways.length > 0 && { allowAlways }) }))).status === "sent") setSent(true);
      } finally {
        setBusy(false);
      }
      return;
    }
    const sig = onAnswer({ decision });
    if (sig) setSent(true);
  }

  async function allowAlways() {
    if (!entries || !canAllowAlways(entries)) return;
    await respond("approve", entries.map((item) => item.entry.trim()));
  }

  const outcome = open ? null : OUTCOME[approval.status as Exclude<ApprovalStatus, "open">];
  const target = (domain ? approval.domain : approval.command) ?? "";
  // Answered, it settles into the log as a small grey pill: the outcome, who, and what.
  if (outcome) {
    // A permanent yes says so and what it added. Only a domain answer carries "always": a command's allow-always
    // goes out as an approve with entries, and the log does not say which entries (ponytail: show it when it does).
    const always = approval.answeredBy?.decision === "always";
    const [before, after] = t("approval.addedEgress", { target: MARK }).split(MARK);
    const mono = (
      <Text variant="caption" mono>
        {target}
      </Text>
    );
    return (
      <Card style={{ alignSelf: "flex-start", flexDirection: "row", alignItems: "center", gap: space.sm, paddingHorizontal: space.md, paddingVertical: 7, borderRadius: radius.md }}>
        <Icon name={outcome.icon} size="sm" color={outcome.color} />
        {approval.status === "closed" ? (
          <Text variant="footnote" tone="secondary" style={{ flexShrink: 1 }}>
            {t("approval.closed")}
          </Text>
        ) : (
          <Text variant="footnote" style={{ flexShrink: 1 }}>
            <Text variant="footnote" strong>
              {always ? t("approval.always") : t(outcome.key as "approval.approved" | "approval.denied" | "approval.expired")}
            </Text>
            {approval.status === "expired" && ` ${t("approval.expiredNote")}`}
            {!always && by}
            {" · "}
            {always ? (
              <>
                {before}
                {mono}
                {after}
              </>
            ) : (
              mono
            )}
          </Text>
        )}
      </Card>
    );
  }
  const left = fromNow(approval.expiresAt, now);
  const body = (
    <>
      <Text strong style={{ fontSize: 21, fontFamily: font.bold, letterSpacing: -0.4, textAlign: "center" }}>
        {domain ? t("approval.domainTitle", { name: agentName }) : t("approval.title", { name: agentName })}
      </Text>
      {approval.reason && (
        <Text variant="footnote" selectable style={{ textAlign: "center" }}>
          {approval.reason}
        </Text>
      )}
      <Inset chip>
        <Text variant="subheadline" mono selectable style={{ fontSize: 14 }}>
          {target}
        </Text>
      </Inset>
      {domain && (
        <Text variant="footnote" style={{ textAlign: "center" }}>
          {t("approval.domainBody", { name: agentName })}
        </Text>
      )}
      {!canAnswer && (
        <Text variant="footnote" tone="secondary">
          {t("approval.waitingForApprover")}
        </Text>
      )}
      {canAnswer && sent && (
        <Label icon="time" iconColor="label" tone="label">
          {t("approval.sent")}
        </Label>
      )}
      {canAnswer && !sent && entries === null && (
        <>
          <View style={{ alignSelf: "stretch", flexDirection: "row", gap: space.sm }}>
            <View style={{ flex: 1 }}>
              <Button size="large" label={t(domain ? "approval.allowOnce" : "approval.approve")} variant="primary" disabled={!online || busy} onPress={() => void respond("approve")} />
            </View>
            <View style={{ flex: 1 }}>
              <Button size="large" label={t("approval.deny")} variant="surface" disabled={!online || busy} onPress={() => void respond("deny")} />
            </View>
          </View>
          {/* The board's expiry line; the rarer answers sit behind its link, as on the board. */}
          <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "center", alignItems: "center", columnGap: space.xs }}>
            <Text variant="caption">{left.unit === "hour" ? t("approval.expiresInHours", { count: left.count }) : t("approval.expiresIn", { count: left.count })}</Text>
            {domain && canManage && (
              <>
                <Dot />
                <Link label={t("approval.allowAlways")} disabled={!online || busy} onPress={() => void respond("always")} />
              </>
            )}
            {!domain && !more && (
              <>
                <Dot />
                <Link label={t("approval.more")} onPress={() => setMore(true)} />
              </>
            )}
            {!domain && more && canManage && (
              <>
                <Dot />
                {/* The Protocol takes at most 20, so the card offers at most that many. */}
                <Link label={t("approval.always")} disabled={!online} onPress={() => setEntries(missingParts(approval.command, allowlist).slice(0, 20).map((part) => ({ entry: part, part })))} />
              </>
            )}
            {!domain && more && (
              <>
                <Dot />
                <Link label={t("approval.steer")} disabled={!online} onPress={onSteer} />
              </>
            )}
          </View>
        </>
      )}
      {canAnswer && !sent && entries !== null && (
        <View style={{ alignSelf: "stretch", gap: space.sm }}>
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
          <View style={{ flexDirection: "row", gap: space.sm }}>
            <View style={{ flex: 1 }}>
              <Button size="large" label={t("approval.signAndApprove")} variant="primary" disabled={!online || busy || !canAllowAlways(entries)} onPress={() => void allowAlways()} />
            </View>
            <View style={{ flex: 1 }}>
              <Button size="large" label={t("approval.cancel")} onPress={() => setEntries(null)} />
            </View>
          </View>
        </View>
      )}
    </>
  );
  // The board's card: the Agent's colour, solid, radius 30, with its 112pt head waiting over the top edge.
  // Dark keeps the entity's tint, since the ink text would not read on the solid colour there.
  return (
    <View style={{ marginTop: 54 }}>
      {dark ? (
        <AgentCard color={look.color}>
          <View style={{ alignItems: "center", gap: space.md, paddingTop: 42 }}>{body}</View>
        </AgentCard>
      ) : (
        <View style={{ backgroundColor: look.color, borderRadius: 30, borderCurve: "continuous", paddingTop: 58, paddingHorizontal: 18, paddingBottom: 18, alignItems: "center", gap: space.md }}>{body}</View>
      )}
      <View style={{ position: "absolute", top: -62, left: 0, right: 0, alignItems: "center", pointerEvents: "none" }}>
        <Character look={look} mood="waiting" size={112} />
      </View>
    </View>
  );
}

const Dot = () => <Text variant="caption">·</Text>;

function Link({ label, onPress, disabled }: { label: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable role="button" disabled={disabled} onPress={onPress} hitSlop={space.sm} style={{ paddingVertical: space.xs, paddingHorizontal: 2 }}>
      <Text variant="caption" strong style={{ textDecorationLine: "underline" }}>
        {label}
      </Text>
    </Pressable>
  );
}
