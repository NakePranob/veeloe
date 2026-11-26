import { z } from "zod";

const MAX_TOKEN = 256;

/** Controller → Machine: where Expo Push Service can reach this Controller (ADR 0044). */
export const PushRegisterBodySchema = z.looseObject({
  token: z.string().min(1).max(MAX_TOKEN).regex(/^ExponentPushToken\[.+\]$/),
  language: z.enum(["th", "en"]).optional(),
});
export type PushRegisterBody = z.infer<typeof PushRegisterBodySchema>;

/** Machine → Controller: the token was kept for this Controller's key. */
export const PushRegisteredBodySchema = z.looseObject({
  token: z.string().min(1).max(MAX_TOKEN),
});
export type PushRegisteredBody = z.infer<typeof PushRegisteredBodySchema>;

/** Controller → Machine: stop sending pushes to this Controller. */
export const PushUnregisterBodySchema = z.looseObject({});
export type PushUnregisterBody = z.infer<typeof PushUnregisterBodySchema>;

/** Machine → Controller: the token was removed, or was not there. */
export const PushUnregisteredBodySchema = z.looseObject({});
export type PushUnregisteredBody = z.infer<typeof PushUnregisteredBodySchema>;
