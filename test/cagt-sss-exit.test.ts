import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  evaluateBrokerAction,
  gateHostToolCall,
  permissionsFromEnvelope,
} from "@telic/core";

const repositoryRoot = process.cwd();

function cagtTestFiles(): string[] {
  const matches: string[] = [];
  const scan = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory() && entry.name !== "node_modules") {
        scan(path);
        continue;
      }
      if (
        entry.isFile() &&
        /cagt/i.test(entry.name) &&
        entry.name.endsWith(".test.ts")
      ) {
        matches.push(path);
      }
    }
  };
  scan(join(repositoryRoot, "test"));
  scan(join(repositoryRoot, "packages"));
  return matches;
}

describe("CAGT SSS exit predicate", () => {
  it("includes loop 1-7 conformance tests", () => {
    for (let loop = 1; loop <= 7; loop += 1) {
      const path = join(
        repositoryRoot,
        `test/cagt-loop${loop}-conformance.test.ts`,
      );
      expect(existsSync(path), `missing ${path}`).toBe(true);
    }
  });

  it("includes micro benchmark scorecard fixtures", () => {
    const fixtureDir = join(repositoryRoot, "test/fixtures/cagt-benchmark");
    for (const name of [
      "micro-report-only",
      "micro-fix-only",
      "standard-report-only",
      "forensic-analyze-fix",
    ]) {
      expect(
        existsSync(join(fixtureDir, `${name}.json`)),
        `missing scorecard ${name}`,
      ).toBe(true);
    }
  });

  it("exports host-tool-gate and tool-broker entry points", () => {
    expect(typeof gateHostToolCall).toBe("function");
    expect(typeof evaluateBrokerAction).toBe("function");
    expect(typeof permissionsFromEnvelope).toBe("function");

    const denied = gateHostToolCall(
      {
        repositoryRoot: "/repo",
        mode: "report_only",
        envelope: {
          authorization: {
            granted: {
              repository: { read: ["**"], write: [], delete: [] },
              shell: { inspect: true, executeAllowlist: [] },
              runtime: { inspect: ["local"], restart: [] },
              browser: { inspect: true, mutateState: false },
              network: { readDomains: [], externalWrite: false },
              subagents: { spawn: false, maximumChildren: 0, maximumDepth: 0 },
            },
            denied: {
              repository: { read: [], write: ["**"], delete: ["**"] },
              shell: { inspect: false, executeAllowlist: [] },
              runtime: { inspect: [], restart: ["**"] },
              browser: { inspect: false, mutateState: true },
              network: { readDomains: [], externalWrite: true },
              subagents: { spawn: true, maximumChildren: 0, maximumDepth: 0 },
            },
          },
        },
      },
      {
        capability: "repository.write",
        target: "src/foo.ts",
        runId: "00000000-0000-4000-8000-000000000001",
        actionId: "sss-exit-1",
      },
    );
    expect(denied.allowed).toBe(false);
    expect(denied.permissionDecision.decision).toBe("deny");

    const allowed = evaluateBrokerAction(
      {
        repositoryRoot: "/repo",
        mode: "fix_only",
        permissions: permissionsFromEnvelope("fix_only", {
          authorization: {
            granted: {
              repository: { read: ["**"], write: ["src/**"], delete: [] },
              shell: { inspect: true, executeAllowlist: [] },
              runtime: { inspect: ["local"], restart: [] },
              browser: { inspect: true, mutateState: false },
              network: { readDomains: [], externalWrite: false },
              subagents: { spawn: false, maximumChildren: 0, maximumDepth: 0 },
            },
            denied: {
              repository: { read: [], write: [], delete: ["**"] },
              shell: { inspect: false, executeAllowlist: [] },
              runtime: { inspect: [], restart: ["**"] },
              browser: { inspect: false, mutateState: true },
              network: { readDomains: [], externalWrite: true },
              subagents: { spawn: true, maximumChildren: 0, maximumDepth: 0 },
            },
          },
        }),
      },
      {
        capability: "repository.write",
        target: "src/foo.ts",
        runId: "00000000-0000-4000-8000-000000000002",
        actionId: "sss-exit-2",
      },
    );
    expect(allowed.allowed).toBe(true);
    expect(allowed.permissionDecision.decision).toBe("allow");
  });

  it("includes broker hook and replay CLI smoke tests", () => {
    expect(
      existsSync(join(repositoryRoot, "test/cagt-broker-hook-e2e.test.ts")),
    ).toBe(true);
    expect(
      existsSync(join(repositoryRoot, "test/cagt-replay-cli.test.ts")),
    ).toBe(true);
    const cliSource = readFileSync(
      join(repositoryRoot, "packages/cli/src/index.ts"),
      "utf8",
    );
    expect(cliSource).toContain('command === "broker-gate"');
    expect(cliSource).toContain('command === "replay"');
    expect(
      existsSync(
        join(
          repositoryRoot,
          "adapters/cursor/project/.cursor/hooks/broker-gate.mjs",
        ),
      ),
    ).toBe(true);
    expect(
      existsSync(
        join(
          repositoryRoot,
          "adapters/cline/project/.cline/hooks/broker-gate.mjs",
        ),
      ),
    ).toBe(true);
  });

  it("meets the minimum CAGT vitest file floor (>= 10)", () => {
    expect(cagtTestFiles().length).toBeGreaterThanOrEqual(10);
  });

  it("controller shadow cert covers standard topology", () => {
    const source = readFileSync(
      join(repositoryRoot, "packages/core/src/controller.ts"),
      "utf8",
    );
    expect(source).toContain(
      'current.topology === "micro" || current.topology === "standard"',
    );
  });
});
