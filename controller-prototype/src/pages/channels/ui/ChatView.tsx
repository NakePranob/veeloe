import { useState } from "react";
import { View } from "react-native";
import { clock, type ChatMessage } from "../../../entities/channel";
import { Button, Card, Field, Icon, Label, Select, space, Text, useColors } from "../../../shared/ui";

const PEOPLE = ["Ploy", "Tee", "Ann"];

interface Props {
  messages: ChatMessage[];
  botName: string;
  // What the bot hears: a group's bot needs a mention or a reply (Telegram privacy mode).
  hint?: string;
  samples: string[];
  onSend: (name: string, text: string, replyTo?: number) => void;
  disabled?: string;
}

// A stand-in for the Telegram group, from the view of the people in it. Anyone may type here;
// none of them is a Member, and the app does not know which Telegram account is whom (ADR 0028).
export function ChatView({ messages, botName, hint, samples, onSend, disabled }: Props) {
  const colors = useColors();
  const [name, setName] = useState(PEOPLE[0]);
  const [text, setText] = useState("");
  const [replyTo, setReplyTo] = useState<number>();
  const replied = messages.find((message) => message.id === replyTo);

  function send(value = text) {
    if (!value.trim()) return;
    onSend(name, value.trim(), replyTo);
    setText("");
    setReplyTo(undefined);
  }

  return (
    <View style={{ gap: space.sm }}>
      <Label icon="channel" variant="footnote">
        จำลอง: มุมมองของคนในแชต Telegram
      </Label>
      {messages.length === 0 && (
        <Text variant="footnote" tone="secondary">
          ยังไม่มีข้อความ ลองพิมพ์ในช่องด้านล่าง
        </Text>
      )}
      {messages.map((message) => {
        const quoted = message.replyTo ? messages.find((candidate) => candidate.id === message.replyTo) : undefined;
        const system = message.from === "ระบบ";
        if (system) {
          return (
            <Label key={message.id} icon="info" style={{ alignSelf: "center" }}>
              {message.text}
            </Label>
          );
        }
        return (
          <View key={message.id} style={{ alignItems: message.bot ? "flex-start" : "flex-end", gap: 2 }}>
            <Card style={{ maxWidth: "88%", gap: space.xs, padding: space.md, backgroundColor: message.bot ? colors.chip : colors.surface }}>
              <Text variant="caption" tone="secondary">
                {message.from} · {clock(message.at)}
              </Text>
              {quoted && (
                <Text variant="caption" tone="secondary" numberOfLines={1}>
                  ตอบ: {quoted.text}
                </Text>
              )}
              {message.file ? (
                <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
                  <Icon name="file" size="md" />
                  <Text>{message.file.name}</Text>
                </View>
              ) : (
                <Text selectable>{message.text}</Text>
              )}
              {message.bot && !disabled && <Button label="ตอบข้อความนี้" onPress={() => setReplyTo(message.id)} />}
            </Card>
            {message.delivered === false && !message.bot && (
              <Text variant="caption" tone="secondary">
                bot ไม่ได้รับข้อความนี้{hint ? ` · ${hint}` : ""}
              </Text>
            )}
          </View>
        );
      })}
      <Card style={{ gap: space.xs }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
          <Text variant="footnote" tone="secondary">
            พิมพ์ในนาม
          </Text>
          <Select label="ผู้พิมพ์" value={name} options={PEOPLE.map((person) => ({ value: person, label: person }))} onChange={setName} />
        </View>
        {replied && (
          <Label icon="info" variant="caption">
            กำลังตอบ: {replied.text.slice(0, 40)}
          </Label>
        )}
        <Field label="ข้อความในแชต" value={text} onChangeText={setText} placeholder={`เช่น @${botName} สวัสดี`} />
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.xs }}>
          {samples.map((sample) => (
            <Button key={sample} label={sample} onPress={() => setText(sample)} />
          ))}
        </View>
        <View style={{ flexDirection: "row" }}>
          <Button label="ส่งในแชต" disabled={!text.trim()} onPress={() => send()} />
        </View>
        {disabled && (
          <Text variant="caption" tone="secondary">
            {disabled}
          </Text>
        )}
      </Card>
    </View>
  );
}
