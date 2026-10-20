# Veeloe

AI agents that run on your own machines, work together as a team across them,
and are controlled from anywhere.

This repository holds the two parts of Veeloe that run on, or talk to, your
machines:

- **Protocol** — the shared language that Controllers, Runtimes and Hubs use
  to talk: envelope and message shapes, signing, and sealed keys.
- **Runtime** — the program installed on each Machine. It hosts Agents, runs
  every command they make inside an OS sandbox, and keeps each Task's history
  on that Machine.

Status: pre-alpha. There is no code yet.

`CONTEXT.md` defines the terms used throughout (Workspace, Machine, Runtime,
Agent, Task, Flow, Delegation, ...).

## License

AGPL-3.0 — see `LICENSE`. Outside contributions need a signed CLA, which the
CLA Assistant asks for on your first pull request.
