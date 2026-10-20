---
version: 1
name: Veeloe Controller
description: A calm black-and-white tool where the only color belongs to each Agent's Character and to state. Inspired by how Meta's Muse puts an animated agent at the top of the screen, drops chat bubbles, and shows its work in three layers of detail — for a product whose screens ask people to approve commands on real machines.

colors:
  # light mode; colors-dark below flips them
  canvas: "#FAFAFA"          # page
  surface: "#FFFFFF"         # cards, sheets
  surface-sunken: "#F4F4F5"  # code, inset regions
  primary: "#0A0A0A"         # the one strongest element: primary button, key text
  on-primary: "#FFFFFF"
  text: "#0A0A0A"
  text-secondary: "#52525B"
  text-muted: "#71717A"
  hairline: "#E7E7EA"
  hairline-strong: "#D4D4D8"
  waiting: "#B45309"         # waiting on a person: an Approval, a queue
  waiting-soft: "#FEF3C7"
  danger: "#B91C1C"          # Stop, errors, a denied Approval
  danger-soft: "#FEE2E2"
  done: "#15803D"            # a Turn or Task that finished well
  done-soft: "#DCFCE7"

colors-dark:
  canvas: "#0A0A0A"
  surface: "#141414"
  surface-sunken: "#1C1C1E"
  primary: "#FAFAFA"
  on-primary: "#0A0A0A"
  text: "#FAFAFA"
  text-secondary: "#A1A1AA"
  text-muted: "#8B8B94"
  hairline: "#262629"
  hairline-strong: "#3A3A3F"
  waiting: "#FBBF24"
  waiting-soft: "#3A2A07"
  danger: "#F87171"
  danger-soft: "#3B1212"
  done: "#4ADE80"
  done-soft: "#0F2E1B"

character-colors:
  # one per Agent, same in both modes; none of them is a state hue
  violet: { fill: "#C9C2F8", ink: "#3C3489" }
  indigo: { fill: "#B9C6F5", ink: "#24357A" }
  sky:    { fill: "#B5DDF4", ink: "#0C447C" }
  teal:   { fill: "#A8E3CF", ink: "#085041" }
  pink:   { fill: "#F4C0D1", ink: "#72243E" }
  sand:   { fill: "#E8DCC4", ink: "#5A4720" }

typography:
  family-sans: Veeloe Sans   # Geist (Latin) + Anuphan (Thai), merged — see Typography
  family-mono: Geist Mono
  title:   { size: 28, lineHeight: 36, weight: 600 }
  heading: { size: 20, lineHeight: 28, weight: 600 }
  body:    { size: 16, lineHeight: 26, weight: 400 }
  body-sm: { size: 14, lineHeight: 22, weight: 400 }
  label:   { size: 14, lineHeight: 20, weight: 500 }
  caption: { size: 12, lineHeight: 18, weight: 400 }
  mono:    { size: 13, lineHeight: 20, weight: 400 }

rounded:
  sm: 8      # chips, inputs' inner parts
  md: 12     # rows that stand alone, code blocks
  lg: 16     # cards
  xl: 24     # sheets
  full: 9999 # buttons, avatars

spacing: [4, 8, 12, 16, 20, 24, 32, 40, 48]

motion:
  fast: 120ms   # press, toggle
  base: 200ms   # expand a status layer
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

- **the Character** — each Agent has one, in its own color, and it is the
  personality of the product;
- **state** — amber for waiting on a person, red for Stop and errors, green
  for done.

Three ideas come from Meta's Muse:

1. **The Character sits at the top of a Task**, as its status, not as a small
   avatar beside messages. It types while the Agent works, raises a hand while
   it waits for an Approval, and cheers when the Task is done (its Mood).
2. **No chat bubbles.** A Task reads like a document: plain text blocks, each
   with a quiet speaker label.
3. **Three layers of detail**, all from the same event log:
   - **Layer 1, Mood:** the Character and one line of status. Enough for
     anyone.
   - **Layer 2, steps:** a collapsible list of what the Agent did — each tool
     call as one row (icon, verb, target, duration).
   - **Layer 3, raw log:** every event with full output, in mono, on its own
     screen. For whoever has to know exactly what ran.

