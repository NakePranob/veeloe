import { z } from "zod";
import { AllowlistSchema } from "./allowlist";
import { AgentIdSchema } from "./ids";

/** Every N minutes is at least this often (issue #56): a tighter loop is a cost, not a Schedule. */
export const SCHEDULE_MIN_MINUTES = 15;
/** At most once a week, written in minutes. */
export const SCHEDULE_MAX_MINUTES = 7 * 24 * 60;
export const TRIGGER_TEXT_MAX = 10_000;

const TriggerIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
/** `HH:MM` on the Machine's own clock, 00:00 to 23:59. */
const ClockSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

/**
 * When a Schedule runs, as a structure, never a cron string (issue #56): exactly
 * one of every N minutes, daily at a time, or weekly on a day (0 is Sunday) at a time.
 */
export const ScheduleSchema = z
  .looseObject({
    every: z.looseObject({ minutes: z.number().int().min(SCHEDULE_MIN_MINUTES).max(SCHEDULE_MAX_MINUTES) }).optional(),
    daily: z.looseObject({ at: ClockSchema }).optional(),
    weekly: z.looseObject({ day: z.number().int().min(0).max(6), at: ClockSchema }).optional(),
  })
  .refine((schedule) => [schedule.every, schedule.daily, schedule.weekly].filter((part) => part !== undefined).length === 1);
export type Schedule = z.infer<typeof ScheduleSchema>;

/** One Trigger as the Controller signs it. Only `schedule` exists yet; Idle Work and Watch come next (ADR 0067). */
export const TriggerSchema = z.looseObject({
  id: TriggerIdSchema,
  kind: z.enum(["schedule"]),
  text: z.string().min(1).max(TRIGGER_TEXT_MAX),
  schedule: ScheduleSchema,
  /** Who a finished round tells once pushes come (ADR 0076): the one who set it, or everyone with Use. */
  notify: z.enum(["me", "use"]).optional(),
  /**
   * What a round nobody watches may do without asking (ADR 0079): entries as in
   * an Allowlist, for this Schedule's rounds only. Non-empty needs Approve.
   */
  allow: AllowlistSchema.optional(),
});
export type Trigger = z.infer<typeof TriggerSchema>;

/** Controller → Machine: create or replace one Trigger whole. */
export const TriggerSetBodySchema = z.looseObject({ agent: AgentIdSchema, trigger: TriggerSchema });
export type TriggerSetBody = z.infer<typeof TriggerSetBodySchema>;

/** Controller → Machine: pause, resume, delete or run now one Trigger. */
export const TriggerTargetBodySchema = z.looseObject({ agent: AgentIdSchema, id: TriggerIdSchema });
export type TriggerTargetBody = z.infer<typeof TriggerTargetBodySchema>;

/** Controller → Machine: every Trigger of one Agent. */
export const TriggerListBodySchema = z.looseObject({ agent: AgentIdSchema });
export type TriggerListBody = z.infer<typeof TriggerListBodySchema>;

/** One Trigger as the Machine holds it: who set it, whether it is paused or suspended, and its rounds. */
export const ListedTriggerSchema = TriggerSchema.extend({
  member: z.string().min(1).max(64),
  paused: z.boolean(),
  /** The key that signed it was revoked, or its Member lost Use: it never runs again. */
  suspended: z.boolean(),
  lastRunAt: z.number().int().nonnegative().optional(),
  /** Computed by the Machine; absent while paused or suspended. */
  nextRunAt: z.number().int().nonnegative().optional(),
  /** A short name the Agent's model gave it from its words, like a Task's; absent until it answers. */
  title: z.string().min(1).max(60).optional(),
  /** The last round that did not start: the Agent was busy or its Budget spent. */
  lastSkip: z.looseObject({ at: z.number().int().nonnegative(), why: z.enum(["busy", "budget"]) }).optional(),
});
export type ListedTrigger = z.infer<typeof ListedTriggerSchema>;

/** Machine → Controller: the answer to every `trigger.*` message. */
export const TriggerListedBodySchema = z.looseObject({ agent: AgentIdSchema, triggers: z.array(ListedTriggerSchema).max(256) });
export type TriggerListedBody = z.infer<typeof TriggerListedBodySchema>;
