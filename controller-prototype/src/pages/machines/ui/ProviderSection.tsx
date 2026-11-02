import { useState } from "react";
import { View } from "react-native";
import { addProvider, removeProvider, updateMachine, useAgents, type Machine } from "../../../entities/agent";
import { formatTokens } from "../../../shared/lib";
import { Button, confirm, Field, inform, Note, Row, Section, space } from "../../../shared/ui";
import { askProvider } from "../model/models";

// True, after saying why, when the Machine cannot take the change: the Runtime asks the Provider itself.
function offline(machine: Machine) {
  if (machine.online) return false;
  inform("Machine ออฟไลน์", `${machine.name} ต้องออนไลน์ก่อน เพราะ Runtime เป็นคนถาม Provider ด้วย key ที่ถืออยู่`);
  return true;
}

// Providers live on the Machine: the key is entered once, sealed to this Machine, and only its
// last characters stay readable here (ADR 0005, 0042).
export function ProviderSection({ machine, owner }: { machine: Machine; owner: boolean }) {
  const agents = useAgents();
  const [open, setOpen] = useState<string>();
  const [context, setContext] = useState("");
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ name: "", url: "https://", key: "" });

  function add() {
    if (offline(machine)) return;
    const name = draft.name.trim();
    let url: URL;
    try {
      url = new URL(draft.url.trim());
    } catch {
      return inform("เพิ่ม Provider ไม่ได้", "URL ไม่ถูกต้อง");
    }
    if (url.protocol !== "https:" && url.hostname !== "localhost") return inform("เพิ่ม Provider ไม่ได้", "ต้องเป็น https เพราะ key วิ่งไปกับคำขอ (ยกเว้น localhost)");
    if (!name) return inform("เพิ่ม Provider ไม่ได้", "ตั้งชื่อ Provider ก่อน");
    if (machine.providers.some((provider) => provider.name.toLowerCase() === name.toLowerCase())) return inform("เพิ่ม Provider ไม่ได้", `${machine.name} มี Provider ชื่อ ${name} แล้ว`);
    if (draft.key.trim().length < 8) return inform("เพิ่ม Provider ไม่ได้", "key สั้นเกินไป");
    const { models, contextSize } = askProvider(url.href);
    // Only the hint survives: the key itself was sealed to the Machine and is dropped here.
    addProvider(machine.id, { name, url: url.origin, keyHint: `…${draft.key.trim().slice(-4)}`, models, contextSize });
    setDraft({ name: "", url: "https://", key: "" });
    setAdding(false);
  }

  function remove(id: string, name: string) {
    if (offline(machine)) return;
    const using = agents.filter((agent) => agent.machineId === machine.id && agent.providerId === id);
    if (using.length) return inform(`ลบ ${name} ไม่ได้`, `${using.map((agent) => agent.name).join(", ")} ยังใช้ Provider นี้อยู่ ให้เปลี่ยน Provider ของ Agent เหล่านั้นก่อน ไม่อย่างนั้น Agent จะหยุดทำงาน`);
    confirm({ title: `ลบ ${name}?`, message: "Machine จะลืม key ของ Provider นี้", action: "ลบ", destructive: true }).then((yes) => yes && removeProvider(machine.id, id));
  }

  function saveContext(id: string) {
    const size = Number(context.replace(/,/g, ""));
    if (!Number.isInteger(size) || size < 8_000 || size > 2_000_000) return inform("ขนาด context ไม่ถูกต้อง", "ใส่จำนวน token เต็มระหว่าง 8,000 ถึง 2,000,000");
    updateMachine(machine.id, { providers: machine.providers.map((provider) => (provider.id === id ? { ...provider, contextSize: size } : provider)) });
  }

  return (
    <Section title="Provider" footer="key อยู่กับ supervisor บน Machine นี้ และ Agent ไม่เคยเห็น ถ้า Provider ล่มหรือ key หมดอายุ Agent ทุกตัวที่ใช้ตัวนั้นหยุดพร้อมกัน (ADR 0042)">
      {machine.providers.length === 0 && <Row title="ยังไม่มี Provider" detail={owner ? "เพิ่มก่อน แล้วค่อยสร้าง Agent บนเครื่องนี้" : "Owner เป็นคนเพิ่ม"} />}
      {machine.providers.map((provider) => {
        const using = agents.filter((agent) => agent.machineId === machine.id && agent.providerId === provider.id);
        return (
          <View key={provider.id}>
            <Row
              icon="key"
              title={provider.name}
              detail={`${provider.url} · ${provider.models.length} model · context ${formatTokens(provider.contextSize)}`}
              value={`key ${provider.keyHint}`}
              onPress={() => {
                setOpen(open === provider.id ? undefined : provider.id);
                setContext(String(provider.contextSize));
              }}
            />
            {open === provider.id && (
              <View style={{ paddingLeft: space.xl }}>
                {provider.models.map((model) => (
                  <Row key={model} title={model} mono />
                ))}
                <Row title="ใช้โดย" detail={using.length ? using.map((agent) => agent.name).join(", ") : "ยังไม่มี Agent ใช้"} />
                {owner && (
                  <>
                    <Field label="context ของ model (token)" value={context} onChangeText={setContext} keyboardType="number-pad" footer="ถ้า gateway ไม่บอก ถือว่า 128K Agent จะย่อ Task ที่ 70% ของค่านี้ (ADR 0041)" />
                    <View style={{ flexDirection: "row", gap: space.sm, padding: space.sm }}>
                      <Button label="บันทึกขนาด context" onPress={() => saveContext(provider.id)} />
                      <Button label="ลบ Provider" onPress={() => remove(provider.id, provider.name)} />
                    </View>
                  </>
                )}
              </View>
            )}
          </View>
        );
      })}
      {owner && !adding && <Row icon="add" title="เพิ่ม Provider" onPress={() => setAdding(true)} />}
      {owner && adding && (
        <View>
          <Field label="ชื่อ" value={draft.name} onChangeText={(name) => setDraft({ ...draft, name })} placeholder="เช่น Anthropic ของทีม" />
          <Field label="URL" value={draft.url} onChangeText={(url) => setDraft({ ...draft, url })} keyboardType="url" mono />
          <Field label="key" value={draft.key} onChangeText={(key) => setDraft({ ...draft, key })} secure mono footer="แอปเข้ารหัส key ให้ Machine นี้ และเก็บไว้แค่ 4 ตัวท้ายให้ดู" />
          <View style={{ flexDirection: "row", gap: space.sm, padding: space.sm }}>
            <Button label="เพิ่ม" variant="chip" onPress={add} />
            <Button label="ยกเลิก" onPress={() => setAdding(false)} />
          </View>
          <Note icon="info">แนะนำให้ตั้ง spend limit ที่ Provider ด้วย เป็นเพดานเงินจริงชั้นสุดท้ายถ้า Runtime มีบั๊ก (ADR 0043)</Note>
        </View>
      )}
    </Section>
  );
}
