import { covers } from "../../../entities/agent";

/**
 * "Allow always" signs only when every entry, as the Member edited it, still covers the part it came from
 * (ADR 0030): an entry that drifted off its part would approve this command without adding a rule that does.
 */
export const canAllowAlways = (entries: readonly { entry: string; part: string }[]) =>
  entries.length > 0 && entries.every(({ entry, part }) => !!entry.trim() && covers(entry.trim(), part));
