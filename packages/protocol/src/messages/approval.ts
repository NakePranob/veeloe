import { z } from "zod";
import { AgentIdSchema } from "./agent";
import { AllowlistEntrySchema } from "./allowlist";

/** การตัดสินใจของ Member ต่อคำขอ Approval หนึ่งรายการ (`approval-and-allowlist`). */
export const ApprovalDecisionSchema = z.enum(["approve", "deny", "redirect"]);
export type ApprovalDecision = z.infer<typeof ApprovalDecisionSchema>;

/**
 * Controller → Machine: คำตอบต่อคำขอ Approval หนึ่งรายการ
 * `request` คือรหัสคำขอจาก event `approval.requested`
 * `message` ใช้กับการบอกให้ทำอย่างอื่น (`redirect`)
 * `allowAlways` คือคำนำหน้าที่จะเพิ่มเข้า Allowlist ไปพร้อมกัน ต้องมี Manage (`agent-settings`)
 */
export const ApprovalAnswerBodySchema = z.looseObject({
  agent: AgentIdSchema,
  request: z.string().min(1).max(64),
  decision: ApprovalDecisionSchema,
  message: z.string().min(1).max(10_000).optional(),
  allowAlways: AllowlistEntrySchema.optional(),
});
export type ApprovalAnswerBody = z.infer<typeof ApprovalAnswerBodySchema>;

/** `body` ของ event `approval.requested`: คำขอที่ worker เขียนลง log แล้วหยุด Turn ไว้. */
export const ApprovalRequestedBodySchema = z.looseObject({
  request: z.string().min(1).max(64),
  command: z.string().min(1),
  /** ท่อนที่แยกแล้วทีละท่อน. */
  parts: z.array(z.string().min(1)),
  /** Unix milliseconds ที่คำขอหมดอายุ. */
  expiresAt: z.number().int().nonnegative(),
});
export type ApprovalRequestedBody = z.infer<typeof ApprovalRequestedBodySchema>;

/** `body` ของ event `approval.answered`: ใครตอบและตอบว่าอะไร (`member` ไม่มีเมื่อหมดเวลาโดยไม่มีคนตอบ). */
export const ApprovalAnsweredBodySchema = z.looseObject({
  request: z.string().min(1).max(64),
  member: z.string().min(1).optional(),
  decision: ApprovalDecisionSchema,
  message: z.string().min(1).max(10_000).optional(),
});
export type ApprovalAnsweredBody = z.infer<typeof ApprovalAnsweredBodySchema>;
