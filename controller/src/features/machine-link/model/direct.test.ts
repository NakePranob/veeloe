import { expect, test } from "bun:test";
import { DIRECT_MAX_BYTES, openDirect, type Channel, type Peer } from "./direct";

type Handlers = Record<string, (() => void)[]>;

function fakePeer() {
  const channelHandlers: Record<string, ((event: { data?: unknown }) => void)[]> = {};
  const peerHandlers: Handlers = {};
  const sent: string[] = [];
  const channel: Channel = {
    readyState: "connecting",
    send: (text) => void sent.push(text),
    close: () => {
      channel.readyState = "closed";
    },
    addEventListener: (type, listener) => void (channelHandlers[type] ??= []).push(listener),
  };
  let remote: string | undefined;
  const peer: Peer & { closed: boolean } = {
    iceGatheringState: "new",
    connectionState: "new",
    localDescription: null,
    closed: false,
    createDataChannel: () => channel,
    createOffer: async () => ({ type: "offer", sdp: "v=0 offer" }),
    setLocalDescription: async (description) => {
      peer.localDescription = { sdp: description.sdp ?? "" };
      peer.iceGatheringState = "complete";
      for (const listener of peerHandlers.icegatheringstatechange ?? []) listener();
    },
    setRemoteDescription: async (description) => {
      remote = description.sdp;
    },
    addEventListener: (type, listener) => void (peerHandlers[type] ??= []).push(listener),
    close: () => {
      peer.closed = true;
    },
  };
  return {
    peer,
    channel,
    sent,
    remote: () => remote,
    open: () => {
      channel.readyState = "open";
      for (const listener of channelHandlers.open ?? []) listener({});
    },
    message: (data: string) => {
      for (const listener of channelHandlers.message ?? []) listener({ data });
    },
    fail: () => {
      peer.connectionState = "failed";
      for (const listener of peerHandlers.connectionstatechange ?? []) listener();
    },
  };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

test("an offer goes out, only its own answer is taken, and the open channel carries envelopes both ways", async () => {
  const fake = fakePeer();
  const offers: { id: string; sdp: string }[] = [];
  const frames: string[] = [];
  let send: ((text: string) => boolean) | undefined;
  const link = openDirect({ createPeer: () => fake.peer, newId: () => "dl_1", offer: (body) => offers.push(body), onOpen: (write) => (send = write), onClose: () => {}, onFrame: (text) => frames.push(text) });
  await settle();
  expect(offers).toEqual([{ id: "dl_1", sdp: "v=0 offer" }]);

  link.answer("dl_other", "v=0 not ours");
  link.answer("dl_1", "v=0 answer");
  await settle();
  expect(fake.remote()).toBe("v=0 answer");

  fake.open();
  expect(send?.('{"type":"task.message"}')).toBe(true);
  expect(fake.sent).toEqual(['{"type":"task.message"}']);
  // Too big for the link: the caller sends it through the Hub.
  expect(send?.("x".repeat(DIRECT_MAX_BYTES + 1))).toBe(false);
  // Measured in bytes, as the link counts: Thai is three a letter.
  expect(send?.("ก".repeat(Math.ceil(DIRECT_MAX_BYTES / 3) + 1))).toBe(false);
  fake.message('{"type":"agent.listed"}');
  expect(frames).toEqual(['{"type":"agent.listed"}']);
});

test("a link that fails says so once, and writes nothing after", async () => {
  const fake = fakePeer();
  let closes = 0;
  let send: ((text: string) => boolean) | undefined;
  openDirect({ createPeer: () => fake.peer, newId: () => "dl_1", offer: () => {}, onOpen: (write) => (send = write), onClose: () => closes++, onFrame: () => {} });
  await settle();
  fake.open();
  fake.fail();
  fake.fail();
  expect(closes).toBe(1);
  expect(fake.peer.closed).toBe(true);
  expect(send?.("{}")).toBe(false);
});
