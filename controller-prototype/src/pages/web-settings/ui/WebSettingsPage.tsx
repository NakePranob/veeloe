import { useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { useAgent } from "../../../entities/agent";
import { usePolicy } from "../../../entities/agent-policy";
import { toolKey, useConnectors } from "../../../entities/connector";
import { can, useCurrentMember } from "../../../entities/member";
import { checkFetch, getWebSettings, PROVIDER_SEARCH, setWebSettings, useWebSettings, type FetchResult, type WebSettings } from "../../../entities/web-access";
import { authenticate, Button, Empty, Field, inform, Label, Note, Row, Screen, Section, Select, space, ToggleRow } from "../../../shared/ui";

const SEARCH_LABEL = { off: "ปิด", provider: "จาก Provider", connector: "จาก Connector" } as const;
const MIN_KB = 10;
const MAX_KB = 1000;

export function WebSettingsPage() {
  const { agent: agentId } = useLocalSearchParams<{ agent: string }>();
  const agent = useAgent(agentId);
  const me = useCurrentMember();
  const all = useWebSettings();
  // Egress is per Agent now (ADR 0029); the whole internet leaves internal addresses closed.
  const policy = usePolicy(agentId);
  const connectors = useConnectors();
  const [kb, setKb] = useState<string>();
  const [url, setUrl] = useState("");
  const [result, setResult] = useState<FetchResult>();

  if (!agent) return <Screen title="เว็บ"><Empty icon="network" title="ไม่พบ Agent" /></Screen>;
  if (!can(me, agent.id, "use")) return <Screen title="เว็บ"><Note icon="lock">ต้องมี Use ที่ Agent นี้ถึงจะดูได้</Note></Screen>;

  const settings = all[agent.id] ?? getWebSettings(agent.id);
  const editable = can(me, agent.id, "manage");
  const mine = connectors.filter((connector) => connector.agent === agent.id);
  // A Connector can search when one of its tools is called web_search or search (ADR 0040).
  const searchers = mine.filter((connector) => connector.pinned.some((tool) => tool.name === "web_search" || tool.name === "search"));
  const anyUrl = mine.flatMap((connector) => connector.pinned.filter((tool) => tool.anyUrl).map((tool) => toolKey(connector, tool)));
  const providerHasSearch = PROVIDER_SEARCH.includes(agent.providerId);
  const options = [
    { value: "off", label: SEARCH_LABEL.off },
    ...(providerHasSearch ? [{ value: "provider", label: SEARCH_LABEL.provider }] : []),
    ...(searchers.length ? [{ value: "connector", label: SEARCH_LABEL.connector }] : []),
  ] as { value: WebSettings["search"]; label: string }[];
  const searchValue = settings.search === "connector" && settings.connector && !searchers.some((connector) => connector.id === settings.connector) ? "off" : settings.search;

  async function change(patch: Partial<WebSettings>, reason: string) {
    if (await authenticate(reason)) setWebSettings(agent!.id, patch);
  }

  function saveKb() {
    const value = Number(kb);
    if (!Number.isInteger(value) || value < MIN_KB || value > MAX_KB) return inform("ขนาดไม่ถูกต้อง", `ใส่จำนวนเต็มระหว่าง ${MIN_KB} ถึง ${MAX_KB} KB`);
    setWebSettings(agent!.id, { maxKb: value });
    setKb(undefined);
  }

  function tryFetch() {
    if (!settings.fetch) return setResult({ ok: false, reason: "web_fetch ปิดอยู่ เปิดก่อนถึงจะลองได้" });
    // ponytail: only the rule is checked; a real worker would fetch, convert to text and cut at the size.
    setResult(checkFetch(url, policy.internet ? ["*"] : policy.egress));
  }

  return (
    <Screen title={`เว็บของ ${agent.name}`}>
      {!editable && <Note icon="lock">ดูได้อย่างเดียว แก้ได้เฉพาะ Member ที่มี Manage</Note>}
      <Section title="ค้นเว็บ (web_search)" footer="Provider ที่มี tool ค้นเว็บของตัวเองใช้ได้โดยไม่ต้องเปิด Egress ถ้าไม่มี ให้ค้นผ่าน Connector เช่น Brave หรือ Tavily ด้วย key ที่ supervisor ถือ">
        <Row
          icon="network"
          title="แหล่งค้นเว็บ"
          value={editable ? undefined : SEARCH_LABEL[searchValue]}
          accessory={
            editable ? (
              <Select<WebSettings["search"]>
                label="แหล่งค้นเว็บ"
                value={searchValue}
                options={options}
                onChange={(value) => change({ search: value, connector: value === "connector" ? searchers[0]?.id : undefined }, `เปลี่ยนแหล่งค้นเว็บของ ${agent.name} เป็น ${SEARCH_LABEL[value]}`)}
              />
            ) : undefined
          }
        />
        {searchValue === "connector" && (
          <Row
            icon="connector"
            title="Connector ที่ค้น"
            value={editable ? undefined : searchers.find((connector) => connector.id === settings.connector)?.title}
            accessory={
              editable ? (
                <Select
                  label="Connector ที่ค้น"
                  value={settings.connector ?? searchers[0].id}
                  options={searchers.map((connector) => ({ value: connector.id, label: connector.title }))}
                  onChange={(value) => change({ connector: value }, `ให้ ${agent.name} ค้นเว็บผ่าน Connector นี้`)}
                />
              ) : undefined
            }
          />
        )}
        {!providerHasSearch && <Row icon="info" title={`Provider ${agent.providerId} ไม่มี tool ค้นเว็บของตัวเอง`} detail="จึงเลือก “จาก Provider” ไม่ได้" />}
        {searchers.length === 0 && <Row icon="connector" title="ยังไม่มี Connector ที่ค้นเว็บได้" detail="เพิ่ม Connector ที่มี tool web_search หรือ search" href="/connectors" />}
      </Section>
      <Section title="เปิดหน้าเว็บ (web_fetch)" footer="ดึงหน้าเว็บด้วย HTTP ธรรมดาแล้วแปลงเป็นข้อความ ตัดตามขนาดที่ตั้ง หน้าที่ต้องใช้ JavaScript หรือ login ให้ใช้ Connector อย่าง Firecrawl">
        {editable ? (
          <ToggleRow icon="network" title="เปิดใช้ web_fetch" value={settings.fetch} onChange={(value) => (value ? change({ fetch: true }, `เปิด web_fetch ให้ ${agent.name} เปิดเว็บใน Egress`) : setWebSettings(agent.id, { fetch: false }))} />
        ) : (
          <Row icon="network" title="web_fetch" value={settings.fetch ? "เปิด" : "ปิด"} />
        )}
        <Row icon="file" title="ขนาดสูงสุดต่อหน้า" value={`${settings.maxKb} KB`} />
        {editable && (
          <>
            <Field label={`ขนาดใหม่ (KB, ${MIN_KB} ถึง ${MAX_KB})`} value={kb ?? String(settings.maxKb)} onChangeText={setKb} keyboardType="number-pad" />
            <View style={{ padding: space.sm, alignItems: "flex-start" }}>
              <Button label="บันทึกขนาด" onPress={saveKb} disabled={kb === undefined} />
            </View>
          </>
        )}
      </Section>
      <Section title={`Egress ของ ${agent.name}`} footer="web_fetch รันใน worker จึงเปิดได้เฉพาะโดเมนในรายการนี้ supervisor ไม่เปิดเว็บแทน ไม่อย่างนั้น Agent จะเปิดเว็บไหนก็ได้โดยไม่ผ่าน Egress แก้รายการได้ที่หน้า Egress ของ Agent">
        {policy.internet && <Row icon="network" title="ออกได้ทั้งเน็ตสาธารณะ" detail="ไม่รวมที่อยู่ภายใน" />}
        {!policy.internet && policy.egress.length === 0 && <Row icon="info" title="ยังไม่มีโดเมน" detail="web_fetch เปิดอะไรไม่ได้" />}
        {!policy.internet && policy.egress.map((domain) => <Row key={domain} icon="network" title={domain} mono />)}
        <Row icon="settings" title="แก้ Egress" href={`/agents/${agent.id}/egress`} />
      </Section>
      {anyUrl.length > 0 && (
        <Note icon="approval" iconColor="orange">
          {anyUrl.join(", ")} เปิด URL ใดก็ได้จากเซิร์ฟเวอร์ของผู้ให้บริการ จึงข้าม Egress ได้ tool นี้ขอ Approval ทุกครั้งและใส่ Allowlist ไม่ได้ supervisor เป็นคนบังคับ
        </Note>
      )}
      <Section title="ลองเปิด URL" footer="จำลอง: ตรวจกฎของ web_fetch เท่านั้น ไม่ได้ออกเน็ตจริง">
        <Field label="URL" value={url} onChangeText={(text) => (setUrl(text), setResult(undefined))} placeholder="https://github.com/..." />
        <View style={{ padding: space.sm, alignItems: "flex-start", gap: space.sm }}>
          <Button label="จำลอง: web_fetch" onPress={tryFetch} />
          {result && (
            <Label icon={result.ok ? "done" : "failed"} iconColor={result.ok ? "green" : "red"} variant="subheadline">
              {result.ok ? `เปิด ${result.host} ได้ ตัดที่ ${settings.maxKb} KB` : result.reason}
            </Label>
          )}
        </View>
      </Section>
    </Screen>
  );
}
