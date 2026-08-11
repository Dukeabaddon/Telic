#!/usr/bin/env node

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const canonicalSkill = resolve(repositoryRoot, "plugins/telic/skills/telic");
const canonicalBundle = resolve(
  repositoryRoot,
  "plugins/telic/dist/mcp/server.js",
);
const canonicalHook = resolve(
  repositoryRoot,
  "plugins/telic/hooks/broker-gate.mjs",
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

const hookTargets = [
  {
    hook: "adapters/cursor/project/.cursor/hooks/broker-gate.mjs",
    config: "adapters/cursor/project/.cursor/hooks.json",
    prefix: ".cursor/hooks",
  },
  {
    hook: "adapters/cline/project/.cline/hooks/broker-gate.mjs",
    config: "adapters/cline/project/.cline/hooks.json",
    prefix: ".cline/hooks",
  },
  {
    hook: "adapters/roo-code/project/.roo/hooks/broker-gate.mjs",
    config: "adapters/roo-code/project/.roo/hooks.json",
    prefix: ".roo/hooks",
  },
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

  const agents = resolve(canonicalSkill, "agents");
  if (existsSync(agents)) {
    for (const entry of readdirSync(agents).sort()) {
      const source = resolve(agents, entry);
      if (statSync(source).isFile()) {
        copyFile(source, resolve(target, "agents", entry));
      }
    }
  }
}

function hooksJson(prefix) {
  return JSON.stringify(
    {
      version: 1,
      hooks: {
        preToolUse: [
          {
            command: `${prefix}/broker-gate.mjs`,
            matcher: "Write|StrReplace|Delete|Shell|ApplyPatch|EditNotebook",
          },
        ],
        beforeShellExecution: [{ command: `${prefix}/broker-gate.mjs` }],
      },
    },
    null,
    2,
  );
}

for (const target of skillTargets) syncSkill(target);
for (const target of bundleTargets) {
  copyFile(canonicalBundle, resolve(repositoryRoot, target));
}
for (const target of hookTargets) {
  copyFile(canonicalHook, resolve(repositoryRoot, target.hook));
  writeFileSync(
    resolve(repositoryRoot, target.config),
    `${hooksJson(target.prefix)}\n`,
  );
}

console.log(
  `Synchronized ${skillTargets.length} skills, ${bundleTargets.length} MCP bundles, and ${hookTargets.length} broker hooks.`,
);
