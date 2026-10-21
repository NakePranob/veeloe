---
version: 2
name: Veeloe Controller
description: A calm black-and-white tool where the only color belongs to each Agent's Character and to state. Organized by Agent, like a messaging app — an inbox of Agents, the open Task, and the Agent's details — for a product whose screens ask people to approve commands on real machines.

# Token names follow shadcn, so React Native Reusables components read them
# unchanged. They live in global.css as --color-<name>; change both together.
colors:
  # light mode; colors-dark below
  background: "#FFFFFF"           # the page, the Task stream
  foreground: "#0A0A0A"           # text
  sidebar: "#F7F7F8"              # the inbox column on wide screens, one step off the page
  sidebar-foreground: "#0A0A0A"
  sidebar-accent: "#EBEBEE"       # the selected Agent in the sidebar
  sidebar-border: "#ECECEE"
  card: "#FFFFFF"                 # floating surfaces: composer, sheets, a floating panel
  card-foreground: "#0A0A0A"
  popover: "#FFFFFF"
  popover-foreground: "#0A0A0A"
  primary: "#0A0A0A"              # the one strongest element: the decision on a screen
  primary-foreground: "#FFFFFF"
  secondary: "#F0F0F2"            # in-flow fills: the Approval card, a delegation, a status pill
  secondary-foreground: "#0A0A0A"
  muted: "#F0F0F2"
  muted-foreground: "#67676C"     # supporting text, timestamps, previews
  accent: "#EBEBEE"               # pressed and hovered
  accent-foreground: "#0A0A0A"
  border: "#ECECEE"               # hairlines
  input: "#E6E6E9"                # field borders
  ring: "#A1A1A6"                 # focus on the web
  me: "#0A0A0A"                   # the Member's own message bubble
  me-foreground: "#FFFFFF"
  waiting: "#A84B00"              # waiting on a person: an Approval, a queue
  waiting-soft: "#FFF4E5"
  destructive: "#D70015"          # Stop, errors, a denied Approval
  done: "#1E7A35"                 # a Turn or Task that finished well

colors-dark:
  background: "#0A0A0A"
  foreground: "#F5F5F7"
  sidebar: "#131314"
  sidebar-foreground: "#F5F5F7"
  sidebar-accent: "#2E2E30"
  sidebar-border: "#1F1F21"
  card: "#1C1C1E"
  card-foreground: "#F5F5F7"
  popover: "#1C1C1E"
  popover-foreground: "#F5F5F7"
  primary: "#F5F5F7"
  primary-foreground: "#0A0A0A"
  secondary: "#222224"
  secondary-foreground: "#F5F5F7"
  muted: "#222224"
  muted-foreground: "#A1A1A6"
  accent: "#2E2E30"
  accent-foreground: "#F5F5F7"
  border: "#1F1F21"
  input: "#2E2E30"
  ring: "#636366"
  me: "#5A5A5E"                   # a mid gray, not white: a white bubble glares on black
  me-foreground: "#FFFFFF"
  waiting: "#FF9F0A"
  waiting-soft: "#3A2200"
  destructive: "#FF6961"
  done: "#30D158"

characters:
  # each preset is its own shape and color, the same in both modes; the face
  # ink is the color mixed 80% toward black. None is the waiting amber, the
  # destructive red or the done green.
  egg:     "#7B5CF0"   # violet
  sprout:  "#0E9C8E"   # teal, with a leaf
  bear:    "#1E8BDA"   # sky, with ears
  pebble:  "#B07F3A"   # sand, wide and low
  bean:    "#4F63E8"   # indigo, tall
  ghost:   "#A94CC4"   # berry, wavy hem
  flower:  "#E0508E"   # pink, six petals
  gumdrop: "#5F7E9C"   # slate, flat base

