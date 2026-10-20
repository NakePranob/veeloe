# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase. This repo is **single-context**: one glossary and one ADR folder for every part.

## Before exploring, read these

- **`CONTEXT.md`** at the repo root: the glossary. (The skills' templates call it `GLOSSARY.md`; here it is `CONTEXT.md`, the name `/grill-with-docs` and `/domain-modeling` write to.)
- **`docs/adr/`**: read the ADRs that touch the area you're about to work in.

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a refactor proposal, a hypothesis, a test name), use the term as defined in `CONTEXT.md`. Don't drift to the synonyms each term lists under _Avoid_.

If the concept you need isn't in the glossary yet, that's a signal: either you're inventing language the project doesn't use (reconsider) or there's a real gap (note it for `/domain-modeling`).

## Flag ADR conflicts

If your output contradicts an existing ADR, surface it explicitly rather than silently overriding:

> _Contradicts ADR-0007 (Hub in Go), but worth reopening because…_
