import { expect, test } from "bun:test";
import { toBase64url } from "../crypto/base64url";
import { publicKeyOf } from "../crypto/ed25519";
import { buildInvitationLink, parseInvitationLink, shortCode } from "./invitation";

// TEST-ONLY KEYS from fixed seeds.
const key = toBase64url(publicKeyOf(new Uint8Array(32).fill(0x44)));
const other = toBase64url(publicKeyOf(new Uint8Array(32).fill(0x45)));

test("the short code is six Crockford characters from the key, and another key gets another", () => {
  expect(shortCode(key)).toMatch(/^[0-9A-HJKMNP-TV-Z]{3}-[0-9A-HJKMNP-TV-Z]{3}$/);
  expect(shortCode(key)).toBe(shortCode(key));
  expect(shortCode(other)).not.toBe(shortCode(key));
});

test("an invitation link reads back as written, and an expired or bent one does not", () => {
  const link = { hub: "wss://hub.example.com", id: toBase64url(new Uint8Array(16).fill(1)), secret: toBase64url(new Uint8Array(32).fill(2)), by: key, from: "Pang & co", expires: 2_000_000_000 };
  const text = buildInvitationLink(link);
  expect(parseInvitationLink(text, 1_900_000_000_000)).toEqual({ ok: true, link });
  expect(parseInvitationLink(text, 2_100_000_000_000)).toEqual({ ok: false, reason: "expired" });
  expect(parseInvitationLink(text.replace(`by=${key}`, "by=short"), 0)).toEqual({ ok: false, reason: "malformed" });
  expect(parseInvitationLink(text.replace("veeloe://invite?", "veeloe://link?"), 0)).toEqual({ ok: false, reason: "malformed" });
});
