// A Character's look (CONTEXT.md): a floating robot head with a shell, and one part in each of its
// three sockets, in the Agent's colour. It travels as one piece: the Hub keeps it next to the
// Agent's name (ADR 0006).
export const COLORS = ["#F4B183", "#9DC3E6", "#A9D18E", "#C9B3E6", "#F2A7B8", "#F3D98B", "#92D5C8", "#D8C3A5"] as const;
export const SHELLS = ["box", "capsule", "dome", "chamfer"] as const;
export const TOPS = ["none", "antenna", "twin", "fin", "beacon"] as const;
export const SIDES = ["none", "ears", "pods", "fins"] as const;
export const DECALS = ["none", "brow", "lights", "grille"] as const;

export type Shell = (typeof SHELLS)[number];
export type Top = (typeof TOPS)[number];
export type Sides = (typeof SIDES)[number];
export type Decal = (typeof DECALS)[number];

export interface Look {
  color: string;
  shell: Shell;
  top: Top;
  sides: Sides;
  decal: Decal;
}

const one = <T extends string>(options: readonly T[], value: unknown): T => (options.includes(value as T) ? (value as T) : options[0]);

// A newer Controller or the Hub may send a shell or part this one doesn't know (ADR 0023): each slot
// it doesn't know falls back to its first option on its own, and the rest of the look stays.
export function lookOf(raw: Partial<Record<keyof Look, unknown>>): Look {
  return {
    color: typeof raw.color === "string" && /^#[0-9a-f]{6}$/i.test(raw.color) ? raw.color : COLORS[0],
    shell: one(SHELLS, raw.shell),
    top: one(TOPS, raw.top),
    sides: one(SIDES, raw.sides),
    decal: one(DECALS, raw.decal),
  };
}

export const sameLook = (a: Look, b: Look) =>
  a.color.toLowerCase() === b.color.toLowerCase() && a.shell === b.shell && a.top === b.top && a.sides === b.sides && a.decal === b.decal;

// Editing works on a draft: picking changes the draft only, and Done hands the whole of it to
// updateCharacter, so Cancel just drops it.
export const pick = (draft: Look, slot: keyof Look, value: string): Look => lookOf({ ...draft, [slot]: value });

const draw = <T>(options: readonly T[], random: () => number) => options[Math.floor(random() * options.length)];

// A random look no other Agent has, so a shuffle never makes two Agents look alike.
// ponytail: up to 50 tries, since a Workspace has a few Agents and there are 2,560 looks.
export function shuffleLook(others: Look[], random = Math.random): Look {
  for (let tries = 1; ; tries++) {
    const look: Look = { color: draw(COLORS, random), shell: draw(SHELLS, random), top: draw(TOPS, random), sides: draw(SIDES, random), decal: draw(DECALS, random) };
    if (tries >= 50 || !others.some((other) => sameLook(other, look))) return look;
  }
}
