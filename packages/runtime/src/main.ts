import { parseArgs } from "node:util";
import { runSupervisor } from "./supervisor";
import { runWorker } from "./worker";

// One binary, two modes (ADR 0020): `veeloe` is the supervisor, which starts
// each Agent's worker as `veeloe worker --agent <id>`.
const { positionals, values } = parseArgs({
  args: process.argv.slice(2),
  options: { agent: { type: "string" } },
  allowPositionals: true,
});

if (positionals.length === 0) {
  runSupervisor();
} else if (positionals[0] === "worker" && positionals.length === 1 && values.agent) {
  runWorker(values.agent);
} else {
  console.error("usage: veeloe | veeloe worker --agent <id>");
  process.exit(2);
}
