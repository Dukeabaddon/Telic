#!/usr/bin/env node

import { readFileSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";

const allowedInstallation = new Set([
  "NOT_AVAILABLE",
  "AVAILABLE",
  "INSTALLED_BY_DEFAULT",
]);
const allowedAuthentication = new Set(["ON_INSTALL", "ON_USE"]);

function fail(message) {
  throw new Error(`Marketplace validation failed: ${message}`);
}

function object(value, path) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail(`${path} must be an object`);
  }
  return value;
}

function nonEmptyString(value, path) {
  if (typeof value !== "string" || value.trim().length === 0) {
    fail(`${path} must be a non-empty string`);
  }
  return value;
}

const marketplacePath = resolve(
  process.argv[2] ?? ".agents/plugins/marketplace.json",
);
const marketplace = object(
  JSON.parse(readFileSync(marketplacePath, "utf8")),
  "$",
);
if (marketplace.name !== "dukeabaddon-telic") {
  fail("$.name must be the stable public marketplace id dukeabaddon-telic");
}
const marketplaceInterface = object(marketplace.interface, "$.interface");
if (marketplaceInterface.displayName !== "Telic") {
  fail("$.interface.displayName must be Telic");
}

if (!Array.isArray(marketplace.plugins)) {
  fail("$.plugins must be an array");
}

const names = new Set();
const repositoryRoot = dirname(dirname(dirname(marketplacePath)));
for (const [index, rawPlugin] of marketplace.plugins.entries()) {
  const path = `$.plugins[${index}]`;
  const plugin = object(rawPlugin, path);
  const name = nonEmptyString(plugin.name, `${path}.name`);
  if (names.has(name)) fail(`${path}.name duplicates ${name}`);
  names.add(name);

  const source = object(plugin.source, `${path}.source`);
  if (source.source !== "local") fail(`${path}.source.source must be local`);
  const sourcePath = nonEmptyString(source.path, `${path}.source.path`);
  if (!/^\.\/plugins\/[a-z0-9]+(?:-[a-z0-9]+)*$/.test(sourcePath)) {
    fail(`${path}.source.path must be ./plugins/<normalized-plugin-name>`);
  }
  if (sourcePath !== `./plugins/${name}`) {
    fail(`${path}.source.path must end with its plugin name`);
  }

  const policy = object(plugin.policy, `${path}.policy`);
  if (!allowedInstallation.has(policy.installation)) {
    fail(`${path}.policy.installation is unsupported`);
  }
  if (!allowedAuthentication.has(policy.authentication)) {
    fail(`${path}.policy.authentication is unsupported`);
  }
  nonEmptyString(plugin.category, `${path}.category`);

  const pluginRoot = resolve(repositoryRoot, sourcePath);
  if (!statSync(pluginRoot).isDirectory()) {
    fail(`${path}.source.path does not resolve to a plugin directory`);
  }
  const manifest = object(
    JSON.parse(
      readFileSync(resolve(pluginRoot, ".codex-plugin/plugin.json"), "utf8"),
    ),
    `${path}.manifest`,
  );
  if (manifest.name !== name) {
    fail(`${path}.name must match its plugin manifest name`);
  }
}

console.log(`Marketplace validation passed: ${marketplacePath}`);
