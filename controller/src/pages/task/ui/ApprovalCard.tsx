import { useState } from "react";
// biome-ignore lint/correctness/useReactNativePlatformComponents: used only behind the EXPO_OS === "ios" check in moreOptions()
import { ActionSheetIOS, View } from "react-native";
import { covers, missingParts } from "../../../entities/agent";
import { useLanguage, useT } from "../../../shared/i18n";
import { keySession } from "../../../shared/keystore";
import { formatList, fromNow } from "../../../shared/lib";
import { AgentCard, Character, type Look } from "../../../entities/character";
import { Button, Field, Inset, Label, space, Text, TextLink } from "../../../shared/ui";
import { canAllowAlways } from "../model/allow-always";
import { fetchedHost, promptFor, respond, siteOf, type Answer, type Decision } from "../model/approval";
import type { Approval } from "../model/items";
import { ApprovalOutcome } from "./ApprovalOutcome";

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
  /** This device's Member, so its own answer reads "you" rather than its id. */
  me: string | undefined;
  /** Answers it and shows "sent" until the Machine's `approval.answered` lands. */
  onAnswer: (answer: Answer) => string | null;
  /** Puts the cursor in the composer so the Member can say what to do instead. */
  onSteer: () => void;
  /**
   * A round of a Schedule someone ran (ADR 0079): the entries this command still needs in the Schedule's
   * scope, and how to add them. Absent outside a Schedule's round, and for a domain.
   */
  scope?: { entries: string[]; add: (entries: string[]) => string | null };
}

