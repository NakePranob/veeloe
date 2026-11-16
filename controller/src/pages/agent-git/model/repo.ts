import { GitRepoSchema } from "@veeloe/protocol-ts";

/**
 * What a person typed or pasted, as the `owner/name` the Machine keeps: a
 * GitHub URL (https or ssh, with or without `.git`) is read for its repo, and
 * case is dropped since GitHub ignores it. Null when it names no repo.
 */
export function toRepo(input: string): string | null {
  let text = input.trim().toLowerCase();
  text = text.replace(/^(https?:\/\/)?(www\.)?github\.com\//, "").replace(/^git@github\.com:/, "");
  text = text.replace(/\/+$/, "").replace(/\.git$/, "");
  return GitRepoSchema.safeParse(text).success ? text : null;
}
