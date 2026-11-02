// Whether a bash command runs without Approval (ADR 0030): prefixes compared word by
// word, every part of a chain must pass, and what cannot be split safely always asks.
const UNSPLITTABLE = /\$\(|`|\beval\b/;

const words = (text: string) => text.trim().split(/\s+/);

function partAllowed(part: string, allowlist: string[]) {
  const command = words(part);
  return allowlist.some((entry) => {
    const prefix = words(entry);
    return prefix.every((word, i) => command[i] === word);
  });
}

export function commandParts(command: string) {
  return command.split(/&&|;|\|/).map((part) => part.trim()).filter(Boolean);
}

export function allowed(command: string, allowlist: string[]) {
  if (UNSPLITTABLE.test(command)) return false;
  const parts = commandParts(command);
  return parts.length > 0 && parts.every((part) => partAllowed(part, allowlist));
}

// The parts "allow always" offers: only those not on the list yet.
export function missingParts(command: string, allowlist: string[]) {
  return commandParts(command).filter((part) => !partAllowed(part, allowlist));
}

export function covers(entry: string, command: string) {
  return partAllowed(command, [entry]);
}
