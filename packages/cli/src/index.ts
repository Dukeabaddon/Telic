import { existsSync, realpathSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

import { SqliteLedger } from "@telic/core";
import { defaultStateDirectory, startStdioServer } from "@telic/mcp";

export interface CliIo {
  stdout: (line: string) => void;
  stderr: (line: string) => void;
}

const defaultIo: CliIo = {
  stdout: (line) => process.stdout.write(`${line}\n`),
  stderr: (line) => process.stderr.write(`${line}\n`),
};

function usage(): string {
  return [
    "Telic 0.1.1",
    "",
    "Usage:",
    "  telic doctor [--repo PATH] [--json]",
    "  telic status RUN_ID [--repo PATH] [--json]",
    "  telic trace RUN_ID [--repo PATH] [--json]",
    "  telic artifact RUN_ID ARTIFACT_ID [--repo PATH] [--json]",
    "  telic mcp",
    "",
    "Telic is local-only by default and never invokes a model API.",
  ].join("\n");
}

function option(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function repositoryFrom(args: string[]): string {
  const configured = option(args, "--repo") ?? process.cwd();
  return realpathSync(resolve(configured));
}

function render(value: unknown, json: boolean): string {
  return json ? JSON.stringify(value) : JSON.stringify(value, null, 2);
}

function commandAvailable(command: "git" | "rg"): boolean {
  const result = spawnSync(command, ["--version"], {
    encoding: "utf8",
    stdio: ["ignore", "ignore", "ignore"],
    timeout: 2_000,
  });
  return result.status === 0;
}

function openExistingLedger(repository: string): SqliteLedger {
  const stateDirectory = process.env.TELIC_STATE_DIR
    ? resolve(process.env.TELIC_STATE_DIR)
    : defaultStateDirectory(repository);
  if (!existsSync(join(stateDirectory, "ledger.sqlite3"))) {
    throw new Error(`No Telic ledger exists at ${stateDirectory}`);
  }
  return new SqliteLedger(stateDirectory);
}

export async function runCli(
  argv: string[],
  io: CliIo = defaultIo,
): Promise<number> {
  const [command, ...args] = argv;
  if (
    !command ||
    command === "help" ||
    command === "--help" ||
    command === "-h"
  ) {
    io.stdout(usage());
    return 0;
  }

  try {
    if (command === "mcp") {
      await startStdioServer();
      return 0;
    }

    const repository = repositoryFrom(args);
    const json = args.includes("--json");
    if (command === "doctor") {
      const nodeMajor = Number.parseInt(
        process.versions.node.split(".")[0] ?? "0",
        10,
      );
      const checks = {
        node: {
          ok: nodeMajor >= 24,
          version: process.versions.node,
          required: ">=24.15.0",
        },
        repository: { ok: true, root: repository },
        git: { ok: commandAvailable("git"), optional: true },
        ripgrep: { ok: commandAvailable("rg"), optional: true },
        ledger: {
          exists: existsSync(
            join(
              process.env.TELIC_STATE_DIR
                ? resolve(process.env.TELIC_STATE_DIR)
                : defaultStateDirectory(repository),
              "ledger.sqlite3",
            ),
          ),
          stateDirectory: process.env.TELIC_STATE_DIR
            ? resolve(process.env.TELIC_STATE_DIR)
            : defaultStateDirectory(repository),
        },
      };
      io.stdout(render({ ok: checks.node.ok, checks }, json));
      return checks.node.ok ? 0 : 1;
    }

    const runId = args[0];
    if (!runId || runId.startsWith("--"))
      throw new Error(`${command} requires RUN_ID`);
    const ledger = openExistingLedger(repository);
    try {
      if (command === "status") {
        const run = ledger.requireRun(runId);
        io.stdout(
          render({ run, artifacts: ledger.listArtifacts(runId) }, json),
        );
        return 0;
      }
      if (command === "trace") {
        ledger.requireRun(runId);
        io.stdout(render({ runId, events: ledger.listTrace(runId) }, json));
        return 0;
      }
      if (command === "artifact") {
        const artifactId = args[1];
        if (!artifactId || artifactId.startsWith("--")) {
          throw new Error("artifact requires ARTIFACT_ID");
        }
        const artifact = ledger.getArtifact(runId, artifactId);
        if (!artifact) throw new Error(`Artifact not found: ${artifactId}`);
        io.stdout(render({ artifact }, json));
        return 0;
      }
      throw new Error(`Unknown command: ${command}`);
    } finally {
      ledger.close();
    }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown CLI error";
    io.stderr(`telic: ${message.replaceAll(/[\r\n]+/g, " ").slice(0, 800)}`);
    return 1;
  }
}
