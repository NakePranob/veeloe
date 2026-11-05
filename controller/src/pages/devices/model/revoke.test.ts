import { expect, mock, test } from "bun:test";
import { publicKeyOf, toBase64url, verifyCertificate } from "@veeloe/protocol";
import * as devicesModel from "../../../entities/device/model/devices";
import type { Device } from "../../../entities/device";

// The entity's public API also brings its React hook, which Bun cannot load.
mock.module("../../../entities/device", () => devicesModel);
const { revocationOf, revokeDevice } = await import("./revoke");

// TEST-ONLY KEYS.
const seed = new Uint8Array(32).fill(0x44);
const machine = { hub_url: "wss://hub.example.com", workspace_id: "w_1", member_id: "m_1" };
const device = (key: string, linked_by: string | null = null, revoked = false): Device => ({ key, member_id: "m_1", name: key, linked_by, linked_at: linked_by ? 1 : null, revoked_at: revoked ? 2 : null });
const devices = [device("phone"), device("browser", "phone"), device("ipad", "browser"), device("old", "phone", true)];

const counting = () => {
  const sent: unknown[] = [];
  const fetchFn = (async (_: string, init: RequestInit) => (sent.push(JSON.parse(String(init.body))), Response.json({}))) as unknown as typeof fetch;
  return { sent, fetchFn };
};

test("what goes with a device follows who linked whom, unless kept", () => {
  expect(revocationOf(devices, "browser", [])).toMatchObject({ drops: ["browser", "ipad"] });
  expect(revocationOf(devices, "browser", ["ipad"]).survivors.map((d) => d.key)).toEqual(["phone", "ipad"]);
  expect(revocationOf(devices, "phone", []).survivors).toEqual([]);
});

test("the last device is refused before anything is asked or signed", async () => {
  const { sent, fetchFn } = counting();
  let asked = 0;
  const answer = await revokeDevice(async () => (asked++, true), { device: "phone", keep: [], devices, machine, fetchFn });
  expect(answer).toEqual({ ok: false, code: "hub.last_device" });
  expect([asked, sent.length]).toEqual([0, 0]);
});

test("cancelling the authentication signs and sends nothing", async () => {
  const { sent, fetchFn } = counting();
  expect(await revokeDevice(async () => false, { device: "browser", keep: [], devices, machine, fetchFn })).toBeNull();
  expect(sent).toEqual([]);
});

test("a revocation is signed with what is kept and goes to the Hub", async () => {
  const { sent, fetchFn } = counting();
  expect(await revokeDevice(async (use) => (await use(seed), true), { device: "browser", keep: ["ipad"], devices, machine, fetchFn })).toEqual({ ok: true });
  expect(verifyCertificate(sent[0])).toMatchObject({ type: "device.revoke", key: "browser", keep: ["ipad"], member: "m_1", by: toBase64url(publicKeyOf(seed)) });
});
