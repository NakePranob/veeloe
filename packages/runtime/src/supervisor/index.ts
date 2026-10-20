import { publicKeyOf, toBase64url } from "@veeloe/protocol";
import { ConfigError, loadConfig } from "./config";
import { startHubLink } from "./hub-link/hub-link";
import { KeyFileError, loadOrCreateMachineKey } from "./trust/machine-key";

export function runSupervisor() {
  let config, secretKey;
  try {
    config = loadConfig();
    secretKey = loadOrCreateMachineKey(config.home);
  } catch (err) {
    if (err instanceof ConfigError || err instanceof KeyFileError) {
      console.error(`veeloe: ${err.message}`);
      process.exit(1);
    }
    throw err;
  }
  console.log(`veeloe supervisor, machine key ${toBase64url(publicKeyOf(secretKey))}`);
  startHubLink({ hubUrl: config.hubUrl, secretKey });
}
