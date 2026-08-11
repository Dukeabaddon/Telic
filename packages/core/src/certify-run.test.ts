import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { certifyRun } from "./certify-run.js";
import { SqliteLedger } from "./ledger.js";
import type { RunRecord } from "./types.js";

function makeRun(runId: string, ledger: SqliteLedger): RunRecord {
  const now = "2026-07-15T10:00:00Z";
  const run: RunRecord = {
    runId,
    schemaVersion: "1.0",
    repositoryRoot: "/tmp/repo",
    requestedMode: "report_only",
    topology: "micro",
    escalationCount: 0,
    priorRunId: null,
    status: "running",
    phase: "agent_3_review",
    resumePhase: null,
    version: 1,
    budgets: {
      promptRevisionsRemaining: 1,
      postExecutionRemediationsRemaining: 1,
    },
    outcomeHint: null,
    createdAt: now,
    updatedAt: now,
  };
  ledger.createRun(run, []);
  return run;
}

const ledgers: SqliteLedger[] = [];

afterEach(() => {
  for (const ledger of ledgers.splice(0)) ledger.close();
});

describe("certifyRun", () => {
  it("verifies evidence digests referenced by a passing spot review", () => {
    const ledger = new SqliteLedger(
      mkdtempSync(join(tmpdir(), "telic-certify-")),
    );
    ledgers.push(ledger);
    const runId = "run-cert-01";
    makeRun(runId, ledger);
    const evidenceBody = {
      schemaVersion: "1.0",
      id: "evidence-01",
      runId,
      kind: "repository",
      capturedAt: "2026-07-15T10:05:00Z",
      summary: "Repository evidence.",
      contentType: "application/json",
      encoding: "utf8",
      content: '{"ok":true}',
      sourceRefs: [],
      redactions: [],
      rationaleSummary: "Captured evidence.",
    };
    ledger.applySubmission(
      1,
      {
        runId,
        schemaVersion: "1.0",
        repositoryRoot: "/tmp/repo",
        requestedMode: "report_only",
        topology: "micro",
        escalationCount: 0,
        priorRunId: null,
        status: "running",
        phase: "agent_3_review",
        resumePhase: null,
        version: 2,
        budgets: {
          promptRevisionsRemaining: 1,
          postExecutionRemediationsRemaining: 1,
        },
        outcomeHint: null,
        createdAt: "2026-07-15T10:00:00Z",
        updatedAt: "2026-07-15T10:01:00Z",
      },
      {
        id: "evidence-01",
        runId,
        type: "Evidence",
        schemaVersion: "1.0",
        producer: "executor",
        body: evidenceBody,
      },
      {
        actor: "executor",
        eventType: "phase_submitted",
        phase: "agent_4_execute",
        decisionSummary: "Evidence captured.",
      },
    );

    const result = certifyRun(ledger, runId, {
      acceptanceResults: [
        {
          criterionId: "AC-1",
          status: "pass",
          evidenceRefs: [`artifact://${runId}/evidence-01`],
          rationaleSummary: "Direct evidence.",
        },
      ],
    });

    expect(result.digestStatus).toBe("verified");
    expect(result.claimEvidenceMatrix[0]?.status).toBe("supported");
  });

  it("marks digestStatus failed when evidence blob integrity fails", () => {
    const ledger = new SqliteLedger(
      mkdtempSync(join(tmpdir(), "telic-certify-fail-")),
    );
    ledgers.push(ledger);
    const runId = "run-cert-02";
    makeRun(runId, ledger);
    const evidenceBody = {
      schemaVersion: "1.0",
      id: "evidence-02",
      runId,
      kind: "repository",
      capturedAt: "2026-07-15T10:05:00Z",
      summary: "Repository evidence.",
      contentType: "application/json",
      encoding: "utf8",
      content: '{"ok":true}',
      sourceRefs: [],
      redactions: [],
      rationaleSummary: "Captured evidence.",
    };
    ledger.applySubmission(
      1,
      {
        runId,
        schemaVersion: "1.0",
        repositoryRoot: "/tmp/repo",
        requestedMode: "report_only",
        topology: "micro",
        escalationCount: 0,
        priorRunId: null,
        status: "running",
        phase: "agent_3_review",
        resumePhase: null,
        version: 2,
        budgets: {
          promptRevisionsRemaining: 1,
          postExecutionRemediationsRemaining: 1,
        },
        outcomeHint: null,
        createdAt: "2026-07-15T10:00:00Z",
        updatedAt: "2026-07-15T10:01:00Z",
      },
      {
        id: "evidence-02",
        runId,
        type: "Evidence",
        schemaVersion: "1.0",
        producer: "executor",
        body: evidenceBody,
      },
      {
        actor: "executor",
        eventType: "phase_submitted",
        phase: "agent_4_execute",
        decisionSummary: "Evidence captured.",
      },
    );
    const stored = ledger.getArtifact(runId, "evidence-02");
    if (!stored) throw new Error("evidence expected");

    const result = certifyRun(ledger, runId, {
      acceptanceResults: [
        {
          criterionId: "AC-1",
          status: "pass",
          evidenceRefs: [`artifact://${runId}/missing-evidence`],
          rationaleSummary: "Broken ref.",
        },
      ],
    });

    expect(result.digestStatus).toBe("failed");
    expect(stored.sha256.length).toBeGreaterThan(10);
  });
});
