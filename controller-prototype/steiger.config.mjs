import fsd from "@feature-sliced/steiger-plugin";
import { defineConfig } from "steiger";

// A prototype keeps one slice per screen and per ADR topic, so these two size rules do not apply.
export default defineConfig([...fsd.configs.recommended, { rules: { "fsd/insignificant-slice": "off", "fsd/excessive-slicing": "off" } }]);
