const { getDefaultConfig } = require("expo/metro-config");
const { withUniwindConfig } = require("uniwind/metro");

// withUniwindConfig has to stay the outermost wrapper.
module.exports = withUniwindConfig(getDefaultConfig(__dirname), {
  cssEntryFile: "./global.css",
  dtsFile: "./uniwind-types.d.ts",
});
