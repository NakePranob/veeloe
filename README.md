# Veeloe

AI agents that run on your own machines, work together as a team across them,
and are controlled from anywhere.

This repository holds all of Veeloe:

- **Protocol** — the shared language that Controllers, Runtimes and Hubs use
  to talk: envelope and message shapes, signing, and sealed keys.
- **Runtime** — the program installed on each Machine. It hosts Agents, runs
  every command they make inside an OS sandbox, and keeps each Task's history
  on that Machine.
- **Hub** — the relay between Controllers and Runtimes. It checks that work
  only flows along the lines drawn in the Flow, and stores no Task content.
- **Controller** — the mobile and web app. Every command it sends is signed by
  the Member's own key.

Status: pre-alpha. There is no code yet. The Hub's code will live here, but
self-hosting it is not supported yet.

`CONTEXT.md` defines the terms used throughout (Workspace, Machine, Runtime,
Agent, Task, Flow, Delegation, ...). `docs/adr/` records the design decisions
and why they were made.

## License

AGPL-3.0 — see `LICENSE`. Outside contributions need a signed CLA, which the
CLA Assistant asks for on your first pull request.