// The one orange thing on the screen while it waits; once answered it settles
// into the log like any other event.
export function ApprovalCard({ approval, agentName, look, allowlist, canAnswer, canManage, online, now, me, onAnswer, onSteer, scope }: Props) {
  const t = useT("task");
  const language = useLanguage();
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
  const [showCommand, setShowCommand] = useState(false);

  // Answering takes a fresh unlock, so a phone left open cannot approve (ADR 0012).
  async function answer(decision: Decision, allowAlways?: string[], subdomains?: boolean) {
    if (sent || busy) return;
    const prompt = promptFor({ decision, domain: domain ? (subdomains && wholeSite ? `*.${wholeSite}` : (approval.domain ?? "")) : undefined, agentName, allowAlways, language });
    setBusy(true);
    try {
      if (await respond({ decision, allowAlways, subdomains, prompt: prompt && t(prompt.key, prompt.values), onAnswer, sign: (words, send) => keySession.signed(words, send) })) setSent(true);
    } finally {
      setBusy(false);
    }
  }

  // Yes to this one, and to the same in every later round of its Schedule, under one unlock (ADR 0079).
  async function approveForSchedule() {
    if (!scope || sent || busy) return;
    setBusy(true);
    try {
      const signed = await keySession.signed(t("authenticate.scope", { entries: formatList(scope.entries, language) }), () => {
        const answered = onAnswer({ decision: "approve" });
        if (answered) scope.add(scope.entries);
        return answered;
      });
      if (signed.status === "sent") setSent(true);
    } finally {
      setBusy(false);
    }
  }

  const startAllowAlways = () =>
    setEntries(
      missingParts(approval.command, allowlist)
        .slice(0, 20)
        .map((part) => ({ entry: part, part })),
    );

  // The rarer answers in the platform's own menu on iOS; Android keeps them as links under the card.
  function moreOptions() {
    if (process.env.EXPO_OS !== "ios") return setMore(true);
    const choices = [
      ...(canManage ? [{ label: t("approval.always"), run: startAllowAlways }] : []),
      ...(scope && scope.entries.length > 0 ? [{ label: t("approval.forSchedule"), run: () => void approveForSchedule() }] : []),
      { label: t("approval.steer"), run: onSteer },
    ];
    ActionSheetIOS.showActionSheetWithOptions({ options: [...choices.map((choice) => choice.label), t("approval.cancel")], cancelButtonIndex: choices.length }, (index) => choices[index]?.run());
  }

  async function allowAlways() {
    if (!entries || !canAllowAlways(entries)) return;
    await answer(
      "approve",
      entries.map((item) => item.entry.trim()),
    );
  }

  const target = (domain ? approval.domain : approval.command) ?? "";
  // A command that only downloads a page reads as its site; the command itself waits behind a link (issue #79).
  const site = domain ? null : fetchedHost(approval.command);
  // The whole site behind a domain, when it is wider than the domain itself (issue #80).
  const wholeSite = domain && approval.domain ? siteOf(approval.domain) : null;
  if (!open) return <ApprovalOutcome approval={approval} target={target} me={me} />;
  const left = fromNow(approval.expiresAt, now);
  const body = (
    <>
      <Text variant="title" style={{ textAlign: "center" }}>
        {domain ? t("approval.domainTitle", { name: agentName }) : site ? t("approval.fetchTitle", { site }) : t("approval.title", { name: agentName })}
      </Text>
      {/* The Agent's own words, not something the system checked (ADR 0092): said as theirs, and the command stays below. */}
      <Text variant="footnote" tone={approval.reason ? "label" : "secondary"} selectable style={{ textAlign: "center" }}>
        {approval.reason ? t("approval.reason", { name: agentName, reason: approval.reason }) : t("approval.noReason", { name: agentName })}
      </Text>
      {site && !showCommand ? (
        <TextLink role="button" label={t("approval.showCommand")} onPress={() => setShowCommand(true)} />
      ) : (
        <Inset chip>
          <Text variant="callout" mono selectable>
            {target}
          </Text>
        </Inset>
      )}
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
              <Button size="large" label={t(domain ? "approval.allowOnce" : "approval.approve")} variant="primary" disabled={!online || busy} onPress={() => void answer("approve")} />
            </View>
            <View style={{ flex: 1 }}>
              <Button size="large" label={t("approval.deny")} variant="surface" disabled={!online || busy} onPress={() => void answer("deny")} />
            </View>
          </View>
          {/* The board's expiry line; the rarer answers sit behind its link, as on the board. */}
          <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "center", alignItems: "center", columnGap: space.xs }}>
            <Text variant="caption">{left.unit === "hour" ? t("approval.expiresInHours", { count: left.count }) : t("approval.expiresIn", { count: left.count })}</Text>
            {domain && canManage && (
              <>
                <Dot />
                <TextLink role="button" strong label={t("approval.allowAlways")} disabled={!online || busy} onPress={() => void answer("always")} />
              </>
            )}
            {domain && canManage && wholeSite && (
              <>
                <Dot />
                <TextLink role="button" strong label={t("approval.allowSite", { site: wholeSite })} disabled={!online || busy} onPress={() => void answer("always", undefined, true)} />
              </>
            )}
            {!domain && !more && (
              <>
                <Dot />
                <TextLink role="button" strong label={t("approval.more")} disabled={!online || busy} onPress={moreOptions} />
              </>
            )}
            {!domain && more && canManage && (
              <>
                <Dot />
                {/* The Protocol takes at most 20, so the card offers at most that many. */}
                <TextLink role="button" strong label={t("approval.always")} disabled={!online} onPress={startAllowAlways} />
              </>
            )}
            {!domain && more && scope && scope.entries.length > 0 && (
              <>
                <Dot />
                <TextLink role="button" strong label={t("approval.forSchedule")} disabled={!online || busy} onPress={() => void approveForSchedule()} />
              </>
            )}
            {!domain && more && (
              <>
                <Dot />
                <TextLink role="button" strong label={t("approval.steer")} disabled={!online} onPress={onSteer} />
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
  // The board's card: the Agent's colour, solid, with its 112pt head waiting over the top edge.
  return (
    <View style={{ marginTop: 54 }}>
      <AgentCard color={look.color} solid>
        <View style={{ alignItems: "center", gap: space.md, paddingTop: 40 }}>{body}</View>
      </AgentCard>
      <View style={{ position: "absolute", top: -62, left: 0, right: 0, alignItems: "center", pointerEvents: "none" }}>
        <Character look={look} mood="waiting" size={112} />
      </View>
    </View>
  );
}

const Dot = () => <Text variant="caption">·</Text>;
