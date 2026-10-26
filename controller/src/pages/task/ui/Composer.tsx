import { Host, Picker } from "@expo/ui";
import { useState, type Ref } from "react";
import { Alert, Pressable, TextInput, View, type TextInputInstance } from "react-native";
import { sendMessage, stopTurn, type Effort } from "../../../entities/task";
import { column, Icon, radius, space, type, useColors } from "../../../shared/ui";

const EFFORTS: { value: Effort; label: string }[] = [
  { value: "low", label: "Effort ต่ำ" },
  { value: "medium", label: "Effort กลาง" },
  { value: "high", label: "Effort สูง" },
  { value: "max", label: "Effort สูงสุด" },
];

interface Props {
  agent: string;
  taskId: string;
  // A Turn is running, so the empty field offers Stop instead of send.
  busy: boolean;
  inputRef: Ref<TextInputInstance>;
}

// Stop can cut work off halfway, so it asks first and says what stops with it (ADR 0017).
function confirmStop(agent: string, stop: () => void) {
  const title = "หยุด Turn นี้?";
  const message = `${agent} จะหยุดทันที ไฟล์ที่แก้ไปแล้วยังอยู่ และคุยต่อได้\nTask ย่อยที่จะหยุดตาม: ไม่มี`;
  if (process.env.EXPO_OS === "web") {
    if (window.confirm(`${title}\n\n${message}`)) stop();
    return;
  }
  Alert.alert(title, message, [
    { text: "ยกเลิก", style: "cancel" },
    { text: "หยุด", style: "destructive", onPress: stop },
  ]);
}

// Like the AI apps on iOS: the field on top and, inside the same box, the
// Effort menu and the main action. That action is send, dimmed until there is
// something to send, or Stop while the Agent is working and the field is empty.
export function Composer({ agent, taskId, busy, inputRef }: Props) {
  const colors = useColors();
  const [text, setText] = useState("");
  // ponytail: high, the Messages API default; per-Agent defaults come with Agent settings.
  const [effort, setEffort] = useState<Effort>("high");
  const message = text.trim();
  const stopping = busy && !message;

  function send() {
    sendMessage(taskId, message, effort);
    setText("");
  }

  return (
    <View style={{ paddingTop: space.sm, paddingHorizontal: space.lg, paddingBottom: space.sm, backgroundColor: colors.background }}>
      <View
        style={[
          column,
          { gap: space.xs, padding: space.sm, borderRadius: radius.lg + space.xs, borderCurve: "continuous", borderWidth: 1, borderColor: colors.separator },
        ]}
      >
        <TextInput
          ref={inputRef}
          value={text}
          onChangeText={setText}
          multiline
          rows={1}
          placeholder={busy ? `ส่งต่อให้ ${agent} หลัง Turn นี้จบ` : `ส่งข้อความถึง ${agent}`}
          placeholderTextColor={colors.tertiaryLabel}
          aria-label={`ส่งข้อความถึง ${agent}`}
          // One line of Thai at its natural height plus padding, so web shows no scrollbar.
          style={[type.body, { minHeight: 40, maxHeight: 140, paddingHorizontal: space.sm, paddingVertical: space.sm, color: colors.label }]}
        />
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
          <Host matchContents>
            <Picker selectedValue={effort} onValueChange={setEffort} appearance="menu">
              {EFFORTS.map((item) => (
                <Picker.Item key={item.value} label={item.label} value={item.value} />
              ))}
            </Picker>
          </Host>
          {stopping ? (
            <Pressable role="button" aria-label="หยุด" onPress={() => confirmStop(agent, () => stopTurn(taskId))} hitSlop={8} style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}>
              <Icon name="stop" size="lg" color="label" />
            </Pressable>
          ) : (
            <Pressable
              role="button"
              aria-label="ส่ง"
              aria-disabled={!message}
              disabled={!message}
              onPress={send}
              hitSlop={8}
              style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
            >
              <Icon name="send" size="lg" color={message ? "blue" : "tertiaryLabel"} />
            </Pressable>
          )}
        </View>
      </View>
    </View>
  );
}
