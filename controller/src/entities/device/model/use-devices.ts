import { useLiveQuery } from "../../../shared/db";
import { useMemo } from "react";
import { type AgentGrant, DEVICE_TOPIC, LIST_DEVICES, LIST_GROUPS, LIST_MEMBERS, MEMBER_TOPIC, mergeGroups, type Device, type Member } from "./devices";

const TOPICS = [DEVICE_TOPIC];
const MEMBERS = [MEMBER_TOPIC];

/** Null until the first read lands. */
export function useDevices() {
  return useLiveQuery<Device>(LIST_DEVICES, [], TOPICS);
}

/** The Members let in through an Invitation, those taken out included. Null until the first read lands. */
export function useMembers() {
  return useLiveQuery<Member>(LIST_MEMBERS, [], MEMBERS);
}

/** Every Grant this device last heard of, for the Agents its Member manages. */
export function useGrants() {
  return useLiveQuery<AgentGrant>("SELECT * FROM agent_grant", [], MEMBERS);
}

/** Every group this device heard of, each Machine's copy added up. Null until the first read lands. */
export function useGroups() {
  const rows = useLiveQuery<Parameters<typeof mergeGroups>[0][number]>(LIST_GROUPS, [], MEMBERS);
  return useMemo(() => (rows ? mergeGroups(rows) : null), [rows]);
}
