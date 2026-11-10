import { matchesAllowlist, READ_ONLY_ALLOWLIST, splitCommand } from "@veeloe/protocol-ts";

/**
 * The Allowlist as the screens work it out (ADR 0030). Every rule is the
 * Protocol's own, so the app and the worker can never disagree about whether a
 * command waits for an Approval.
 */
export { READ_ONLY_ALLOWLIST as READ_ONLY_COMMANDS };

/** The parts a command runs as: `&&`, `;`, `|` and `&` each start another one. */
export const commandParts = (command: string) => splitCommand(command);

/** True when every part of the command is covered, and nothing in it needs an Approval on its own. */
export const allowed = (command: string, allowlist: readonly string[]) => matchesAllowlist(command, allowlist);

/** Does this one entry cover that command? What the "try a command" list shows per part. */
export const covers = (entry: string, command: string) => matchesAllowlist(command, [entry]);

/** The parts "allow always" offers: only those not on the list yet (controller-prototype's missingParts). */
export const missingParts = (command: string, allowlist: readonly string[]) => commandParts(command).filter((part) => !allowed(part, allowlist));
