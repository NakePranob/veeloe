import type { SkillFile } from "../../../entities/skill";

export interface FileDiff {
  path: string;
  state: "added" | "removed" | "changed";
  added: string[];
  removed: string[];
}

// Lines that differ per file, as a set difference; enough to see what a new version asks for.
// ponytail: order-blind, so a moved line shows as neither; a real diff waits for a diff library.
export function diffFiles(before: SkillFile[], after: SkillFile[]): FileDiff[] {
  const lines = (file?: SkillFile) => (file ? file.content.split("\n").filter(Boolean) : []);
  const out: FileDiff[] = [];
  for (const next of after) {
    const old = before.find((file) => file.path === next.path);
    if (!old) out.push({ path: next.path, state: "added", added: lines(next), removed: [] });
    else if (old.content !== next.content) out.push({ path: next.path, state: "changed", added: lines(next).filter((line) => !lines(old).includes(line)), removed: lines(old).filter((line) => !lines(next).includes(line)) });
  }
  for (const old of before) if (!after.some((file) => file.path === old.path)) out.push({ path: old.path, state: "removed", added: [], removed: lines(old) });
  return out;
}
