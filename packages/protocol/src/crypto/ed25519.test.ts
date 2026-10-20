import { expect, test } from "bun:test";
import { fromBase64url, toBase64url } from "./base64url";
import { publicKeyOf, sign, verifySignature } from "./ed25519";

const hex = (s: string) => Uint8Array.from(s.match(/../g) ?? [], (b) => parseInt(b, 16));

// RFC 8032 section 7.1, tests 1 and 2.
const rfc = [
  {
    secret: "9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60",
    public: "d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a",
    message: "",
    signature:
      "e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e065224901555fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b",
  },
  {
    secret: "4ccd089b28ff96da9db6c346ec114e0f5b8a319f35aba624da8cf6ed4fb8a6fb",
    public: "3d4017c3e843895a92b70aa74d1b7ebc9c982ccf2ec4968cc0cd55f12af4660c",
    message: "72",
    signature:
      "92a009a9f0d4cab8720e820b5f642540a2b27b5416503f8fb3762223ebdb69da085ac1e43e15996e458f3613d0f11d8c387b2eaeb4302aeeb00d291612bb0c00",
  },
];

test.each(rfc)("RFC 8032 vector %#", (v) => {
  const secret = hex(v.secret);
  expect(publicKeyOf(secret)).toEqual(hex(v.public));
  expect(sign(hex(v.message), secret)).toEqual(hex(v.signature));
  expect(verifySignature(hex(v.signature), hex(v.message), hex(v.public))).toBe(true);
  expect(verifySignature(hex(v.signature), hex("00"), hex(v.public))).toBe(false);
});

test("a malformed key or signature verifies false instead of throwing", () => {
  expect(verifySignature(new Uint8Array(3), new Uint8Array(), new Uint8Array(32))).toBe(false);
  expect(verifySignature(new Uint8Array(64), new Uint8Array(), new Uint8Array(5))).toBe(false);
});

test("base64url round-trips without padding and refuses other alphabets", () => {
  for (const len of [0, 1, 2, 3, 32, 64]) {
    const bytes = Uint8Array.from({ length: len }, (_, i) => (i * 37 + 251) % 256);
    const text = toBase64url(bytes);
    expect(text).not.toMatch(/[+/=]/);
    expect(fromBase64url(text)).toEqual(bytes);
  }
  expect(() => fromBase64url("ab+/")).toThrow();
  expect(() => fromBase64url("abc=")).toThrow();
  expect(() => fromBase64url("a")).toThrow();
});
