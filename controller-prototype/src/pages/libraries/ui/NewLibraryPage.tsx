import { router } from "expo-router";
import { useState } from "react";
import { useMachines } from "../../../entities/agent";
import { createLibrary } from "../../../entities/library";
import { useCurrentMember } from "../../../entities/member";
import { Empty, Field, Note, Row, Screen, Section, Select } from "../../../shared/ui";

export function NewLibraryPage() {
  const me = useCurrentMember();
  const machines = useMachines();
  const [name, setName] = useState("");
  const [machineId, setMachineId] = useState(machines[0]?.id ?? "");
  if (!me.owner) {
    return (
      <Screen title="สร้าง Library">
        <Empty icon="lock" title="เฉพาะ Owner" detail="Owner เป็นคนสร้าง Library และกำหนดว่า Agent ตัวไหนอ่านหรือเขียน" />
      </Screen>
    );
  }
  const ready = name.trim().length > 0 && machineId !== "";
  return (
    <Screen
      title="สร้าง Library"
      right={{
        label: "สร้าง",
        disabled: !ready,
        onPress: () => {
          router.replace(`/libraries/${createLibrary(name.trim(), machineId, me.id).id}`);
        },
      }}
    >
      <Section>
        <Field label="ชื่อ" value={name} onChangeText={setName} placeholder="เช่น Engineering wiki" />
        <Row title="Machine" detail="Library อยู่บน Machine เดียว Agent บนเครื่องอื่นใช้ไม่ได้" accessory={<Select label="Machine" value={machineId} options={machines.map((machine) => ({ value: machine.id, label: machine.name }))} onChange={setMachineId} />} />
      </Section>
      <Note>สร้างแล้วยังไม่มี Agent ตัวไหนเข้าถึง เลือกได้ในหน้าถัดไป</Note>
    </Screen>
  );
}
