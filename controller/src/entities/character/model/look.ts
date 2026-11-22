// A Character's look (CONTEXT.md): a floating robot head with a shell, and one part in each of its
// three sockets, in the Agent's colour. The Machine keeps it with the Agent as it was picked, so a
// later version of these lists never changes how an existing Agent looks.
// The colour an Agent with no Character gets. Apart from the picker's colours on purpose: a later
// palette must never change how an existing Agent looks (controller-character).
export const DEFAULT_COLOR = "#F4B183";
// A deleted Agent's head: neutral grey, so nothing in the trash reads as alive (the Agents board).
export const RETIRED_COLOR = "#D9D9D9";
// The colours the picker and a shuffle offer, from the redesign's Character sheet. An Agent keeps
// whatever colour it was given, so one from an older palette still draws in its own colour.
export const COLORS = ["#FFD84D", "#8CCBFF", "#7EE0B5", "#C4B1FF", "#FFB3A1", "#FFB066", "#FFA8D2", "#E3CFA8"] as const;
// The colour names, in COLORS's order, for what a screen reader says on each swatch.
export const COLOR_NAMES = ["butter", "sky", "mint", "lilac", "peach", "orange", "rose", "sand"] as const;
// round is last, so a Controller that does not know it still falls back to box.
export const SHELLS = ["box", "capsule", "dome", "chamfer", "round"] as const;
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

// A newer Controller may have picked a shell or part this one doesn't know (ADR 0023): each slot it
// doesn't know falls back to its first option on its own, and the rest of the look stays. An Agent made
// before it had a Character gets the first of everything, the one default look.
export function lookOf(raw: Partial<Record<keyof Look, unknown>> | null | undefined): Look {
  return {
    color: typeof raw?.color === "string" && /^#[0-9a-f]{6}$/i.test(raw.color) ? raw.color : DEFAULT_COLOR,
    shell: one(SHELLS, raw?.shell),
    top: one(TOPS, raw?.top),
    sides: one(SIDES, raw?.sides),
    decal: one(DECALS, raw?.decal),
  };
}

/** The look in an Agent row's `character` column, which holds the Machine's JSON or null. */
export function lookOfJson(json: string | null) {
  try {
    return lookOf(json ? JSON.parse(json) : null);
  } catch {
    return lookOf(null);
  }
}

// Editing works on a draft: picking changes the draft only, and Done hands the whole of it over.
export const pick = (draft: Look, slot: keyof Look, value: string): Look => lookOf({ ...draft, [slot]: value });

export const sameLook = (a: Look, b: Look) => a.color.toLowerCase() === b.color.toLowerCase() && a.shell === b.shell && a.top === b.top && a.sides === b.sides && a.decal === b.decal;

// biome-ignore lint/style/noNonNullAssertion: every option list is a non-empty constant
const draw = <T>(options: readonly T[], random: () => number) => options[Math.floor(random() * options.length)]!;

// A random look no other Agent has, so a shuffle never makes two Agents look alike.
// ponytail: up to 50 tries, since a Workspace has a few Agents and there are 2,560 looks.
export function shuffleLook(others: Look[], random = Math.random): Look {
  for (let tries = 1; ; tries++) {
    const look: Look = { color: draw(COLORS, random), shell: draw(SHELLS, random), top: draw(TOPS, random), sides: draw(SIDES, random), decal: draw(DECALS, random) };
    if (tries >= 50 || !others.some((other) => sameLook(other, look))) return look;
  }
}

/** A colour lifted toward white: 0 is the colour, 1 is white. The Character page's stage and a picked tile. */
export function tint(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16);
  const lift = (v: number) =>
    Math.round(v + (255 - v) * amount)
      .toString(16)
      .padStart(2, "0");
  return `#${lift(n >> 16)}${lift((n >> 8) & 255)}${lift(n & 255)}`;
}
