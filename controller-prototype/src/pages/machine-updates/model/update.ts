import { getAgents, getMachines, updateMachine, type Machine } from "../../../entities/agent";
import { FROZEN_MESSAGE, isFrozen } from "../../../entities/account";
import type { Member } from "../../../entities/member";
import { getTasks } from "../../../entities/task";
import { addBackup, compareVersions, DRAIN_LIMIT, getRun, getUpdates, patchRun, patchUpdates, startRun, THIS_WORKSPACE, type Backup } from "../../../entities/update";
import { getRuntime, restartMachine, setMachineOnline, setMachinePaused } from "../../../features/demo-runtime";
import { authenticate, confirm } from "../../../shared/ui";

type Refusal = string | null;
const CANCELLED = "ยกเลิกการยืนยันตัวตน ยังไม่ได้ทำอะไร";
const HUB_REFUSAL = "Hub ปฏิเสธ Runtime";

const openTurns = (machineId: string) => getAgents().filter((agent) => agent.machineId === machineId && getRuntime().running[agent.id]).length;
const timers = new Map<string, ReturnType<typeof setInterval>>();

// The Runtime found a newer release: it stops taking new Turns, waits up to 30 minutes for the
// ones running, checks the manifest's signature, swaps the files and restarts (ADR 0009, 0033).
// ponytail: GitHub Releases are replaced by the release in the updates store; the timing is shortened.
export function foundRelease(machine: Machine): Refusal {
  const { latest } = getUpdates();
  if (compareVersions(machine.version, latest.version) >= 0) return "Runtime เป็นรุ่นล่าสุดแล้ว";
  const now = Date.now();
  startRun({ machineId: machine.id, from: machine.version, to: latest.version, phase: "draining", startedAt: now, deadline: now + DRAIN_LIMIT, interrupted: 0 });
  // New work queues as usual; nothing starts until the restart.
  setMachinePaused(machine.id, true);
  timers.get(machine.id) && clearInterval(timers.get(machine.id));
  timers.set(machine.id, setInterval(() => tick(machine.id), 1000));
  return null;
}

function tick(machineId: string) {
  const run = getRun(machineId);
  if (!run || run.phase !== "draining") return;
  if (openTurns(machineId) === 0 || Date.now() >= run.deadline) {
    clearInterval(timers.get(machineId));
    timers.delete(machineId);
    verify(machineId);
  }
}

function verify(machineId: string) {
  patchRun(machineId, { phase: "verifying" });
  setTimeout(() => {
    if (!getUpdates().latest.signatureValid) {
      // Nothing was swapped, so the old Runtime goes on working.
      setMachinePaused(machineId, false);
      patchRun(machineId, { phase: "failed", error: "ลายเซ็นของ manifest ไม่ถูกต้อง จึงไม่สลับไฟล์ Runtime รุ่นเดิมทำงานต่อ" });
      return;
    }
    patchRun(machineId, { phase: "swapping" });
    setTimeout(() => {
      const run = getRun(machineId);
      if (!run) return;
      // Turns still open at the deadline end as interrupted, like a Stop (ADR 0033).
      patchRun(machineId, { phase: "restarting", interrupted: openTurns(machineId) });
      setTimeout(() => {
        restartMachine(machineId);
        updateMachine(machineId, { version: run.to });
        setMachinePaused(machineId, false);
        applyMinimum(getUpdates().hubMinimum);
        patchRun(machineId, { phase: "done" });
      }, 1200);
    }, 1200);
  }, 1200);
}

export function skipWait(machineId: string) {
  patchRun(machineId, { deadline: Date.now() });
}

// The Hub does not accept a Runtime older than its minimum; a Machine that updates is let back in (ADR 0009).
export function applyMinimum(minimum: string) {
  patchUpdates({ hubMinimum: minimum });
  for (const machine of getMachines()) {
    const refused = compareVersions(machine.version, minimum) < 0;
    if (refused && machine.online) {
      setMachineOnline(machine.id, false);
      updateMachine(machine.id, { lastError: `${HUB_REFUSAL} รุ่น ${machine.version}: ต่ำกว่าขั้นต่ำ ${minimum} ให้ Runtime อัปเดตตัวเอง` });
    } else if (!refused && machine.lastError?.startsWith(HUB_REFUSAL)) {
      updateMachine(machine.id, { lastError: undefined });
      setMachineOnline(machine.id, true);
    }
  }
}

export const refusedByHub = (machine: Machine) => compareVersions(machine.version, getUpdates().hubMinimum) < 0;

export function newRelease() {
  const [major, minor, patch] = getUpdates().latest.version.split(".").map(Number);
  patchUpdates({ latest: { version: `${major}.${minor}.${patch + 1}`, publishedAt: Date.now(), signatureValid: getUpdates().latest.signatureValid } });
}

export function setSignatureValid(valid: boolean) {
  const { latest } = getUpdates();
  patchUpdates({ latest: { ...latest, signatureValid: valid } });
}

// `veeloe backup <file>`: a copy of tasks.db and the other files, without secrets (ADR 0051).
export function runBackup(machine: Machine) {
  const agents = getAgents().filter((agent) => agent.machineId === machine.id);
  addBackup({ machineId: machine.id, machineName: machine.name, workspace: THIS_WORKSPACE, agents: agents.length, tasks: getTasks().filter((task) => agents.some((agent) => agent.id === task.agent)).length });
}

// `veeloe restore <file>` on a fresh Machine, then Pairing. It works only into the Workspace the
// backup came from, and the secrets come back empty (ADR 0051).
export async function restore(me: Member, machine: Machine, backup: Backup): Promise<Refusal> {
  if (!me.owner) return "เฉพาะ Owner ที่ Pairing เครื่องที่กู้คืนได้";
  if (isFrozen(me.id)) return FROZEN_MESSAGE;
  if (backup.workspace !== THIS_WORKSPACE) return "backup นี้มาจาก Workspace อื่น กู้เข้า Workspace นี้ไม่ได้ ถ้าจะย้ายข้าม Workspace ให้ Owner เดิมเซ็นปล่อย Machine ตาม ADR 0035";
  const replacing = backup.machineId !== machine.id ? getMachines().find((candidate) => candidate.id === backup.machineId) : undefined;
  if (!(await confirm({ title: `เครื่องนี้ (${machine.name}) แทน ${backup.machineName} เดิมหรือเปล่า`, message: "Agent, Grant, Project และประวัติกลับมาครบ กุญแจของ Machine เดิมถูกถอน กันไม่ให้มีสองเครื่องเป็นตัวเดียวกัน ความลับต้องใส่ใหม่ทั้งหมด", action: "แทนเครื่องเดิม" }))) return null;
  if (!(await authenticate(`Pairing ${machine.name} เป็นเครื่องที่กู้คืนจาก backup`))) return CANCELLED;
  updateMachine(machine.id, {
    providers: machine.providers.map((provider) => ({ ...provider, keyHint: "ใส่ใหม่" })),
    lastError: "กู้จาก backup แล้ว ใส่ key ของ Provider, token ของ bot และ login Connector ใหม่",
  });
  if (replacing) {
    setMachineOnline(replacing.id, false);
    updateMachine(replacing.id, { lastError: `กุญแจถูกถอน เพราะ ${machine.name} กู้คืนแทนเครื่องนี้` });
  }
  return null;
}