typography:
  family-sans: Veeloe Sans   # Geist (Latin) + Anuphan (Thai), merged; the system font until it exists
  family-mono: Geist Mono    # Menlo on iOS and monospace on Android until then
  title:   { size: 24, lineHeight: 30, weight: 700 }
  heading: { size: 17, lineHeight: 24, weight: 600 }
  body:    { size: 16, lineHeight: 24, weight: 400 }
  body-sm: { size: 14, lineHeight: 20, weight: 400 }
  label:   { size: 14, lineHeight: 20, weight: 500 }
  caption: { size: 12, lineHeight: 16, weight: 400 }
  mono:    { size: 14, lineHeight: 20, weight: 400 }

rounded:
  # --radius is 12; the rest follow from it in global.css
  sm: 8      # small parts
  md: 10     # buttons, fields
  lg: 12     # code blocks, rows that stand alone
  xl: 16     # cards in the stream
  bubble: 20 # message bubbles, the Approval card
  full: 9999 # the composer, pills, avatars

spacing: [4, 8, 12, 16, 20, 24, 32, 40, 48]

motion:
  fast: 120ms   # press, toggle
  base: 200ms   # open the panel
  slow: 320ms   # sheets, screen changes
  easing: ease-out
---

# Veeloe Controller design

## Overview

Veeloe asks people to let AI agents run commands on their own machines and
to approve the ones that matter, sometimes from a phone, sometimes for a
deploy to production. The interface has to read as calm and exact: nothing
on screen should compete with the moment someone decides. So the chrome is
black and white, and color is spent on two things only:

- **the Character** — each Agent has one, its own shape in its own color,
  and it is the personality of the product;
- **state** — amber for waiting on a person, red for Stop and errors, green
  for done.

The app is **organized by Agent**, the way a messaging app is organized by
person. Home is an inbox with one row per Agent, and whoever needs you comes
first. Opening an Agent opens the Task that needs you, or its latest one.

There are **three layers of detail**, all from the same event log:

- **Layer 1, status:** the Character's Mood and one line under the Agent's
  name in the Task header. Enough for anyone.
- **Layer 2, steps:** what the Agent did and will do, one row per step, in
  the Agent panel (desktop) or the Agent's profile (phone).
- **Layer 3, raw log:** every event with full output, in mono, on its own
  screen. For whoever has to know exactly what ran.

## Colors

Tokens are in the front matter, named as in `global.css`, which Uniwind reads
and the Flow canvas (React Flow in a DOM component) imports too, so there is
one set for the whole app.

- **Primary is "the strongest contrast against the page"**: black in light
  mode, white in dark mode. It marks the single most important action on a
  screen, nothing else.
- **Neutrals step by tone**: the page is `background`, the sidebar one step
  toward gray, in-flow fills are `secondary`, pressed and selected are
  `accent`. Rows sit flat on the surface.
- **State colors never decorate.** Amber means a person is needed now; red
  means stopping, failure or refusal; green means it finished well. Amber has
  a `-soft` tint for its label background.
- **State is never color alone**: every state also has words ("Needs you",
  "Stopped") and, where there is room, an icon.
- **The Member's own message** is a `me` bubble: black in light mode, a mid
  gray in dark mode. White text holds 6.9:1 on it.
- **Character colors** are saturated mid-tones, the same in both modes, each
  at least 3.4:1 on white and on `#0A0A0A`, so a Character stands out on
  either page. A new Agent gets the next unused preset; the Owner can change
  it.
- Supporting text is `muted-foreground`. Never fade text with opacity.

## Typography

- **Veeloe Sans** is one font file per weight, built by merging Geist's Latin
  glyphs with Anuphan's Thai glyphs, scaled so the two sit at the same
  x-height. It exists because React Native takes a single `fontFamily` and
  falls back to the system's Thai font (Sukhumvit, Noto) for glyphs Geist
  lacks; on the web CSS could chain the two, but the app must look the same
  everywhere. Both fonts are OFL: the merged font carries the OFL and a name
  of its own. The build script lives with the app and runs once per update of
  either source font. Until it exists the app uses the system font.
