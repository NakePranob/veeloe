This is the Veeloe Controller, the real app, and the only design source: there is no canvas or prototype to follow. A screen is built from `src/shared/ui` (its tokens in `theme.ts` and its pieces) and looks like the screens already built, the Agent page and the Task page first: white screen, grey cards with no shadow or border, ink pills, colour only for state and the Agent. Match the label, hint line, button order and control shape of the closest finished screen — a value that opens a picker in one row, not one row per option — and give every state the code has (loading, empty, error, offline, light and dark) its own look. A screen that invents its own layout or repeats a label down a list is wrong even if it works.

This is an Expo/React Native app for iPhone, iPad and Android only: no web (ADR 0077). A web and desktop Controller will be written again, with Tauri and Next.js, once the features settle. Prioritize mobile-first patterns, performance, and cross-platform compatibility.

## Expo has changed — do not trust your training data

Expo ships breaking changes every SDK release. APIs you remember are likely renamed, moved, or removed. Before writing any code that touches an Expo, EAS, or React Native API:

1. Read the major version of the `expo` package in `package.json`.
2. Fetch the matching versioned docs: `https://docs.expo.dev/versions/v<major>.0.0/`
3. For anything else, fetch https://docs.expo.dev/llms.txt — an index of all Expo docs with corrections to common LLM misconceptions. Follow its links to the specific page you need; never answer from memory.

## Commands

```bash
bunx expo install <package>  # ALWAYS use this to add a package: it resolves SDK-compatible versions
bunx expo run:ios            # a development build on the iOS Simulator
bunx eas-cli build --profile preview --platform ios      # an internal build to install on a phone
bunx eas-cli build --profile production --platform ios   # the App Store build (bumps the build number itself)
```

The Controller ships through EAS (ADR 0025), built by hand from the maintainer's machine: the profiles are in `eas.json`, and the Expo and Apple credentials stay in the maintainer's EAS account, never in git. A workflow that builds it in CI, with `EXPO_TOKEN` in a GitHub environment, comes later.

Native modules are in this build, so it does not run in Expo Go. `ios/` and `android/` are generated (Continuous Native Generation), so never edit them by hand: configure native behaviour in `app.json`.

## Structure

- Routes live in `app/`: every file is a screen and re-exports a page from `src/pages/`. `app.json` pins the router root to `./app`, so Expo never takes `src/app/` for routes.
- Everything else is Feature-Sliced Design under `src/` (ADR 0022), held by `scripts/check-structure.ts` with the rules in `.conventions/rules.json` (ADR 0070). A new slice is `/keel:add-unit`; changing one is `/keel:change-unit`. Import another slice only through its `index.ts`, a `shared` segment too.
- All data goes through the database on the device (ADR 0021): screens read with `useLiveQuery` and write with `database.write(topics, batch)`. Never fetch into a screen. A new migration is a new line at the end of `src/shared/db/migrations.ts`.
- A test that needs an entity's model mocks the entity's public API with `mock.module`, since that API also pulls in React Native. Give it a plain factory over a static import (`() => tasks`), not `() => import(...)`: two test files mocking the same module with async factories hang `bun test` when they run together.

## Words

Never write a sentence into a screen (ADR 0065):

- Each slice owns its words in `i18n/th.json` and `i18n/en.json`, exports them from its `index.ts`, and is added to `src/app/i18n/resources.ts`. A new screen writes both languages in the same change. No Thai in `.ts`/`.tsx` outside comments and tests (`words-from-i18n`, ADR 0074), and `check-i18n` fails on a key no code reads; drop a key with the code that used it.
- Read them with `useT("<slice>")`. Pass values as variables and never join sentences, because languages order words differently.
- Terms from `CONTEXT.md`, such as Agent, Task and Approval, stay in English in every language.
- A code from a Runtime or the Hub goes through `describeError`, with its words in `src/shared/i18n/errors/`. What an Agent wrote and names people gave are shown as received.

## UI

The design system (tokens, components, entities, widgets, dark mode) is the code itself: `src/shared/ui/theme.ts` and the pieces beside it. Add a piece there only when two screens need it.

- Navigation, headers, the back button, alerts and the menus a control opens are the platform's. Never rebuild them.
- Buttons, chips, cards and everything else on the page are ours, from `src/shared/ui`. No borders or divider lines: space and surface set things apart, and only what floats over content has a shadow. Each control keeps a pressed state, a role and a 44pt target: a link is `TextLink`, `Button` or `Row`, never `onPress` on `Text` (`links-are-pressables`, ADR 0074).
- Before writing or changing a screen, load the `expo-native-ui` and `expo-design-system` skills.
- Colours come from `src/shared/ui/theme.ts` only (`colour-from-shared-ui`, ADR 0072), and text size and weight from `Text`'s `variant` (`type-from-shared-ui`, ADR 0074): a missing one is a new `type` token. Icons are `Icon`; never emoji. Motion uses `motion` from the theme.
- No `as never` or `as unknown as` outside tests (`no-blind-casts`, ADR 0074): type it instead.
- Name the app a screen follows and match its structure.
- A screen is done once it has run on the iOS Simulator, on an iPhone and an iPad size, in light and dark and in both languages, with a screenshot of each; check Android too where it draws differently (the header button, sheets).
