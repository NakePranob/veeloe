import { builtInCovers, entryCovers, isUnsafeCommand, matchesAllowlist, READ_ONLY_ALLOWLIST, splitCommand } from "@veeloe/protocol-ts";

/**
 * The Allowlist as the screens work it out (ADR 0030, 0075). Every rule is the
 * Protocol's own, so the app and the worker can never disagree about whether a
 * command waits for an Approval.
 */
export { READ_ONLY_ALLOWLIST as READ_ONLY_COMMANDS };

/** The parts a command runs as: `&&`, `;`, `|` and `&` each start another one. */
export const commandParts = (command: string) => splitCommand(command);

/** True when every part of the command runs without an Approval: on the list or built in. */
export const allowed = (command: string, allowlist: readonly string[]) => matchesAllowlist(command, allowlist);

/** Does this one entry cover that command? What the "try a command" list shows per part; built-ins don't count here. */
export const covers = (entry: string, command: string) => !isUnsafeCommand(command) && commandParts(command).every((part) => entryCovers(entry, part));

/** A part that runs with no entry at all: it prints or reads and runs no other program (ADR 0075). */
export const builtIn = (part: string) => !isUnsafeCommand(part) && builtInCovers(part);

/** The parts "allow always" offers: only those not on the list yet and not built in. */
export const missingParts = (command: string, allowlist: readonly string[]) => commandParts(command).filter((part) => !allowed(part, allowlist));
