import { z } from "zod";

/**
 * An Agent's id, which is also a folder name on the Machine (ADR 0032), so
 * nothing that could leave it. Shared by every message that names an Agent, and
 * by `egress.set` when it aims at one Agent (issue #43).
 */
export const AgentIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
