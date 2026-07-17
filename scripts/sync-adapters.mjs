#!/usr/bin/env node

import {
  copyFileSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const canonicalSkill = resolve(repositoryRoot, "plugins/telic/skills/telic");
const canonicalBundle = resolve(
  repositoryRoot,
  "plugins/telic/dist/mcp/server.js",
);

const skillTargets = [
  "adapters/claude-code/telic/skills/telic",
  "adapters/antigravity/telic/skills/telic",
  "adapters/cursor/project/.cursor/skills/telic",
  "adapters/kiro/project/.kiro/skills/telic",
  "adapters/kiro-ide/project/.kiro/skills/telic",
  "adapters/cline/project/.cline/skills/telic",
  "adapters/roo-code/project/.roo/skills/telic",
];

const bundleTargets = [
  "adapters/claude-code/telic/dist/mcp/server.js",
  "adapters/antigravity/telic/dist/mcp/server.js",
  "adapters/cursor/project/.cursor/telic/dist/mcp/server.js",
  "adapters/kiro/project/.kiro/telic/dist/mcp/server.js",
  "adapters/kiro-ide/project/.kiro/telic/dist/mcp/server.js",
  "adapters/cline/project/.cline/telic/dist/mcp/server.js",
  "adapters/roo-code/project/.roo/telic/dist/mcp/server.js",
];

function copyFile(source, target) {
  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(source, target);
}

function syncSkill(relativeTarget) {
  const target = resolve(repositoryRoot, relativeTarget);
  rmSync(target, { force: true, recursive: true });
  copyFile(resolve(canonicalSkill, "SKILL.md"), resolve(target, "SKILL.md"));

  const references = resolve(canonicalSkill, "references");
  for (const entry of readdirSync(references).sort()) {
    const source = resolve(references, entry);
    if (statSync(source).isFile()) {
      copyFile(source, resolve(target, "references", entry));
    }
  }
}

for (const target of skillTargets) syncSkill(target);
for (const target of bundleTargets) {
  copyFile(canonicalBundle, resolve(repositoryRoot, target));
}

console.log(
  `Synchronized ${skillTargets.length} skills and ${bundleTargets.length} MCP bundles.`,
);
