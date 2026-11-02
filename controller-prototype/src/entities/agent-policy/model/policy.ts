import { createStore } from "../../../shared/lib";

// What a Manager sets on one Agent beyond its settings page: where it may reach on the
// network (ADR 0029) and whether a Channel chat may search other Tasks (ADR 0060).
export interface Policy {
  agentId: string;
  egress: string[];
  // The whole public internet, minus internal addresses; reads shrink to Workdir and Library.
  internet: boolean;
  channelSearch: boolean;
}

const policies = createStore<Policy[]>([]);

export const usePolicies = policies.use;
export const getPolicies = policies.get;

const blank = (agentId: string): Policy => ({ agentId, egress: [], internet: false, channelSearch: false });

export function usePolicy(agentId: string | undefined) {
  return usePolicies().find((policy) => policy.agentId === agentId) ?? blank(agentId ?? "");
}

export function getPolicy(agentId: string) {
  return policies.get().find((policy) => policy.agentId === agentId) ?? blank(agentId);
}

export function hasPolicy(agentId: string) {
  return policies.get().some((policy) => policy.agentId === agentId);
}

export function setPolicy(agentId: string, patch: Partial<Omit<Policy, "agentId">>) {
  policies.set((all) =>
    all.some((policy) => policy.agentId === agentId)
      ? all.map((policy) => (policy.agentId === agentId ? { ...policy, ...patch } : policy))
      : [...all, { ...blank(agentId), ...patch }],
  );
}
