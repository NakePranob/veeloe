import { useState } from "react";
import { View } from "react-native";
import { AgentCard, Character, type Look } from "../../../entities/character";
import { useT } from "../../../shared/i18n";
import { Button, Card, Field, Icon, radius, Select, space, Text } from "../../../shared/ui";
import type { Question } from "../model/items";

interface Props {
  question: Question;
  look: Look;
  /** This device's Member: only the one whose message started the Turn may answer. */
  me: string | undefined;
  online: boolean;
  /** Sends the answer; the sig, or null when nothing went. */
  onAnswer: (answer: string | Record<string, string | number>) => string | null;
}

const answerText = (answer: unknown) => (typeof answer === "string" ? answer : answer && typeof answer === "object" ? Object.values(answer).map(String).join(", ") : "");

// Waits like an Approval (ADR 0082): the Agent's card, never folded while open; once settled it is one grey line.
export function QuestionCard({ question, look, me, online, onAnswer }: Props) {
  const t = useT("task");
  const [sent, setSent] = useState(false);
  const [own, setOwn] = useState("");
  const [values, setValues] = useState<Record<string, string>>({});
  if (question.status !== "open") {
    const line = question.status === "answered" ? t(question.member === me ? "question.answered" : "question.answeredBy", { answer: answerText(question.answer) }) : t(question.status === "expired" ? "question.expired" : "question.closed");
    return (
      <Card style={{ alignSelf: "flex-start", flexDirection: "row", alignItems: "center", gap: space.sm, paddingHorizontal: space.md, paddingVertical: 7, borderRadius: radius.md }}>
        <Icon name={question.status === "answered" ? "done" : "time"} size="sm" color={question.status === "answered" ? "green" : "secondaryLabel"} />
        <Text variant="footnote" style={{ flexShrink: 1 }}>
          {line}
        </Text>
      </Card>
    );
  }
  const mine = !!me && question.member === me;
  const send = (answer: string | Record<string, string | number>) => {
    if (sent || !online) return;
    if (onAnswer(answer)) setSent(true);
  };
  const fields = question.fields;
  const formReady = !!fields && fields.every((field) => (values[field.name] ?? "").trim() !== "");
  const sendForm = () => {
    if (!fields) return;
    send(Object.fromEntries(fields.map((field) => [field.name, field.kind === "number" && !Number.isNaN(Number(values[field.name])) ? Number(values[field.name]) : (values[field.name] ?? "").trim()])));
  };
  return (
    <View style={{ marginTop: 54 }}>
      <AgentCard color={look.color} solid>
        <View style={{ alignItems: "center", gap: space.md, paddingTop: 40 }}>
          <Text variant="title" selectable style={{ textAlign: "center" }}>
            {question.question}
          </Text>
          {!mine ? (
            <Text variant="footnote" tone="secondary">
              {t("question.notYours")}
            </Text>
          ) : sent ? (
            <Text variant="footnote">{t("question.sent")}</Text>
          ) : fields ? (
            <View style={{ alignSelf: "stretch", gap: space.sm }}>
              {fields.map((field) =>
                field.kind === "choice" ? (
                  <Select
                    key={field.name}
                    label={field.label}
                    value={values[field.name] ?? ""}
                    options={field.options.map((option) => ({ value: option, label: option }))}
                    onChange={(value: string) => setValues({ ...values, [field.name]: value })}
                    cancel={t("approval.cancel")}
                  />
                ) : (
                  <Field
                    key={field.name}
                    label={field.label}
                    value={values[field.name] ?? ""}
                    keyboardType={field.kind === "number" ? "numeric" : undefined}
                    placeholder={field.kind === "date" ? "YYYY-MM-DD" : undefined}
                    onChangeText={(text) => setValues({ ...values, [field.name]: text })}
                  />
                ),
              )}
              <Button size="large" variant="primary" label={t("question.send")} disabled={!online || !formReady} onPress={sendForm} />
            </View>
          ) : (
            <View style={{ alignSelf: "stretch", gap: space.sm }}>
              {question.options.map((option) => (
                <Button key={option} size="large" variant="surface" label={option} disabled={!online} onPress={() => send(option)} />
              ))}
              <Field label={t("question.other")} value={own} onChangeText={(text) => setOwn(text.slice(0, 2000))} />
              {own.trim() !== "" && <Button size="large" variant="primary" label={t("question.send")} disabled={!online} onPress={() => send(own.trim())} />}
            </View>
          )}
        </View>
      </AgentCard>
      <View style={{ position: "absolute", top: -62, left: 0, right: 0, alignItems: "center", pointerEvents: "none" }}>
        <Character look={look} mood="waiting" size={112} />
      </View>
    </View>
  );
}
