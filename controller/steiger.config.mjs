import fsd from "@feature-sliced/steiger-plugin";
import { defineConfig } from "steiger";

// Tests stand beside what they test, and may need what the public API leaves out.
export default defineConfig([...fsd.configs.recommended, { files: ["./src/**/*.test.ts"], rules: { "fsd/no-public-api-sidestep": "off" } }]);
