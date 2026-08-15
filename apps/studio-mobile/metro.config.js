const { getDefaultConfig } = require("expo/metro-config");
const path = require("node:path");
const fs = require("node:fs");

const projectRoot = __dirname;
const monorepoRoot = path.resolve(projectRoot, "../..");

const config = getDefaultConfig(projectRoot);

config.watchFolders = [monorepoRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(monorepoRoot, "node_modules"),
];
config.resolver.disableHierarchicalLookup = true;

/**
 * markdown-it (via react-native-markdown-display) needs entities@2 `lib/maps/*`.
 * Monorepo root may hoist entities@6 which dropped that path — pin resolution.
 */
const entitiesV2 = [
  path.resolve(projectRoot, "node_modules/entities"),
  path.resolve(monorepoRoot, "node_modules/entities"),
  path.resolve(
    monorepoRoot,
    "node_modules/markdown-it/node_modules/entities",
  ),
  path.resolve(
    monorepoRoot,
    "node_modules/react-native-markdown-display/node_modules/markdown-it/node_modules/entities",
  ),
].find((p) => fs.existsSync(path.join(p, "lib/maps/entities.json")));

if (entitiesV2) {
  config.resolver.extraNodeModules = {
    ...(config.resolver.extraNodeModules || {}),
    entities: entitiesV2,
  };
}

module.exports = config;
