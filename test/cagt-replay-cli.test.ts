import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { runCli } from "../packages/cli/src/index.js";
import { TelicService } from "../packages/mcp/src/service.js";

const services: TelicService[] = [];

afterEach(() => {
  for (const service of services.splice(0)) service.close();
});

describe("CAGT replay CLI", () => {
  it("prints a replay report for an existing run", async () => {
    const repositoryRoot = mkdtempSync(
      join(tmpdir(), "telic-replay-cli-repo-"),
    );
    const stateDirectory = mkdtempSync(
      join(tmpdir(), "telic-replay-cli-state-"),
    );
    const previousStateDir = process.env.TELIC_STATE_DIR;
    process.env.TELIC_STATE_DIR = stateDirectory;
    mkdirSync(join(repositoryRoot, "src"), { recursive: true });
    writeFileSync(
      join(repositoryRoot, "src", "index.ts"),
      "export const x = 1;\n",
    );
    const service = new TelicService({ repositoryRoot, stateDirectory });
    services.push(service);

    try {
      const started = service.startRun({
        originalRequest: "What does src/index.ts export?",
        mode: "report_only",
        hostName: "replay-cli",
        nativeSubagents: "unavailable",
        hostCapabilities: ["repository.read"],
        authorizationGranted: ["repository.read"],
      });

      const lines: string[] = [];
      const code = await runCli(
        ["replay", started.run.runId, "--repo", repositoryRoot, "--json"],
        {
          stdout: (line) => lines.push(line),
          stderr: () => undefined,
        },
      );
      expect(code).toBe(0);
      const report = JSON.parse(lines.join("\n")) as { runId: string };
      expect(report.runId).toBe(started.run.runId);
    } finally {
      if (previousStateDir === undefined) delete process.env.TELIC_STATE_DIR;
      else process.env.TELIC_STATE_DIR = previousStateDir;
    }
  });
});
