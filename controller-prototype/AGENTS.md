**This is a throwaway prototype** of the Controller, running on Demo Workspace fixture data (see `README.md`). Do not build product features here; the real Controller starts fresh in `controller/`.

This is an Expo/React Native mobile application. Prioritize mobile-first patterns, performance, and cross-platform compatibility.

## Expo has changed — do not trust your training data

Expo ships breaking changes every SDK release. APIs you remember are likely renamed, moved, or removed. Before writing any code that touches an Expo, EAS, or React Native API:

1. Read the major version of the `expo` package in `package.json`.
2. Fetch the matching versioned docs: `https://docs.expo.dev/versions/v<major>.0.0/`
3. For anything else, fetch https://docs.expo.dev/llms.txt — an index of all Expo docs with corrections to common LLM misconceptions. Follow its links to the specific page you need; never answer from memory.

## Commands

Use `bunx` instead of `npx` if the project uses bun (`bun.lock` present).

```bash
npx expo install <package>  # ALWAYS use instead of npm/yarn/pnpm/bun add — resolves SDK-compatible versions
npx expo start              # start the dev server
npx expo lint               # lint
npx tsc --noEmit            # typecheck
npx expo-doctor             # diagnose dependency and config issues
npx expo install --fix      # fix incompatible package versions
```

Run lint and typecheck before declaring any task done.

## Navigation & Routing

- Use **Expo Router** for all navigation. Routes live in `app/` at the root of this package — every file there is a screen, `_layout.tsx` files define navigators. A route file stays thin: it re-exports a page from `src/pages/`.
- Everything else is laid out with **Feature-Sliced Design** under `src/` (app, pages, widgets, features, entities, shared — ADR 0022), checked by Steiger (`bun run check:prototype` from the repo root). `src/app/` is the FSD app layer, not routes: `app.json` pins the router root to `./app` so Expo never takes `src/app/` for routes.
- Import `Link`, `router`, and `useLocalSearchParams` from `expo-router`.
- Docs: https://docs.expo.dev/router/introduction.md

## UI

Veeloe's brand is monochrome with a cool, faintly blue cast, the same on every
platform; the platform's
own patterns carry the structure. The design system (tokens, components,
widgets, guidelines) is the reference: https://claude.ai/artifact/FLFrmUHanU1rdq7qF6bR8R

- Navigation, headers, the back button, alerts and the menus a control opens
  are the platform's: Apple's Human Interface Guidelines on iOS, Material 3 on
  Android. Never rebuild them.
- Buttons, chips, cards, bubbles and everything else on the page are ours,
  from `src/shared/ui` (`Button`, `Card`, `Text`, `Icon`, `Label`): pills for
  buttons and chips, one ink `primary` pill per view, white cards lifted off
  the light-grey screen by a soft shadow, headings at medium weight. No borders
  or divider lines: space, surface and shadow set things apart. Each keeps a pressed state, a role and a 44pt
  target.
- Before writing or changing a screen, load the `expo-native-ui` and
  `expo-design-system` skills.
- Colours come from `src/shared/ui/theme.ts` only: ink on a light blue-grey,
  white on a blue-tinted near-black, cool greys; hues are state, on icons. Never a hex value in a
  screen. Icons are `Icon` (SF Symbol on iOS, Material on Android and web);
  never emoji. Motion uses `motion` from the theme: short and eased out.
- A component is the smallest piece of UI with one job (`Text`, `Icon`,
  `Label`, `Button`, `Card`, `Character`, `TaskStatus`); a widget composes
  components into one part of a screen (the Approval card, the composer, the
  inbox). Change one in the design system and the code together.
- Name the app a screen follows (Mail for the inbox, Messages for a Task) and
  match its structure.
- A screen is done once it has run on the iOS Simulator and on web, in light
  and dark, with a screenshot of each. Checking on web alone is not enough,
  because web draws the header differently.

## Building with EAS

Use EAS to build, sign, and submit the app in the cloud (`eas build`, `eas submit`) and to ship over-the-air updates (`eas update`) — no local Xcode or Android Studio required. Run EAS CLI as `bunx eas-cli <command>` in Bun projects, or `npx eas-cli@latest <command>` otherwise; substitute that for bare `eas` in docs examples.
Docs: https://docs.expo.dev/eas/index.md

## Rules

- If `ios/` and `android/` directories do not exist, they are generated (Continuous Native Generation). Never create or edit them by hand — configure native behavior in `app.json` and config plugins.
- Expo Go only includes its bundled native modules. After adding a library with native code, the app needs a development build: `npx expo run:ios|android` locally, or `eas build --profile development`.
- Prefer recommended Expo modules over third-party libraries, and check your available skills before adding dependencies. Docs: https://docs.expo.dev/versions/latest/index.md
