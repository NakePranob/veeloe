/** What a slice was sent, once it has been verified: who sent it and its envelope's sig for answers. */
export type Inbound = { member: string; ref: string; task?: string };

/** How a slice answers. Every envelope out is signed by the Machine and goes to the Members named. */
export type Outbox = {
  toMember(member: string, type: string, body: unknown, task?: string): void;
  error(to: Inbound, code: string): void;
};
