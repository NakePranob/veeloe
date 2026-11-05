import { parseArgs } from "node:util";
import { helpFor, USAGE } from "./help";
import { runPairCommand, runProviderCommandLine, runStatusCommand, runSupervisor, runUnpairCommand } from "./supervisor";
import { runWorker } from "./worker";

function fail(message: string): never {
  console.error(`veeloe: ${message}\n${USAGE}\nrun veeloe --help`);
  process.exit(2);
}

const argv = process.argv.slice(2);
// A key in an argument stays in shell history and in `ps`, so it is refused before anything else reads it.
if (argv.some((a) => /^--?(key|api-key|token)(=|$)/.test(a))) fail("a Provider key is never an argument. Type it when asked, or pipe it in: veeloe provider add ... < key.txt");

let parsed;
try {
  parsed = parseArgs({
    args: argv,
    options: { agent: { type: "string" }, hub: { type: "string" }, name: { type: "string" }, url: { type: "string" }, preset: { type: "string" }, yes: { type: "boolean" }, help: { type: "boolean", short: "h" } },
    allowPositionals: true,
  });
} catch (err) {
  fail((err as Error).message);
}
const { positionals: [command, sub, ...rest], values } = parsed;

// One binary, two modes (ADR 0020): `veeloe` is the supervisor, which starts
// each Agent's worker as `veeloe worker --agent <id>`.
if (values.help || command === "help") {
  const topic = command === "help" ? sub : command;
  const text = helpFor(topic);
  if (!text) fail(`no command ${topic}`);
  console.log(text);
} else if (command === undefined) {
  runSupervisor();
} else if (command === "pair" && !sub) {
  runPairCommand(values.hub);
} else if (command === "unpair" && !sub) {
  runUnpairCommand();
} else if (command === "status" && !sub) {
  runStatusCommand();
} else if (command === "provider" && sub === "add" && rest.length === 0) {
  runProviderCommandLine({ action: "add", name: values.name, url: values.url, preset: values.preset });
} else if (command === "provider" && sub === "list" && rest.length === 0) {
  runProviderCommandLine({ action: "list" });
} else if (command === "provider" && sub === "remove" && rest.length <= 1) {
  runProviderCommandLine({ action: "remove", name: rest[0], yes: values.yes });
} else if (command === "worker" && !sub && values.agent) {
  runWorker(values.agent);
} else {
  // Never the arguments themselves: a key pasted in the wrong place would be printed.
  fail(command === "provider" ? "not a provider command (a key is never an argument): see veeloe help provider" : helpFor(command) ? `wrong arguments for ${command}: see veeloe help ${command}` : `unknown command: ${command}`);
}
