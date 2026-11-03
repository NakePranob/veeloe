const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

// expo-sqlite runs on web as wa-sqlite (ADR 0021). The async API needs no
// COOP/COEP headers, so none are set.
config.resolver.assetExts.push("wasm");

module.exports = config;
