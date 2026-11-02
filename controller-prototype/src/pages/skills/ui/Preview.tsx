import { View } from "react-native";
import { MAX_SKILL_BYTES, totalBytes, type SkillFile } from "../../../entities/skill";
import { Button, Card, Label, Note, Screen, Section, space, Text } from "../../../shared/ui";
import type { FileDiff } from "./diff";

// What the Member reads before signing: every file in full and the hash the command will sign (ADR 0038).
export interface Candidate {
  name: string;
  description: string;
  files: SkillFile[];
  hash: string;
  origin: "link" | "file" | "draft" | "agent";
  from: string;
  version: number;
  // The Skill this replaces, with what differs from it.
  diff?: FileDiff[];
  // Re-reads the source right before installing; the signed hash must still match it.
  current: () => SkillFile[] | undefined;
  draftId?: string;
}

const kb = (bytes: number) => (bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);
const STATE = { added: "เพิ่มไฟล์", removed: "ลบไฟล์", changed: "แก้ไฟล์" };

export function Preview({ candidate, onInstall, onCancel, onTamper }: { candidate: Candidate; onInstall: () => void; onCancel: () => void; onTamper?: () => void }) {
  const total = totalBytes(candidate.files);
  const tooBig = total > MAX_SKILL_BYTES;
  return (
    <Screen title="ตรวจก่อนเซ็น" right={{ label: "เซ็นและติดตั้ง", onPress: onInstall, disabled: tooBig }}>
      <Card>
        <Text variant="headline">{candidate.name}</Text>
        <Text tone="secondary">{candidate.description}</Text>
        <Label icon="key" variant="footnote">
          hash ที่จะเซ็น: {candidate.hash}
        </Label>
        <Label icon="file" variant="footnote">
          {candidate.files.length} ไฟล์ รวม {kb(total)} จากเพดาน {kb(MAX_SKILL_BYTES)}
        </Label>
      </Card>
      {tooBig && (
        <Note icon="failed" iconColor="red">
          ใหญ่เกินเพดานของ Skill จึงติดตั้งไม่ได้ Hub ไม่ใช่ทางส่งไฟล์ใหญ่
        </Note>
      )}
      <Note>คำสั่งติดตั้งเซ็นทับ hash ของทุกไฟล์ที่เห็นตรงนี้ ถ้าต้นทางเปลี่ยนไฟล์หลังจากนี้ Runtime จะไม่ติดตั้ง</Note>
      {candidate.diff && (
        <Section title="ต่างจากเวอร์ชันที่ติดตั้งอยู่">
          {candidate.diff.map((item) => (
            <View key={item.path} style={{ gap: space.xs, padding: space.sm }}>
              <Label icon={item.state === "removed" ? "trash" : "file"}>
                {STATE[item.state]} {item.path}
              </Label>
              {item.added.slice(0, 8).map((line, i) => (
                <Text key={`a${i}`} variant="footnote" mono>
                  + {line}
                </Text>
              ))}
              {item.removed.slice(0, 8).map((line, i) => (
                <Text key={`r${i}`} variant="footnote" mono tone="secondary">
                  - {line}
                </Text>
              ))}
            </View>
          ))}
        </Section>
      )}
      {candidate.files.map((file) => (
        <Section key={file.path} title={`${file.path} (${kb(file.size)})`}>
          <Text variant="footnote" mono selectable style={{ padding: space.sm }}>
            {file.content}
          </Text>
        </Section>
      ))}
      {onTamper && (
        <Section footer="ร่างอยู่ใน Workdir ที่ Agent เขียนได้ จึงต้องมี hash กันการแก้หลังอ่าน">
          <View style={{ padding: space.sm, alignItems: "flex-start" }}>
            <Button label="จำลอง: Agent แอบแก้ร่างหลังอ่าน" onPress={onTamper} />
          </View>
        </Section>
      )}
      <View style={{ alignItems: "flex-start" }}>
        <Button label="ยกเลิก" onPress={onCancel} />
      </View>
    </Screen>
  );
}
