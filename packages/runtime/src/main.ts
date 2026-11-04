import { parseArgs } from "node:util";
import { runPairCommand, runProviderCommandLine, runSupervisor, runUnpairCommand } from "./supervisor";
import { runWorker } from "./worker";

// One binary, two modes (ADR 0020): `veeloe` is the supervisor, which starts
// each Agent's worker as `veeloe worker --agent <id>`.
const { positionals, values } = parseArgs({
  args: process.argv.slice(2),
  options: { agent: { type: "string" }, hub: { type: "string" }, name: { type: "string" }, url: { type: "string" } },
  allowPositionals: true,
});

if (positionals.length === 0) {
  runSupervisor();
} else if (positionals[0] === "pair" && positionals.length === 1) {
  runPairCommand(values.hub);
} else if (positionals[0] === "unpair" && positionals.length === 1) {
  runUnpairCommand();
} else if (positionals[0] === "provider" && positionals[1] === "add" && positionals.length === 2) {
  runProviderCommandLine({ action: "add", name: values.name, url: values.url });
} else if (positionals[0] === "provider" && positionals[1] === "list" && positionals.length === 2) {
  runProviderCommandLine({ action: "list" });
} else if (positionals[0] === "provider" && positionals[1] === "remove" && positionals.length === 3) {
  runProviderCommandLine({ action: "remove", name: positionals[2] });
} else if (positionals[0] === "worker" && positionals.length === 1 && values.agent) {
  runWorker(values.agent);
} else {
  console.error("usage: veeloe | veeloe pair [--hub <url>] | veeloe unpair | veeloe provider add --name <name> --url <url> | veeloe provider list | veeloe provider remove <name>");
  process.exit(2);
}
