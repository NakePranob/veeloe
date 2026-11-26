import { z } from "zod";
import { AgentIdSchema } from "./agent";
import { AllowlistEntrySchema } from "./allowlist";

/**
 * การตัดสินใจของ Member ต่อคำขอ Approval หนึ่งรายการ (`approval-and-allowlist`).
 * `always` มีเฉพาะ Approval ของโดเมน: อนุญาตครั้งนี้แล้วเพิ่มโดเมนเข้า Egress ของ
 * Agent ตัวนั้นด้วย (issue #44) คำขอของคำสั่งยังใช้ `approve` กับ `allowAlways`.
 */
export const ApprovalDecisionSchema = z.enum(["approve", "deny", "redirect", "always"]);
export type ApprovalDecision = z.infer<typeof ApprovalDecisionSchema>;

/**
 * Controller → Machine: คำตอบต่อคำขอ Approval หนึ่งรายการ
 * `request` คือรหัสคำขอจาก event `approval.requested`
 * `message` ใช้กับการบอกให้ทำอย่างอื่น (`redirect`)
 * `allowAlways` คือคำนำหน้าที่จะเพิ่มเข้า Allowlist ไปพร้อมกัน ต้องมี Manage (`agent-settings`)
 * รับได้ทั้งคำนำหน้าเดียวและหลายคำนำหน้า เพราะคำสั่งหนึ่งมีได้หลายท่อนที่ยังไม่อยู่ในรายการ
 * และการ์ดเสนอให้เซ็นทีละท่อน (ADR 0023: ของเดิมที่ส่งมาเป็น string เดียวยังใช้ได้)
 */
export const AllowAlwaysSchema = z.union([AllowlistEntrySchema, z.array(AllowlistEntrySchema).min(1).max(20)]);
export const ApprovalAnswerBodySchema = z.looseObject({
  agent: AgentIdSchema,
  request: z.string().min(1).max(64),
  decision: ApprovalDecisionSchema,
  message: z.string().min(1).max(10_000).optional(),
  allowAlways: AllowAlwaysSchema.optional(),
});
export type ApprovalAnswerBody = z.infer<typeof ApprovalAnswerBodySchema>;

/**
 * `body` ของ event `approval.requested`: คำขอที่หยุด Turn ไว้.
 * `kind: "domain"` คือคำขอจาก proxy ของ Agent (issue #44) ซึ่งมี `domain`, `agent`
 * และ `task` แทน `command`; คำขอของคำสั่งยังมี `command` กับ `parts` เหมือนเดิม.
 */
export const ApprovalRequestedBodySchema = z.looseObject({
  request: z.string().min(1).max(64),
  /** `domain` เมื่อ proxy เป็นคนขอ; ไม่มีในคำขอของคำสั่ง. */
  kind: z.enum(["domain"]).optional(),
  domain: z.string().min(1).max(253).optional(),
  /** Agent และ Task ที่คำขอนี้เป็นของ, ในคำขอของโดเมน. */
  agent: AgentIdSchema.optional(),
  task: z.string().min(1).max(64).optional(),
  command: z.string().min(1).optional(),
  /** ท่อนที่แยกแล้วทีละท่อน. */
  parts: z.array(z.string().min(1)).optional(),
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
