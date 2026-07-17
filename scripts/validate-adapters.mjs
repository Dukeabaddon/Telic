#!/usr/bin/env node

import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const native = process.argv.includes("--native");

const paths = {
  canonicalSkill: "plugins/telic/skills/telic",
  canonicalBundle: "plugins/telic/dist/mcp/server.js",
  claude: "adapters/claude-code/telic",
  antigravity: "adapters/antigravity/telic",
  cursor: "adapters/cursor/project/.cursor",
  kiro: "adapters/kiro/project/.kiro",
  kiroIde: "adapters/kiro-ide/project/.kiro",
  cline: "adapters/cline/project/.cline",
  roo: "adapters/roo-code/project/.roo",
};

const skillTargets = [
  `${paths.claude}/skills/telic`,
  `${paths.antigravity}/skills/telic`,
  `${paths.cursor}/skills/telic`,
  `${paths.kiro}/skills/telic`,
  `${paths.kiroIde}/skills/telic`,
  `${paths.cline}/skills/telic`,
  `${paths.roo}/skills/telic`,
];

const bundleTargets = [
  `${paths.claude}/dist/mcp/server.js`,
  `${paths.antigravity}/dist/mcp/server.js`,
  `${paths.cursor}/telic/dist/mcp/server.js`,
  `${paths.kiro}/telic/dist/mcp/server.js`,
  `${paths.kiroIde}/telic/dist/mcp/server.js`,
  `${paths.cline}/telic/dist/mcp/server.js`,
  `${paths.roo}/telic/dist/mcp/server.js`,
];

function fail(message) {
  throw new Error(`Adapter validation failed: ${message}`);
}

function absolute(relativePath) {
  return resolve(repositoryRoot, relativePath);
}

function text(relativePath) {
  const path = absolute(relativePath);
  if (!existsSync(path)) fail(`${relativePath} is missing`);
  return readFileSync(path, "utf8");
}

function json(relativePath) {
  try {
    return JSON.parse(text(relativePath));
  } catch (error) {
    fail(`${relativePath} is not valid JSON: ${error.message}`);
  }
}

function expectEqual(actual, expected, label) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    fail(`${label} does not match the supported preview contract`);
  }
}

function server(relativePath) {
  const configuration = json(relativePath);
  const definition = configuration?.mcpServers?.telic;
  if (!definition || definition.command !== "node") {
    fail(`${relativePath} must define the local telic Node.js server`);
  }
  if (
    !Array.isArray(definition.args) ||
    definition.args.length !== 1 ||
    !definition.args[0].endsWith("/dist/mcp/server.js")
  ) {
    fail(`${relativePath} must reference one bundled Telic server`);
  }
  return definition;
}

const canonicalSkillFiles = [
  "SKILL.md",
  ...readdirSync(absolute(`${paths.canonicalSkill}/references`))
    .filter((entry) => entry.endsWith(".md"))
    .sort()
    .map((entry) => `references/${entry}`),
];

for (const target of skillTargets) {
  for (const relativeFile of canonicalSkillFiles) {
    if (
      text(`${target}/${relativeFile}`) !==
      text(`${paths.canonicalSkill}/${relativeFile}`)
    ) {
      fail(`${target}/${relativeFile} is stale; run npm run bundle:adapters`);
    }
  }
}

const canonicalBundle = readFileSync(absolute(paths.canonicalBundle));
const canonicalHash = createHash("sha256")
  .update(canonicalBundle)
  .digest("hex");
for (const target of bundleTargets) {
  const path = absolute(target);
  if (!existsSync(path)) {
    fail(`${target} is missing; run npm run build`);
  }
  const hash = createHash("sha256").update(readFileSync(path)).digest("hex");
  if (hash !== canonicalHash) {
    fail(`${target} is stale; run npm run bundle:adapters`);
  }
}

const claudeManifest = json(`${paths.claude}/.claude-plugin/plugin.json`);
if (claudeManifest.name !== "telic") fail("Claude plugin name must be telic");
expectEqual(
  server(`${paths.claude}/.mcp.json`).args,
  ["${CLAUDE_PLUGIN_ROOT}/dist/mcp/server.js"],
  "Claude MCP path",
);

const antigravityManifest = json(`${paths.antigravity}/plugin.json`);
if (antigravityManifest.name !== "telic") {
  fail("Antigravity plugin name must be telic");
}
expectEqual(
  server(`${paths.antigravity}/mcp_config.json`).args,
  ["./dist/mcp/server.js"],
  "Antigravity MCP path",
);

expectEqual(
  server(`${paths.cursor}/mcp.json`).args,
  ["./.cursor/telic/dist/mcp/server.js"],
  "Cursor MCP path",
);

