import { z } from "zod";

/** How many GitHub repos one Agent may use through the git broker. */
export const GIT_REPOS_MAX = 20;

/**
 * One repo an Agent may clone, fetch and push through the git broker (ADR 0069,
 * issue #32): `owner/name` on GitHub, lowercase, so one repo has one spelling.
 * Neither part is `.` or `..`, so it never names a path.
 */
export const GitRepoSchema = z
  .string()
  .regex(/^[a-z0-9_.-]{1,100}\/[a-z0-9_.-]{1,100}$/)
  .refine((repo) => repo.split("/").every((part) => part !== "." && part !== ".."), "not a repo");

/** The whole list, as one Agent keeps it. Empty lets the Agent reach no repo. */
export const GitReposSchema = z.array(GitRepoSchema).max(GIT_REPOS_MAX);