Shapes are soft and spacing is generous, like Muse: pill buttons, 16px cards,
16px body text. It should feel friendly to a team lead approving from a phone
and still exact to the SRE reading the raw log.

## Colors

Tokens are in the front matter. They live as CSS variables in the app's
`global.css`, which Uniwind reads, and the Flow canvas (React Flow in a DOM
component) imports the same file, so there is one set for the whole app.

- **Primary is "the strongest contrast against the page"**: black in light
  mode, white in dark mode. It marks the single most important action on a
  screen, nothing else.
- **State colors never decorate.** Amber means a person is needed now; red
  means stopping, failure or refusal; green means it finished well. Each
  comes with its `-soft` tint for backgrounds, with the strong color for text
  and icons on top.
- **State is never color alone**: every state also has an icon and words
  ("Waiting for you", "Stopped"), for color-blind users and screen readers.
- **Character colors** are pastel fills with a deep ink for the face and line
  work, the same in both modes. None of them is amber, red or green, so a
  Character can never be mistaken for a state. A new Agent gets the next
  unused color; the Owner can change it.
- Text on the canvas is `text`; supporting copy is `text-secondary`;
  `text-muted` is only for placeholders, timestamps and metadata. Never fade
  text with opacity.

## Typography

- **Veeloe Sans** is one font file per weight, built by merging Geist's Latin
  glyphs with Anuphan's Thai glyphs, scaled so the two sit at the same
  x-height. It exists because React Native takes a single `fontFamily` and
  falls back to the system's Thai font (Sukhumvit, Noto) for glyphs Geist
  lacks; on the web CSS could chain the two, but the app must look the same
  everywhere. Both fonts are OFL: the merged font carries the OFL and a name
  of its own. The build script lives with the app and runs once per update of
  either source font.
- **Geist Mono** for commands, paths, logs and anything a person might copy.
  Thai inside mono text falls back to Veeloe Sans.
- Weights 400 (body), 500 (labels, buttons) and 600 (titles, headings).
- **No letter-spacing, ever.** Thai and Latin share the same style, and
  tracking breaks Thai vowels and tone marks that stack on a consonant.
- Thai needs room above and below for its marks: body line height is 26 on
  16. Do not tighten it.
- Sentence case for every label and heading. No all caps.

## Layout

- **Mobile first.** Every screen works one-handed on a phone before it grows.
  Approving while away from a desk is why the app exists.
- Breakpoints by window width:
  - **compact (< 600):** one column, 16 gutter, tab bar at the bottom.
  - **medium (600–1023):** one column, 24 gutter, content max 720.
  - **expanded (≥ 1024):** a 320 sidebar (Machines, Agents, Tasks) beside the
    Task. The Flow canvas takes the full width.
- 4-point spacing (front matter). Screen gutter 16 on phones.
- **Touch targets at least 44 × 44**, even where the visible control is
  smaller.
- Respect safe areas on every edge.

## Elevation and shape

- Flat. Surfaces are told apart by tone (`canvas`, `surface`,
  `surface-sunken`) and 1px `hairline` borders, not by shadows.
- Only floating things cast a shadow: sheets, menus and toasts, one soft
  shadow each. Never two floating layers at once; a third need is a new
  screen.
- Radius from the front matter: buttons and avatars `full`, cards `lg`,
  sheets `xl`, code blocks `md`.

## Components

Every component is ours, written with Uniwind in `src/shared/ui` (FSD). Where
the platform already has the thing, use it instead of drawing it:

- **Sheets and dialogs:** Expo Router's `formSheet` and modal presentation.
  They are the OS's own sheets on iOS and Android, and modals on the web.
