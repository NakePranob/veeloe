This is the Veeloe Controller, the real app. `../controller-prototype/` is a throwaway on Demo data: look at it for how a screen should feel, but do not build on it.

This is an Expo/React Native mobile application. Prioritize mobile-first patterns, performance, and cross-platform compatibility.

## Expo has changed — do not trust your training data

Expo ships breaking changes every SDK release. APIs you remember are likely renamed, moved, or removed. Before writing any code that touches an Expo, EAS, or React Native API:

1. Read the major version of the `expo` package in `package.json`.
2. Fetch the matching versioned docs: `https://docs.expo.dev/versions/v<major>.0.0/`
3. For anything else, fetch https://docs.expo.dev/llms.txt — an index of all Expo docs with corrections to common LLM misconceptions. Follow its links to the specific page you need; never answer from memory.

## Commands

```bash
bunx expo install <package>  # ALWAYS use this to add a package: it resolves SDK-compatible versions
bunx expo start --web        # web
bunx expo run:ios            # a development build on the iOS Simulator
```

The Expo and React Native versions match `controller-prototype` exactly: the workspace hoists one copy of each. Upgrade the two together.

Native modules are in this build, so it does not run in Expo Go. `ios/` and `android/` are generated (Continuous Native Generation), so never edit them by hand: configure native behaviour in `app.json`.

## Structure

- Routes live in `app/`: every file is a screen and re-exports a page from `src/pages/`. `app.json` pins the router root to `./app`, so Expo never takes `src/app/` for routes.
- Everything else is Feature-Sliced Design under `src/` (ADR 0022), checked by Steiger. Steiger does not see `export … from`, so never re-export from a higher layer or a sibling slice.
- All data goes through the database on the device (ADR 0021): screens read with `useLiveQuery` and write with `database.write(topics, batch)`. Never fetch into a screen. A new migration is a new line at the end of `src/shared/db/migrations.ts`.

## Words

Never write a sentence into a screen (ADR 0065):

- Each slice owns its words in `i18n/th.json` and `i18n/en.json`, exports them from its `index.ts`, and is added to `src/app/i18n/resources.ts`. A new screen writes both languages in the same change.
- Read them with `useT("<slice>")`. Pass values as variables and never join sentences, because languages order words differently.
- Terms from `CONTEXT.md`, such as Agent, Task and Approval, stay in English in every language.
- A code from a Runtime or the Hub goes through `describeError`, with its words in `src/shared/i18n/errors/`. What an Agent wrote and names people gave are shown as received.

## UI

The design system (tokens, components, widgets, guidelines) is the reference: https://claude.ai/artifact/FLFrmUHanU1rdq7qF6bR8R. Change one in the design system and the code together.

- Navigation, headers, the back button, alerts and the menus a control opens are the platform's. Never rebuild them.
- Buttons, chips, cards and everything else on the page are ours, from `src/shared/ui`. No borders or divider lines: space, surface and shadow set things apart. Each control keeps a pressed state, a role and a 44pt target.
- Before writing or changing a screen, load the `expo-native-ui` and `expo-design-system` skills.
- Colours come from `src/shared/ui/theme.ts` only. Icons are `Icon`; never emoji. Motion uses `motion` from the theme.
- Name the app a screen follows and match its structure.
- A screen is done once it has run on the iOS Simulator and on web, in light and dark and in both languages, with a screenshot of each. Checking on web alone is not enough, because web draws the header differently.
