import { z } from "zod";
import { AgentIdSchema } from "./agent";

/**
 * The cap plus the notice `runtime-core` appends when the file is longer. A Memory answer is
 * bounded by this, so it never grows with the file (`agent-memory-page`). Counted in UTF-16 code
 * units here and in Unicode scalars in Rust: both refuse anything far over the cap, and the two
 * only differ for astral-plane characters.
 */
export const MEMORY_TEXT_MAX = 4_200;

/** Controller → Machine: one Agent's Memory, with an id to echo in the answer. */
export const MemoryGetBodySchema = z.looseObject({
  /** Echoed in the answer, so a slow answer to an older request can be dropped. */
  request: z.string().min(1).max(64),
  agent: AgentIdSchema,
});
export type MemoryGetBody = z.infer<typeof MemoryGetBodySchema>;

/**
 * Machine → Controller: the text the next Turn's prompt gets, and the whole file's size.
 * `exists` tells an absent file apart from an empty one; both have no text.
 */
export const MemoryGotBodySchema = z
  .looseObject({
    request: z.string().min(1).max(64),
    agent: AgentIdSchema,
    exists: z.boolean(),
    chars: z.number().int().min(0),
    text: z.string().max(MEMORY_TEXT_MAX),
  })
  .refine((body) => body.exists || (body.chars === 0 && body.text === ""), "a missing Memory has no text");
export type MemoryGotBody = z.infer<typeof MemoryGotBodySchema>;
