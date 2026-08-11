import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { evaluateBrokerGate } from "../packages/cli/src/broker-gate.js";
import { TelicService } from "../packages/mcp/src/service.js";

const services: TelicService[] = [];

afterEach(() => {
  for (const service of services.splice(0)) service.close();
});

describe("CAGT broker hook E2E", () => {
  it("denies repository.write for report_only runs with an active session", () => {
    const repositoryRoot = mkdtempSync(
      join(tmpdir(), "telic-broker-hook-repo-"),
    );
    const stateDirectory = mkdtempSync(
      join(tmpdir(), "telic-broker-hook-state-"),
    );
    const previousStateDir = process.env.TELIC_STATE_DIR;
    process.env.TELIC_STATE_DIR = stateDirectory;
    mkdirSync(join(repositoryRoot, "src"), { recursive: true });
    writeFileSync(
      join(repositoryRoot, "src", "index.ts"),
      "export const x = 1;\n",
    );
    const service = new TelicService({
      repositoryRoot,
      stateDirectory,
    });
    services.push(service);

    try {
      expect(
        evaluateBrokerGate({
          repositoryRoot,
          hookInput: {
            tool_name: "Write",
            tool_input: { path: "src/index.ts" },
          },
        }),
      ).toEqual({ permission: "allow" });

      const started = service.startRun({
        originalRequest: "Summarize src/index.ts without editing files.",
        mode: "report_only",
        hostName: "broker-hook-e2e",
        nativeSubagents: "unavailable",
        hostCapabilities: ["repository.read"],
        authorizationGranted: ["repository.read"],
      });

      const denied = evaluateBrokerGate({
        repositoryRoot,
        hookInput: {
          tool_name: "Write",
          tool_input: { path: "src/index.ts" },
        },
      });
      expect(denied.permission).toBe("deny");
      expect(denied.user_message).toContain("repository.write");

      const trace = service.getTrace(started.run.runId);
      expect(trace.some((event) => event.eventType === "broker_decision")).toBe(
        true,
      );
    } finally {
      if (previousStateDir === undefined) delete process.env.TELIC_STATE_DIR;
      else process.env.TELIC_STATE_DIR = previousStateDir;
    }
  });

  it("allows repository.write for fix_only runs inside granted scope", () => {
    const repositoryRoot = mkdtempSync(
      join(tmpdir(), "telic-broker-hook-fix-"),
    );
    const stateDirectory = mkdtempSync(
      join(tmpdir(), "telic-broker-hook-fix-state-"),
    );
    const previousStateDir = process.env.TELIC_STATE_DIR;
    process.env.TELIC_STATE_DIR = stateDirectory;
    mkdirSync(join(repositoryRoot, "src"), { recursive: true });
    writeFileSync(
      join(repositoryRoot, "src", "foo.ts"),
      "export const bar = 1;\n",
    );
    const service = new TelicService({
      repositoryRoot,
      stateDirectory,
    });
    services.push(service);

    try {
      service.startRun({
        originalRequest: "Fix typo in src/foo.ts",
        mode: "fix_only",
        hostName: "broker-hook-e2e",
        nativeSubagents: "unavailable",
        hostCapabilities: ["repository.read", "repository.write"],
        authorizationGranted: ["repository.read", "repository.write"],
      });

      const allowed = evaluateBrokerGate({
        repositoryRoot,
        hookInput: {
          tool_name: "StrReplace",
          tool_input: { path: "src/foo.ts" },
        },
      });
      expect(allowed.permission).toBe("allow");
    } finally {
      if (previousStateDir === undefined) delete process.env.TELIC_STATE_DIR;
      else process.env.TELIC_STATE_DIR = previousStateDir;
    }
  });
});
