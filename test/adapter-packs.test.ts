import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  getDefaultEnvironment,
  StdioClientTransport,
} from "@modelcontextprotocol/sdk/client/stdio.js";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("../", import.meta.url));
const canonicalSkill = join(root, "plugins/telic/skills/telic");

const skillTargets = [
  "adapters/claude-code/telic/skills/telic",
  "adapters/antigravity/telic/skills/telic",
  "adapters/cursor/project/.cursor/skills/telic",
  "adapters/kiro/project/.kiro/skills/telic",
  "adapters/cline/project/.cline/skills/telic",
  "adapters/roo-code/project/.roo/skills/telic",
];

const expectedTools = [
  "telic_get_artifact",
  "telic_get_next_action",
  "telic_get_run",
  "telic_get_trace",
  "telic_ground_context",
  "telic_start_run",
  "telic_submit_artifact",
];

interface LaunchConfiguration {
  readonly host: string;
  readonly cwd: string;
  readonly command: string;
  readonly args: readonly string[];
}

function read(path: string): string {
  return readFileSync(join(root, path), "utf8");
}

function parse(path: string): any {
  return JSON.parse(read(path));
}

function launch(
  host: string,
  rootPath: string,
  configurationPath: string,
  pluginRootVariable?: string,
): LaunchConfiguration {
  const cwd = join(root, rootPath);
  const configuration = parse(configurationPath).mcpServers.telic;
  return {
    host,
    cwd,
    command: configuration.command,
    args: configuration.args.map((argument: string) =>
      pluginRootVariable
        ? argument.replaceAll(pluginRootVariable, cwd)
        : argument,
    ),
  };
}

const launchConfigurations: readonly LaunchConfiguration[] = [
  launch(
    "Claude Code",
    "adapters/claude-code/telic",
    "adapters/claude-code/telic/.mcp.json",
    "${CLAUDE_PLUGIN_ROOT}",
  ),
  launch(
    "Antigravity preview cwd",
    "adapters/antigravity/telic",
    "adapters/antigravity/telic/mcp_config.json",
  ),
  launch(
    "Cursor",
    "adapters/cursor/project",
    "adapters/cursor/project/.cursor/mcp.json",
  ),
  {
    host: "Kiro CLI",
    cwd: join(root, "adapters/kiro/project"),
    ...parse("adapters/kiro/project/.kiro/agents/telic.json").mcpServers.telic,
  },
  launch(
    "Cline",
    "adapters/cline/project",
    "adapters/cline/project/.cline/mcp.json",
  ),
  launch(
    "Roo Code",
    "adapters/roo-code/project",
    "adapters/roo-code/project/.roo/mcp.json",
  ),
];

describe("source-preview host adapters", () => {
  it("keeps every host skill synchronized with the canonical workflow", () => {
    const files = [
      "SKILL.md",
      ...readdirSync(join(canonicalSkill, "references"))
        .filter((entry) => entry.endsWith(".md"))
        .sort()
        .map((entry) => `references/${entry}`),
    ];

    for (const target of skillTargets) {
      for (const file of files) {
        expect(read(`${target}/${file}`)).toBe(
          read(`plugins/telic/skills/telic/${file}`),
        );
      }
    }
  });

  it("describes the current controller as serial-only", () => {
    const toolUsage = read(
      "plugins/telic/skills/telic/references/tool-usage.md",
    );
    const contracts = read(
      "plugins/telic/skills/telic/references/artifact-contracts.md",
    );
    expect(toolUsage).toMatch(/one WorkPlan\s+node at a time/u);
    expect(toolUsage).not.toContain("Parallelize only independent WorkPlan");
    expect(contracts).toContain("serial execution mode");
    expect(contracts).not.toContain("serial/parallel/mixed mode");
  });

  it("uses universal human intent with host-native activation fallbacks", () => {
    const skill = read("plugins/telic/skills/telic/SKILL.md");
    const publicReadme = read("README.md");
    const demo = read("docs/DEMO.md");
    expect(skill).toContain("`Telic: <request>`");
    expect(skill).toContain("Do not activate for setup");
    expect(publicReadme).toContain("`Telic: <your request>`");
    expect(publicReadme).toContain("technical fallback");
    expect(demo).toContain("Telic: investigate");
    expect(demo).not.toContain("Use $telic:telic to investigate");
    expect(skill).toContain("$telic:telic");
    expect(skill).toContain("/telic:telic");
    expect(skill).toContain("expose `/telic`");
    expect(read("adapters/roo-code/project/.roo/commands/telic.md")).toContain(
      "argument-hint",
    );
  });

  it("registers only the local model-free MCP process", () => {
    const configurations = [
      parse("adapters/claude-code/telic/.mcp.json"),
      parse("adapters/antigravity/telic/mcp_config.json"),
      parse("adapters/cursor/project/.cursor/mcp.json"),
      parse("adapters/cline/project/.cline/mcp.json"),
      parse("adapters/roo-code/project/.roo/mcp.json"),
    ];
    const kiro = parse("adapters/kiro/project/.kiro/agents/telic.json");
    configurations.push({ mcpServers: kiro.mcpServers });

    for (const configuration of configurations) {
      const server = configuration.mcpServers.telic;
      expect(server.command).toBe("node");
      expect(server.args).toHaveLength(1);
      expect(server.args[0]).toMatch(/dist\/mcp\/server\.js$/);
      expect(JSON.stringify(server)).not.toMatch(
        /api[_-]?key|access[_-]?token|client[_-]?secret|password/i,
      );
    }

    expect(kiro.allowedTools).toEqual([]);
    expect(
      parse("adapters/roo-code/project/.roo/mcp.json").mcpServers.telic
        .alwaysAllow,
    ).toEqual([]);
  });

  it.each(launchConfigurations)(
    "$host adapter completes the bounded MCP handshake",
    async ({ host, command, args, cwd }) => {
      const repository = mkdtempSync(join(tmpdir(), "telic-adapter-repo-"));
      const stateDirectory = mkdtempSync(
        join(tmpdir(), "telic-adapter-state-"),
      );
      writeFileSync(join(repository, "AGENTS.md"), `# ${host} smoke test\n`);

      const transport = new StdioClientTransport({
        command,
        args: [...args],
        cwd,
        stderr: "pipe",
        env: {
          ...getDefaultEnvironment(),
          TELIC_REPOSITORY_ROOT: repository,
          TELIC_STATE_DIR: stateDirectory,
        },
      });
      const client = new Client({
        name: `telic-${host.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-")}`,
        version: "1.0.0",
      });

      try {
        await client.connect(transport);
        const prompts = await client.listPrompts();
        expect(prompts.prompts.map((prompt) => prompt.name)).toContain(
          "telic_workflow",
        );

        const tools = await client.listTools();
        expect(tools.tools.map((tool) => tool.name).sort()).toEqual(
          expectedTools,
        );
      } finally {
        await client.close().catch(() => undefined);
        rmSync(repository, { force: true, recursive: true });
        rmSync(stateDirectory, { force: true, recursive: true });
      }
    },
    15_000,
  );
});
