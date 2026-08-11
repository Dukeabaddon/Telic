import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { SqliteLedger } from "./ledger.js";
import { inspectRunReplay } from "./replay-inspector.js";
import type { ArtifactSubmission, RunRecord } from "./types.js";

const ledgers: SqliteLedger[] = [];

function createRun(overrides: Partial<RunRecord> = {}): RunRecord {
  return {
    runId: "00000000-0000-4000-8000-000000000001",
    schemaVersion: "1.0",
    repositoryRoot: "/repo",
    requestedMode: "analyze_only",
    topology: "forensic",
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
    ...overrides,
  };
}

function createLedger(): SqliteLedger {
  const ledger = new SqliteLedger(mkdtempSync(join(tmpdir(), "telic-replay-")));
  ledgers.push(ledger);
  return ledger;
}

afterEach(() => {
  for (const ledger of ledgers.splice(0)) ledger.close();
});

describe("replay inspector", () => {
  it("orders forensic steps by trace sequence with ok digests", () => {
    const ledger = createLedger();
    const run = createRun();
    const request: ArtifactSubmission = {
      id: "request-1",
      runId: run.runId,
      type: "UserMessage",
      schemaVersion: "1.0",
      producer: "user",
      body: { content: "forensic request" },
    };
    ledger.createRun(run, [request]);
    const nextRun = {
      ...run,
      phase: "agent_1_frame" as const,
      version: 2,
      updatedAt: "2026-01-02T00:00:00.000Z",
    };
    ledger.applySubmission(
      1,
      nextRun,
      {
        id: "frame-1",
        runId: run.runId,
        type: "ProblemFrame",
        schemaVersion: "1.0",
        producer: "scenario_author",
        body: { id: "frame-1", summary: "frame" },
      },
      {
        actor: "scenario_author",
        eventType: "phase_submitted",
        phase: "context_grounding",
        decisionSummary: "frame submitted",
      },
    );

    const report = inspectRunReplay(ledger, ledger.requireRun(run.runId));
    expect(report.degraded).toBeUndefined();
    expect(report.steps.length).toBeGreaterThanOrEqual(2);
    expect(report.steps.every((step) => step.digestStatus === "ok")).toBe(
      true,
    );
    expect(report.steps[0]!.sequence).toBeLessThanOrEqual(
      report.steps[report.steps.length - 1]!.sequence,
    );
  });

  it("marks corrupted blob steps as mismatch", () => {
    const ledger = createLedger();
    const run = createRun();
    const request: ArtifactSubmission = {
      id: "request-1",
      runId: run.runId,
      type: "UserMessage",
      schemaVersion: "1.0",
      producer: "user",
      body: { content: "trusted" },
    };
    ledger.createRun(run, [request]);
    const stored = ledger.listArtifacts(run.runId)[0]!;
    const path = join(
      ledger.blobDirectory,
      stored.sha256.slice("sha256:".length, "sha256:".length + 2),
      stored.sha256.slice("sha256:".length + 2),
    );
    chmodSync(path, 0o600);
    writeFileSync(path, '{"content":"tampered"}');

    const report = inspectRunReplay(ledger, ledger.requireRun(run.runId));
    expect(report.steps.some((step) => step.digestStatus === "mismatch")).toBe(
      true,
    );
  });

  it("returns degraded report for micro topology", () => {
    const ledger = createLedger();
    const run = createRun({
      topology: "micro",
      requestedMode: "report_only",
    });
    ledger.createRun(run, [
      {
        id: "request-1",
        runId: run.runId,
        type: "UserMessage",
        schemaVersion: "1.0",
        producer: "user",
        body: { content: "micro" },
      },
    ]);
    const report = inspectRunReplay(ledger, ledger.requireRun(run.runId));
    expect(report).toMatchObject({
      degraded: true,
      reason: "micro_topology",
      steps: [],
    });
  });
});
