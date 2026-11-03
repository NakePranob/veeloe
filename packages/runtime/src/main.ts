import { parseArgs } from "node:util";
import { runPairCommand, runSupervisor, runUnpairCommand } from "./supervisor";
import { runWorker } from "./worker";

// One binary, two modes (ADR 0020): `veeloe` is the supervisor, which starts
// each Agent's worker as `veeloe worker --agent <id>`.
const { positionals, values } = parseArgs({
  args: process.argv.slice(2),
  options: { agent: { type: "string" }, hub: { type: "string" } },
  allowPositionals: true,
});

if (positionals.length === 0) {
  runSupervisor();
} else if (positionals[0] === "pair" && positionals.length === 1) {
  runPairCommand(values.hub);
} else if (positionals[0] === "unpair" && positionals.length === 1) {
  runUnpairCommand();
} else if (positionals[0] === "worker" && positionals.length === 1 && values.agent) {
  runWorker(values.agent);
} else {
  console.error("usage: veeloe | veeloe pair [--hub <url>] | veeloe unpair | veeloe worker --agent <id>");
  process.exit(2);
}
