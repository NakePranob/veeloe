import { describe, expect, test } from "bun:test";
import { ApprovalAnswerBodySchema, ApprovalAnsweredBodySchema, ApprovalRequestedBodySchema } from "./approval";

describe("ApprovalAnswerBodySchema", () => {
  test("accepts approve, deny and redirect", () => {
    for (const decision of ["approve", "deny", "redirect"] as const) {
      const parsed = ApprovalAnswerBodySchema.safeParse({ agent: "a1", request: "ap_1", decision });
      expect(parsed.success).toBe(true);
    }
  });

  test("a redirect carries a message and approve may carry a prefix", () => {
    const parsed = ApprovalAnswerBodySchema.safeParse({ agent: "a1", request: "ap_1", decision: "redirect", message: "use ls instead" });
    expect(parsed.success).toBe(true);
    const always = ApprovalAnswerBodySchema.safeParse({ agent: "a1", request: "ap_1", decision: "approve", allowAlways: "npm" });
    expect(always.success).toBe(true);
  });

  test("rejects an unknown decision or empty request", () => {
    expect(ApprovalAnswerBodySchema.safeParse({ agent: "a1", request: "ap_1", decision: "maybe" }).success).toBe(false);
    expect(ApprovalAnswerBodySchema.safeParse({ agent: "a1", request: "", decision: "approve" }).success).toBe(false);
  });
});

describe("approval event bodies", () => {
  test("requested holds the command, its parts and expiry", () => {
    const parsed = ApprovalRequestedBodySchema.safeParse({ request: "ap_1", command: "rm -rf dist", parts: ["rm -rf dist"], expiresAt: 1 });
    expect(parsed.success).toBe(true);
  });

  test("answered holds who answered and how", () => {
    const parsed = ApprovalAnsweredBodySchema.safeParse({ request: "ap_1", member: "m_kai", decision: "deny" });
    expect(parsed.success).toBe(true);
  });
});

test("allowAlways takes one entry or several, so every part still asking can be signed", () => {
  expect(ApprovalAnswerBodySchema.safeParse({ agent: "a1", request: "ap_1", decision: "approve", allowAlways: "npm" }).success).toBe(true);
  const many = ApprovalAnswerBodySchema.safeParse({ agent: "a1", request: "ap_1", decision: "approve", allowAlways: ["rm -rf dist", "npm run build"] });
  expect(many.success).toBe(true);
  expect(many.success && many.data.allowAlways).toEqual(["rm -rf dist", "npm run build"]);
  expect(ApprovalAnswerBodySchema.safeParse({ agent: "a1", request: "ap_1", decision: "approve", allowAlways: [] }).success).toBe(false);
});