- **Motion:** Reanimated.
- **The Character:** Rive, whose state machine takes the Mood as inputs (to
  be confirmed with the Character's design, #23).
- **Icons:** Lucide, 20px in rows and buttons, stroke 1.75, colored like the
  text beside them.

### Buttons
- **Primary:** pill, `primary` fill, `on-primary` label, height 48 (40 when
  compact rows need it). At most one per screen.
- **Secondary:** pill, `surface` fill, `hairline-strong` border, `text` label.
- **Ghost:** no fill or border; for low-weight actions in rows and headers.
- **Danger:** pill, `danger` border and label, no fill. Stop and Delete use
  it. A destructive action always asks once in a sheet that says what will
  happen (Stop lists the Tasks that stop with it).
- Pressed: scale to 0.97 over `fast`. Never disable a button silently: keep
  it pressable and say why it cannot act.

### Character header (signature)
Top of every Task: the Character (64 on phones), the Agent's name, its
Machine, and one line of status (layer 1). While a Turn runs, a Stop button
sits at the right. Tapping the status line opens layer 2.

### Task stream (signature)
- Text blocks, no bubbles. Each block starts with a caption-size speaker
  label: the Member's name, or the Agent's name in its Character ink.
- The Member's own messages sit flush right in `text-secondary`; the Agent's
  sit flush left in `text`.
- Tool activity collapses into one step row per call (layer 2). Long output
  never inlines; it links to layer 3.
- Code and commands in a `surface-sunken` block, Geist Mono, `md` radius,
  with a copy action.
- Text from a reply still being written appears as it streams; nothing jumps
  when the block completes.

### Approval card (signature)
- `surface` card, `lg` radius, 1px `waiting` border.
- An amber "Waiting for you" label with its icon, then what the Agent wants
  to do in plain words, then the exact command in a code block, then when it
  expires ("Expires in 58 min").
- Actions: **Deny** (secondary) and **Approve** (primary), side by side,
  Approve on the right. The Character above raises its hand.
- After an answer the card stays in the stream, collapsed to one line: who
  answered, what, and when.

### Inputs
- The composer: `surface` field, `xl` radius, grows to 6 lines, send button
  as a round primary icon button.
- Text fields: 48 high, `md` radius, `hairline-strong` border, `primary`
  2px border when focused. Errors in `danger` below the field, in words.

### Lists and rows
- Rows are 56–64 high with a 1px `hairline` between them, not cards with
  gaps. A row leads with the Character or an icon, then a title, then one
  line of secondary text, with state at the trailing edge.

### Badges
- State only: `-soft` fill, strong text, `full` radius, caption size, with an
  icon.

## Motion

- Short and functional: things move to show where they came from or that
  something changed. Durations in the front matter.
- The Character is the one place for personality in motion.
- When the OS asks for reduced motion, movement becomes a crossfade and the
  Character holds a still pose for each Mood.

## Language and copy

- English and Thai from the first screen. Every string goes through the
  translation table; none is written inline. The default follows the device;
  Settings can change it.
- Terms from `CONTEXT.md` (Agent, Task, Approval, Flow, Machine, Workspace,
  Member, Stop) stay as they are in both languages, so the app and the docs
  say the same thing. Actions are translated ("Approve" / "อนุมัติ").
- Short, plain, warm. Say what happened and what to do next. Sentence case.
  No exclamation marks in system copy.
- Write for both readers: the status line (layer 1) in everyday words, the
  steps (layer 2) in exact ones.

## Accessibility

- Text contrast at least 4.5:1 against its background, 3:1 for icons and
  borders that carry meaning. Every text token in the front matter meets
  4.5:1 on `canvas`, `surface` and its own `-soft` tint, in both modes; check
  again whenever a value changes.
- Every icon-only control has an accessibility label; every state has words.
- Text scales with the OS setting up to 200% without clipping; layouts wrap
  instead.
- On the web: everything reachable by keyboard, with a visible 2px `primary`
  focus ring offset by 2.

## Do and don't

**Do**
- Keep one primary button per screen, and make it the decision.
- Spend color on the Character and on state, nowhere else.
- Show the exact command before anyone approves it.
- Let every layer of detail come from the same event log.

**Don't**
- Don't put chat bubbles in a Task.
- Don't use amber, red or green for decoration, or for a Character.
- Don't add letter-spacing or tighten Thai line height.
- Don't use shadows on in-flow cards.
- Don't hard-code a string, a color or a size: use the tokens and the
  translation table.
