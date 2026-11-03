// ADR 0022: the worker is hexagonal — its core reaches IO only through ports —
// and supervisor and worker talk over ipc only, never by importing each other.
// src/main.ts is the one file that sees both: it picks the mode.
module.exports = {
  forbidden: [
    {
      name: "worker-core-not-to-adapters",
      severity: "error",
      from: { path: "^src/worker/core/" },
      to: { path: "^src/worker/adapters/" },
    },
    {
      name: "supervisor-not-to-worker",
      severity: "error",
      from: { path: "^src/supervisor/" },
      to: { path: "^src/worker/" },
    },
    {
      name: "worker-not-to-supervisor",
      severity: "error",
      from: { path: "^src/worker/" },
      to: { path: "^src/supervisor/" },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    tsPreCompilationDeps: true,
  },
};
