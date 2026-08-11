#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const stdin = readFileSync(0, "utf8");
const repositoryRoot = process.cwd();

function tryBrokerGate(command, args) {
  const result = spawnSync(command, args, {
    input: stdin,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
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

process.stdout.write(JSON.stringify({ permission: "allow" }));
