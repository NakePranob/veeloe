import { useState } from "react";
import { View } from "react-native";
import { pageName, wikiLinks, type Library } from "../../../entities/library";
import { useAgents } from "../../../entities/agent";
import { ago } from "../../../shared/lib";
import { Button, Card, Row, Section, space, Text } from "../../../shared/ui";
import { Markdown } from "./Markdown";

// The Owner's page list and reader. Writes come only from the writer Agent, so there is no editor.
export function Pages({ library }: { library: Library }) {
  const agents = useAgents();
  const [open, setOpen] = useState<string | null>(null);
  const page = library.pages.find((candidate) => candidate.path === open);
  const backlinks = page ? library.pages.filter((other) => other.path !== page.path && wikiLinks(other.content).includes(pageName(page.path))) : [];
  const by = (id: string) => (id ? (agents.find((agent) => agent.id === id)?.name ?? id) : "Owner");
  return (
    <>
      <Section title={`หน้า (${library.pages.length})`} footer="หน้าเป็นไฟล์ Markdown ที่ลิงก์กันด้วย [[...]] Obsidian เปิดโฟลเดอร์นี้เป็น vault แล้วเห็นกราฟได้">
        {library.pages.map((candidate) => (
          <Row key={candidate.path} icon="file" title={candidate.path} detail={`${by(candidate.by)} · ${ago(candidate.at) === "ตอนนี้" ? "ตอนนี้" : `${ago(candidate.at)}ที่แล้ว`}`} onPress={() => setOpen(candidate.path)} />
        ))}
      </Section>
      {page && (
        <Card>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
            <Text variant="footnote" tone="secondary" mono>
              {page.path} · {by(page.by)}
            </Text>
            <Button label="ปิด" onPress={() => setOpen(null)} />
          </View>
          <Markdown library={library} content={page.content} onOpen={setOpen} />
          {backlinks.length > 0 && (
            <View style={{ gap: space.xs }}>
              <Text variant="footnote" tone="secondary">
                ลิงก์มาจาก
              </Text>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
                {backlinks.map((other) => (
                  <Button key={other.path} label={pageName(other.path)} onPress={() => setOpen(other.path)} />
                ))}
              </View>
            </View>
          )}
        </Card>
      )}
    </>
  );
}
