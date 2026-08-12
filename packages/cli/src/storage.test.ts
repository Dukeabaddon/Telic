import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { SqliteLedger } from "@telic/core";
import type { ArtifactSubmission, RunRecord } from "@telic/core";

import { runGc } from "./gc.js";
import { runCli } from "./index.js";
import { runPurgeRun } from "./purge-run.js";

const ledgers: SqliteLedger[] = [];

function createRun(runId = "00000000-0000-4000-8000-000000000001"): RunRecord {
  return {
    runId,
    schemaVersion: "1.0",
    repositoryRoot: "/repo",
    requestedMode: "analyze_only",
    topology: "standard",
    escalationCount: 0,
    priorRunId: null,
    status: "running",
    phase: "context_grounding",
    resumePhase: null,
    version: 1,
    budgets: {
      promptRevisionsRemaining: 1,
      postExecutionRemediationsRemaining: 1,
    },
    outcomeHint: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function createLedger(stateDirectory: string): SqliteLedger {
  const ledger = new SqliteLedger(stateDirectory);
  ledgers.push(ledger);
  return ledger;
}

function blobPathForDigest(ledger: SqliteLedger, digest: string): string {
  const hex = digest.startsWith("sha256:")
    ? digest.slice("sha256:".length)
    : digest;
  return join(ledger.blobDirectory, hex.slice(0, 2), hex.slice(2));
}

afterEach(() => {
  for (const ledger of ledgers.splice(0)) ledger.close();
});

describe("purge-run", () => {
  it("deletes a run through the CLI module", () => {
    const stateDirectory = mkdtempSync(join(tmpdir(), "telic-purge-run-"));
    const ledger = createLedger(stateDirectory);
    const run = createRun();
    const request: ArtifactSubmission = {
      id: "request-1",
      runId: run.runId,
      type: "UserMessage",
      schemaVersion: "1.0",
      producer: "user",
      body: { content: "purge via cli" },
    };
    ledger.createRun(run, [request]);
    const digest = ledger.getArtifact(run.runId, request.id)?.sha256;
    expect(digest).toBeTruthy();

    const stdout: string[] = [];
    expect(
      runPurgeRun(ledger, run.runId, true, {
        stdout: (line) => stdout.push(line),
      }),
    ).toBe(0);
    const result = JSON.parse(stdout[0] ?? "{}") as {
      deletedArtifactCount: number;
    };
    expect(result.deletedArtifactCount).toBe(1);
    expect(ledger.getRun(run.runId)).toBeNull();
    expect(existsSync(blobPathForDigest(ledger, digest!))).toBe(false);
  });
});

describe("gc", () => {
  it("supports dry-run before deleting orphan blobs", () => {
    const stateDirectory = mkdtempSync(join(tmpdir(), "telic-gc-"));
    const ledger = createLedger(stateDirectory);
    const run = createRun();
    const request: ArtifactSubmission = {
      id: "request-1",
      runId: run.runId,
      type: "UserMessage",
      schemaVersion: "1.0",
      producer: "user",
      body: { content: "gc via cli" },
    };
    ledger.createRun(run, [request]);
    const digest = ledger.getArtifact(run.runId, request.id)?.sha256;
    expect(digest).toBeTruthy();
    const blobPath = blobPathForDigest(ledger, digest!);
    ledger.purgeRun(run.runId);
    expect(existsSync(blobPath)).toBe(false);
    writeFileSync(blobPath, "{}", { encoding: "utf8", mode: 0o600 });

    const stdout: string[] = [];
    expect(
      runGc(
        ledger,
        { dryRun: true, json: true },
        { stdout: (line) => stdout.push(line) },
      ),
    ).toBe(0);
    const dryRun = JSON.parse(stdout[0] ?? "{}") as {
      orphanDigests: string[];
    };
    expect(dryRun.orphanDigests).toEqual([digest]);
    expect(existsSync(blobPath)).toBe(true);

    stdout.length = 0;
    expect(
      runGc(
        ledger,
        { dryRun: false, json: true },
        { stdout: (line) => stdout.push(line) },
      ),
    ).toBe(0);
    const removed = JSON.parse(stdout[0] ?? "{}") as {
      removedDigests: string[];
    };
    expect(removed.removedDigests).toEqual([digest]);
    expect(existsSync(blobPath)).toBe(false);
  });
});

describe("storage CLI integration", () => {
  it("runs purge-run and gc with TELIC_STATE_DIR", async () => {
    const repository = mkdtempSync(join(tmpdir(), "telic-storage-cli-repo-"));
    const stateDirectory = mkdtempSync(
      join(tmpdir(), "telic-storage-cli-state-"),
    );
    const previousStateDir = process.env.TELIC_STATE_DIR;
    process.env.TELIC_STATE_DIR = stateDirectory;

    const ledger = createLedger(stateDirectory);
    const run = createRun();
    const request: ArtifactSubmission = {
      id: "request-1",
      runId: run.runId,
      type: "UserMessage",
      schemaVersion: "1.0",
      producer: "user",
      body: { content: "integration purge" },
    };
    ledger.createRun(run, [request]);
    const digest = ledger.getArtifact(run.runId, request.id)?.sha256;
    expect(digest).toBeTruthy();
    const blobPath = blobPathForDigest(ledger, digest!);
    ledger.close();
    ledgers.pop();

    try {
      const purgeOutput: string[] = [];
      expect(
        await runCli(["purge-run", run.runId, "--repo", repository, "--json"], {
          stdout: (line) => purgeOutput.push(line),
          stderr: () => undefined,
        }),
      ).toBe(0);
      expect(JSON.parse(purgeOutput[0] ?? "{}")).toMatchObject({
        runId: run.runId,
        deletedArtifactCount: 1,
      });
      expect(existsSync(blobPath)).toBe(false);

      const gcDryOutput: string[] = [];
      expect(
        await runCli(["gc", "--repo", repository, "--dry-run", "--json"], {
          stdout: (line) => gcDryOutput.push(line),
          stderr: () => undefined,
        }),
      ).toBe(0);
      expect(JSON.parse(gcDryOutput[0] ?? "{}")).toMatchObject({
        dryRun: true,
        orphanDigests: [],
      });

      writeFileSync(blobPath, "{}", { encoding: "utf8", mode: 0o600 });
      expect(
        await runCli(["gc", "--repo", repository, "--dry-run", "--json"], {
          stdout: (line) => gcDryOutput.push(line),
          stderr: () => undefined,
        }),
      ).toBe(0);
      expect(JSON.parse(gcDryOutput[1] ?? "{}")).toMatchObject({
        dryRun: true,
        orphanDigests: [digest],
      });
      expect(existsSync(blobPath)).toBe(true);

      const gcOutput: string[] = [];
      expect(
        await runCli(["gc", "--repo", repository, "--json"], {
          stdout: (line) => gcOutput.push(line),
          stderr: () => undefined,
        }),
      ).toBe(0);
      expect(JSON.parse(gcOutput[0] ?? "{}")).toMatchObject({
        removedDigests: [digest],
      });
      expect(existsSync(blobPath)).toBe(false);
    } finally {
      if (previousStateDir === undefined) delete process.env.TELIC_STATE_DIR;
      else process.env.TELIC_STATE_DIR = previousStateDir;
    }
  });
});
