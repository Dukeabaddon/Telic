import { describe, expect, it } from "vitest";

import { advanceRun } from "./state-machine.js";
import {
  MAX_ESCALATIONS_PER_RUN,
  escalateTopology,
  evaluateEscalation,
} from "./escalation.js";
import type { ArtifactSubmission, RunRecord } from "./types.js";

function run(overrides: Partial<RunRecord> = {}): RunRecord {
  return {
    runId: "00000000-0000-4000-8000-000000000001",
    schemaVersion: "1.0",
    repositoryRoot: "/repo",
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
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function artifact(type: string, body: unknown = {}): ArtifactSubmission {
  return {
    id: `artifact-${type}`,
    runId: "00000000-0000-4000-8000-000000000001",
    type,
    schemaVersion: "1.0",
    producer: "test",
    body,
  };
}

describe("evidence-gated escalation ladder", () => {
  it("escalates micro remediate to standard contract review", () => {
    const result = advanceRun(
      run(),
      artifact("QualityReview", { decision: "remediate" }),
    );
    expect(result.run).toMatchObject({
      topology: "standard",
      phase: "agent_1_review",
    });
    expect(result.summary).toContain("MICRO_SPOT_REMEDIATE");
  });

  it("escalates micro partial to standard contract review", () => {
    const result = advanceRun(
      run(),
      artifact("QualityReview", { decision: "partial" }),
    );
    expect(result.run).toMatchObject({
      topology: "standard",
      phase: "agent_1_review",
    });
    expect(result.summary).toContain("MICRO_SPOT_PARTIAL");
  });

  it("keeps micro block on the micro graph", () => {
    const result = advanceRun(
      run(),
      artifact("QualityReview", { decision: "block" }),
    );
    expect(result.run).toMatchObject({
      topology: "micro",
      phase: "agent_5_report",
      outcomeHint: "blocked",
    });
  });

  it("detects micro user_reported UserReport escalation target", () => {
    const target = evaluateEscalation(
      run({ phase: "agent_5_report" }),
      artifact("UserReport", {
        completionClaims: [
          {
            id: "claim-1",
            text: "User says it works.",
            status: "user_reported",
            evidenceRefs: [],
            confidence: 0.5,
          },
        ],
      }),
    );
    expect(target).toMatchObject({
      targetTopology: "standard",
      phase: "agent_1_review",
      reason: "MICRO_USER_REPORTED",
    });
  });

  it("detects standard ReleaseAudit user_reported escalation target", () => {
    const target = evaluateEscalation(
      run({ topology: "standard", phase: "agent_5_audit" }),
      artifact("ReleaseAudit", {
        claimEvidenceMatrix: [
          {
            claimId: "c1",
            basis: "user_reported",
          },
        ],
      }),
    );
    expect(target).toMatchObject({
      targetTopology: "forensic",
      phase: "agent_5_audit",
      reason: "STANDARD_USER_REPORTED_CLAIMS",
    });
  });

  it("throws when escalation budget is exhausted", () => {
    expect(() =>
      escalateTopology(
        run({ escalationCount: MAX_ESCALATIONS_PER_RUN }),
        "standard",
        "agent_1_review",
        "MICRO_SPOT_PARTIAL",
      ),
    ).toThrow(/escalation budget exhausted/);
  });
});
