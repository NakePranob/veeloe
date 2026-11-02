import type { Machine } from "../../../entities/agent";
import { inform } from "../../../shared/ui";

// A change is a signed command the Runtime checks before it acts, so it needs the Machine on
// (ADR 0006). Only an Agent's name and description may wait in the outbox (ADR 0021).
export function requireOnline(machine: Machine) {
  if (machine.online) return true;
  inform("Machine ออฟไลน์", `${machine.name} ต้องออนไลน์ก่อน Runtime ต้องตรวจลายเซ็นของคำสั่งนี้`);
  return false;
}
