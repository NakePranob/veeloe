import { useState, type RefObject } from "react";
import { View, type TextInputInstance } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLanguage, useT } from "../../../shared/i18n";
import { formatNumber } from "../../../shared/lib";
import { Button, Card, Chip, column, Input, Label, space, Text, TextLink } from "../../../shared/ui";
import type { ContextUsage } from "../model/items";
import type { ComposerState } from "../model/use-composer";
import { ContextMeter } from "./ContextMeter";
import { Problem } from "./LogCards";

function ContextDetails({ usage }: { usage: ContextUsage }) {
  const t = useT("task");
  const language = useLanguage();
  return (
    <View style={{ gap: space.xs }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", gap: space.sm }}>
        <Text>{t("context.used")}</Text>
        <Text tone="secondary" style={{ flexShrink: 1, textAlign: "right" }}>
          {t("context.of", { used: formatNumber(usage.tokens, language), window: formatNumber(usage.window, language) })}
        </Text>
      </View>
      <View style={{ flexDirection: "row", justifyContent: "space-between", gap: space.sm }}>
        <Text>{t("context.compactAt")}</Text>
        <Text tone="secondary">{t("context.threshold", { tokens: formatNumber(usage.threshold, language) })}</Text>
      </View>
    </View>
  );
}

type Props = {
  composer: ComposerState;
  agentName: string;
  readOnly: boolean;
  online: boolean | null;
  /** The Machine is paired and its link is up, so Send and Stop can go out. */
  canSend: boolean;
  contextUsage: ContextUsage | null;
  stopError: string | null;
  inputRef: RefObject<TextInputInstance | null>;
};

// Clear of the home indicator (insets.bottom under the composer).
export function Composer({ composer, agentName, readOnly, online, canSend, contextUsage, stopError, inputRef }: Props) {
  const t = useT("task");
  const insets = useSafeAreaInsets();
  const [contextOpen, setContextOpen] = useState(false);
  const { message, attachments, busy, stopping, steering } = composer;
  if (readOnly)
    return (
      <View style={[column, { paddingHorizontal: space.xl, paddingTop: space.xs, paddingBottom: space.lg + insets.bottom }]}>
        <Card style={{ paddingHorizontal: space.lg, paddingVertical: space.inset }}>
          <Text variant="callout" tone="secondary" style={{ textAlign: "center" }}>
            {t("readOnly")}
          </Text>
        </Card>
      </View>
    );
  return (
    <View style={[column, { paddingTop: space.xs, paddingHorizontal: space.md, paddingBottom: space.sm + insets.bottom }]}>
      <View style={{ position: "relative" }}>
        {contextOpen && contextUsage && (
          <View style={{ position: "absolute", bottom: "100%", left: "8%", right: "8%", paddingBottom: space.sm, zIndex: 20 }}>
            <Card raised style={{ padding: space.md, gap: space.xs }}>
              <Label icon="info">{t("context.title")}</Label>
              <ContextDetails usage={contextUsage} />
            </Card>
          </View>
        )}
        {attachments.length > 0 && (
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.smd, paddingBottom: space.sm }}>
            {attachments.map((file) => (
              <Chip key={file.uri} label={file.name} aria-label={t("removeAttachment", { name: file.name })} onPress={() => composer.remove(file.uri)} />
            ))}
          </View>
        )}
        {online === false && (
          <Label icon="offline" style={{ alignSelf: "center", paddingBottom: space.sm }}>
            {t("offline")}
          </Label>
        )}
        {/* Send answers the Approval while this shows; Cancel goes back to the card's own choices. */}
        {steering && (
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space.sm, paddingHorizontal: space.sm, paddingBottom: space.sm }}>
            <Label icon="info" style={{ flexShrink: 1 }}>
              {t("steering.title")}
            </Label>
            <TextLink role="button" strong label={t("steering.cancel")} onPress={() => composer.steer(null)} />
          </View>
        )}
        {/* The boards' composer: a grey pill track with attach on the left, the field, and one round ink action. */}
        <Card style={{ flexDirection: "row", alignItems: "center", gap: space.xs, padding: space.xs, borderRadius: 26 }}>
          <View style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center" }}>
            <Button label={t("attach")} icon="add" variant="ghost" size="large" disabled={online === false || !!steering} onPress={() => void composer.attach()} />
          </View>
          <Input
            ref={inputRef}
            aria-label={t("placeholder", { name: agentName })}
            placeholder={steering ? t("steering.placeholder", { name: agentName }) : busy ? t("queued") : t("placeholder", { name: agentName })}
            value={composer.text}
            onChangeText={composer.setText}
            multiline
            style={{ flex: 1, minHeight: 44, maxHeight: 140, paddingVertical: 11 }}
          />
          <ContextMeter usage={contextUsage} onPress={() => setContextOpen(!contextOpen)} />
          <View style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center" }}>
            {/* A working Agent with nothing typed offers the brake instead of send. */}
            {busy && !message && !steering ? (
              <Button label={stopping ? t("stop.stopping") : t("stop.button")} icon="stopped" variant="primary" size="large" disabled={online === false || !canSend || stopping} onPress={() => void composer.stop()} />
            ) : (
              <Button label={t("send")} icon="send" variant="primary" size="large" disabled={(!message && (attachments.length === 0 || !!steering)) || !canSend || composer.sending || online === false} onPress={() => void composer.send()} />
            )}
          </View>
        </Card>
      </View>
      {stopError && (
        <View style={{ paddingTop: space.xs }}>
          <Problem code={stopError} />
        </View>
      )}
      {composer.problem && (
        <View style={{ paddingTop: space.xs }}>
          <Problem code={composer.problem} />
        </View>
      )}
    </View>
  );
}
