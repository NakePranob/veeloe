import { z } from "zod";

/** SDP is text, and a data-only offer with every host address fits well under this. */
export const DIRECT_SDP_MAX = 16_384;

const id = z.string().min(1).max(64);
const sdp = z.string().min(1).max(DIRECT_SDP_MAX);

/**
 * Controller → Machine: offer a direct link (ADR 0090). The SDP carries this device's DTLS
 * fingerprint under the signature, so a Hub that swaps it breaks the signature, and one that
 * keeps it cannot stand in for the device.
 */
export const DirectOfferBodySchema = z.looseObject({ id, sdp });
export type DirectOfferBody = z.infer<typeof DirectOfferBodySchema>;

/** Machine → Controller: the answer to one offer, named by the offer's `id`. */
export const DirectAnswerBodySchema = z.looseObject({ id, sdp });
export type DirectAnswerBody = z.infer<typeof DirectAnswerBodySchema>;

/**
 * Controller → Machine, on the direct link itself: stop writing on it. What the Machine sends after
 * this goes through the Hub, so nothing is lost while the link winds down.
 */
export const DirectCloseBodySchema = z.looseObject({ id });
export type DirectCloseBody = z.infer<typeof DirectCloseBodySchema>;
