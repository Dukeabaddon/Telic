#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

process.env.TELIC_BROKER_STRICT ??= "1";

const stdin = readFileSync(0, "utf8");
const repositoryRoot = process.cwd();

function denyCliUnavailable() {
  process.stdout.write(
    JSON.stringify({
      permission: "deny",
      user_message:
        "Telic broker-gate is unavailable in strict mode; install telic-mcp or set TELIC_BROKER_PERMISSIVE=1 for local development only.",
      agent_message:
        "Telic broker-gate CLI is missing. Do not bypass this tool call without Telic permission evaluation.",
    }),
  );
  process.exit(0);
}

function tryBrokerGate(command, args) {
  const result = spawnSync(command, args, {
    input: stdin,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
    env: process.env,
  });
  if (result.error?.code === "ENOENT") return false;
  process.stdout.write(result.stdout ?? "");
  if (result.stderr) process.stderr.write(result.stderr);
  process.exit(result.status ?? 0);
}

if (tryBrokerGate("telic", ["broker-gate", "--repo", repositoryRoot])) {
  /* exited */
}

const here = dirname(fileURLToPath(import.meta.url));
for (const bin of [
  join(here, "../telic/dist/cli/bin.js"),
  join(here, "../../../packages/cli/dist/bin.js"),
]) {
  if (!existsSync(bin)) continue;
  if (
    tryBrokerGate(process.execPath, [
      bin,
      "broker-gate",
      "--repo",
      repositoryRoot,
    ])
  ) {
    /* exited */
  }
}

denyCliUnavailable();