const kiro = json(`${paths.kiro}/agents/telic.json`);
if (kiro.name !== "telic" || !kiro.tools?.includes("*")) {
  fail("Kiro agent must expose the telic identity and host tools");
}
if (!Array.isArray(kiro.allowedTools) || kiro.allowedTools.length !== 0) {
  fail("Kiro adapter must not auto-approve host tools");
}
expectEqual(
  kiro.resources,
  ["skill://.kiro/skills/**/SKILL.md"],
  "Kiro skill resource",
);
expectEqual(
  kiro.mcpServers?.telic?.args,
  ["./.kiro/telic/dist/mcp/server.js"],
  "Kiro MCP path",
);

const kiroIdeConfiguration = json(`${paths.kiroIde}/settings/mcp.json`);
const kiroIdeServer = kiroIdeConfiguration?.mcpServers?.telic;
if (!kiroIdeServer || kiroIdeServer.command !== "node") {
  fail("Kiro IDE MCP config must define the local telic Node.js launcher");
}
expectEqual(
  kiroIdeServer.args,
  ["./.kiro/telic/launch.mjs"],
  "Kiro IDE MCP launcher path",
);
if (
  !Array.isArray(kiroIdeServer.autoApprove) ||
  kiroIdeServer.autoApprove.length !== 0
) {
  fail("Kiro IDE adapter must not auto-approve Telic tools");
}
const kiroIdeAgent = text(`${paths.kiroIde}/agents/telic.md`);
if (!kiroIdeAgent.startsWith("---\nname: telic\n")) {
  fail("Kiro IDE agent must expose the telic identity");
}
if (!kiroIdeAgent.includes('tools: [read, write, shell, "@telic"]')) {
  fail("Kiro IDE agent must limit itself to local host tools and Telic MCP");
}
if (/^permissions:/m.test(kiroIdeAgent)) {
  fail("Kiro IDE adapter must not auto-approve host permissions");
}
for (const instruction of [
  "telic_start_run",
  "telic_get_next_action",
  "telic_submit_artifact",
  "telic_list_runs",
  "telic_cancel_run",
  "body_json",
  "repositoryRoot",
]) {
  if (!kiroIdeAgent.includes(instruction)) {
    fail(`Kiro IDE agent is missing ${instruction} guidance`);
  }
}
if (
  !existsSync(absolute(`${paths.kiroIde}/telic/launch.mjs`)) ||
  !text(`${paths.kiroIde}/telic/launch.mjs`).includes(
    'process.env.TELIC_REPOSITORY_ROOT = resolve(overlayDirectory, "../..")',
  )
) {
  fail("Kiro IDE launcher must bind Telic to the overlay project root");
}

expectEqual(
  server(`${paths.cline}/mcp.json`).args,
  ["./.cline/telic/dist/mcp/server.js"],
  "Cline MCP path",
);

const rooServer = server(`${paths.roo}/mcp.json`);
expectEqual(
  rooServer.args,
  ["./.roo/telic/dist/mcp/server.js"],
  "Roo MCP path",
);
if (rooServer.alwaysAllow?.length !== 0 || rooServer.disabled !== false) {
  fail("Roo adapter must keep per-tool auto-approval disabled");
}
if (!text(`${paths.roo}/commands/telic.md`).includes("argument-hint")) {
  fail("Roo /telic command is missing its native command metadata");
}

const serializedAdapters = [
  ...skillTargets.map((target) => text(`${target}/SKILL.md`)),
  ...[
    `${paths.claude}/.mcp.json`,
    `${paths.antigravity}/mcp_config.json`,
    `${paths.cursor}/mcp.json`,
    `${paths.kiro}/agents/telic.json`,
    `${paths.kiroIde}/settings/mcp.json`,
    `${paths.kiroIde}/agents/telic.md`,
    `${paths.cline}/mcp.json`,
    `${paths.roo}/mcp.json`,
  ].map((path) => text(path)),
].join("\n");
if (
  /api[_-]?key|access[_-]?token|client[_-]?secret|password/i.test(
    serializedAdapters,
  )
) {
  fail("adapter paths unexpectedly contain credential-like names");
}

function runOptional(command, args, label) {
  const probe = spawnSync(command, ["--version"], { encoding: "utf8" });
  if (probe.error?.code === "ENOENT") {
    console.log(`Skipped ${label}: ${command} is not installed.`);
    return;
  }
  const result = spawnSync(command, args, {
    cwd: repositoryRoot,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    fail(
      `${label} failed: ${(result.stderr || result.stdout || "unknown error").trim()}`,
    );
  }
  const output = (result.stdout || result.stderr).trim();
  console.log(`${label} passed${output ? `: ${output}` : "."}`);
}

if (native) {
  runOptional(
    "agy",
    ["plugin", "validate", absolute(paths.antigravity)],
    "Antigravity plugin validation",
  );
  runOptional(
    "kiro-cli",
    [
      "agent",
      "validate",
      "--path",
      absolute(`${paths.kiro}/agents/telic.json`),
    ],
    "Kiro agent validation",
  );
}

console.log(
  `Adapter validation passed: ${skillTargets.length} host packs, bundle ${canonicalHash.slice(0, 12)}.`,
);