- **Geist Mono** for commands, paths, logs and anything a person might copy.
  `global.css` sets `--font-mono` per platform, because neither phone has
  `ui-monospace`.
- Weights 400 (body), 500 (labels, buttons), 600 (names, headings) and 700
  (the Agent's name on its profile).
- **No letter-spacing, ever.** Thai and Latin share the same style, and
  tracking breaks Thai vowels and tone marks that stack on a consonant.
- Thai needs room above and below for its marks: body line height is 24 on
  16. Do not tighten it.
- Sentence case for every label and heading. No all caps.

## Layout

- **Mobile first.** Every screen works one-handed on a phone before it grows.
  Approving while away from a desk is why the app exists.
- **Compact (< 1024):** a native stack with no tab bar. The inbox is home
  (`/`); an Agent opens its Task (`/agents/<agent>/tasks/<task>`); tapping the
  Task header opens the Agent's profile (`/agents/<agent>`). Gutter 16.
- **Expanded (≥ 1024):** three panes — the inbox as a 320 sidebar, the open
  Task in the middle (content max 720), and the Agent panel at 340 on the
  right. Below 1280 the panel floats over the Task; it opens and closes from
  the Task header, and the URL keeps the choice (`?panel=1` or `0`).
- 4-point spacing (front matter).
- **Touch targets at least 44 × 44**, even where the visible control is
  smaller.
- Respect safe areas on every edge.

## Elevation and shape

- Flat. Surfaces are told apart by tone and 1px `border` hairlines.
- **Only floating things cast a shadow**, and only in light mode: the
  composer, sheets, menus, toasts and the panel when it floats. In dark mode
  nothing casts a shadow; a floating surface is `card`, a step lighter than
  the page, with a hairline.
- Never two floating layers at once; a third need is a new screen.
- Radius from the front matter.

## Components

Components live in `src/shared/ui` (FSD). Most come from **React Native
Reusables** (the Uniwind registry), copied in so the code is ours: each file
says in its first line where it came from and what we changed. They are
built on RN Primitives, a React Native port of Radix. Where the platform
already has the thing, use it instead:

- **Sheets and dialogs:** Expo Router's `formSheet` and modal presentation.
  They are the OS's own sheets on iOS and Android, and modals on the web.
- **Motion:** Reanimated.
- **The Character:** ours. Rive, whose state machine takes the Mood as
  inputs, once the Character is designed (#23); a still SVG until then.
- **Icons:** Lucide through the `Icon` component, 16–20px, colored like the
  text beside them.

### Buttons
- **Default:** `primary` fill, `primary-foreground` label. At most one per
  screen, and it is the decision.
- **Outline:** `border` and `background`; the other choices next to it.
- **Secondary:** `secondary` fill; for toggles that are on.
- **Ghost:** no fill or border; for icon buttons in headers.
- **Destructive:** Stop and Delete. A destructive action always asks once in
  a sheet that says what will happen (Stop lists the Tasks that stop with it).
- No shadow on any button: buttons sit in the page.
- Never disable a button silently: keep it pressable and say why it cannot
  act.

### Inbox (signature)
- Pinned Agents (up to three) show as big Characters in a row on top, with
  their name and a one-word state. One that needs you gets an amber ring and
  "Needs you" in amber.
- The rest are rows, flat on the surface, with no dividers: the Character at
  44, the name, the time, and one line — the latest message, or what the
  Agent is waiting for. A "Needs you" pill or an unread dot sits at the
  trailing edge. Whoever needs you comes first.
- An unread dot is `primary`, not a hue: color stays with the Character and
  state.

### Task header (signature)
- The Character at 36, the Agent's name, the Task's title, and one line of
  status with its dot (layer 1). On the phone it opens the profile; on wide
  screens it toggles the panel. While a Turn runs, a Stop button sits at the
  right.

### Task stream (signature)
- The Member's messages are `me` bubbles, flush right, 80% wide at most.
- The Agent's replies are plain text, flush left, with a caption-size name
  above whenever the speaker changes. They have no bubble: replies run long
  and carry code.
- A Delegation is a `secondary` card: the other Agent's Character, the
  sub-Task's title, where it runs, and its state. Tapping it opens the
  sub-Task, which links back to its parent.
- Code and commands sit in a block of Geist Mono. Long output never inlines;
  it links to layer 3.
- Text from a reply still being written appears as it streams; nothing jumps
  when the block completes.

### Approval card (signature)
- In the stream, as the latest item, with no shadow: a `secondary` card at
  `bubble` radius with an amber "Approval" label and its clock icon, when it
  expires, what the Agent wants to do in plain words, the exact command in a
  `background` block, and that no answer counts as denied.
- Actions on the phone: **Deny** (outline) and **Approve once** (default),
  side by side. **Always allow** adds to the Allowlist for good, so the phone
  leaves it to a computer or the Agent's settings, and says so under the
  buttons. On wide screens the card shows all three.
- After an answer the card collapses to one line in the stream: what was
  approved or denied.

### Composer
- A `card` pill with a hairline border, floating at the bottom with a light
  shadow (none in dark), and a round default send button.
- On an offline Machine the composer gives way to one line saying the Machine
  is offline and only cached history shows.

### Agent panel and profile
- The Character at 96, the name, where it runs, and its state in a
  `secondary` pill; then plain sections with no cards: this Task's steps
  (layer 2), the Agent's Tasks (the open one highlighted), its Machine and
  Egress, its Allowlist and Approval expiry, and its Flow lines.

### Fields
- 44 high or more, `md` radius, `input` border; on the web a `ring` focus
  ring. Errors in `destructive` below the field, in words.

## Motion

- Short and functional: things move to show where they came from or that
  something changed. Durations in the front matter.
- The Character is the one place for personality in motion.
- When the OS asks for reduced motion, movement becomes a crossfade and the
  Character holds a still pose for each Mood.

## Language and copy

- English and Thai from the first screen. Every string goes through the
  translation table in `src/shared/i18n`; none is written inline. The default
  follows the device; Settings can change it.
- Terms from `CONTEXT.md` (Agent, Task, Approval, Flow, Machine, Workspace,
  Member, Stop) stay as they are in both languages, so the app and the docs
  say the same thing. Actions are translated ("Approve once" / "อนุมัติครั้งนี้").
- Short, plain, warm. Say what happened and what to do next. Sentence case.
  No exclamation marks in system copy. Don't explain what the screen already
  shows.
- Write for both readers: the status line (layer 1) in everyday words, the
  steps (layer 2) in exact ones.

## Accessibility

- Text contrast at least 4.5:1 against its background, 3:1 for icons and
  borders that carry meaning. Every text color in the front matter meets
  4.5:1 on `background`, `sidebar`, `card`, `secondary` and `accent` in its
  own mode, and amber also on `waiting-soft`; check again whenever a value
  changes.
- Every icon-only control has an accessibility label; every state has words.
- Text scales with the OS setting up to 200% without clipping; layouts wrap
  instead.
- On the web: everything reachable by keyboard, with a visible `ring` focus
  ring.

## Do and don't

**Do**
- Keep one primary button per screen, and make it the decision.
- Spend color on the Character and on state, nowhere else.
- Show the exact command before anyone approves it.
- Let every layer of detail come from the same event log.

**Don't**
- Don't put the Agent's replies in bubbles.
- Don't use amber, red or green for decoration, or for a Character.
- Don't tell two Characters apart by color alone; each preset is its own shape.
- Don't add letter-spacing or tighten Thai line height.
- Don't put a shadow on anything in the page, or on anything in dark mode.
- Don't hard-code a string, a color or a size: use the tokens and the
  translation table.
