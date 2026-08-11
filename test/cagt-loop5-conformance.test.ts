import { describe, expect, it } from "vitest";

import { advanceRun } from "../packages/core/src/state-machine.js";
import type {
  ArtifactSubmission,
  RunRecord,
} from "../packages/core/src/types.js";

function forensicRun(overrides: Partial<RunRecord> = {}): RunRecord {
  const now = "2026-07-15T10:00:00Z";
  return {
    runId: "00000000-0000-4000-8000-000000000001",
    schemaVersion: "1.0",
    repositoryRoot: "/repo",
    requestedMode: "analyze_and_fix",
    topology: "forensic",
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
    ...overrides,
  };
}

function artifact(
  type: ArtifactSubmission["type"],
  body: Record<string, unknown> = {},
): ArtifactSubmission {
  return {
    id: `${type.toLowerCase()}-01`,
    runId: "00000000-0000-4000-8000-000000000001",
    type,
    schemaVersion: "1.0",
    producer: "quality_controller",
    body: {
      schemaVersion: "1.0",
      id: `${type.toLowerCase()}-01`,
      runId: "00000000-0000-4000-8000-000000000001",
      ...body,
    },
  };
}

describe("CAGT loop 5 conformance", () => {
  it("routes forensic analyze_and_fix quality pass through evidence reverify", () => {
    const afterPass = advanceRun(
      forensicRun({ phase: "agent_3_review" }),
      artifact("QualityReview", { decision: "pass" }),
    );
    expect(afterPass.run.topology).toBe("forensic");
    expect(afterPass.run.phase).toBe("agent_3_evidence_reverify");

    const afterReverify = advanceRun(
      afterPass.run,
      artifact("QualityReview", {
        decision: "pass",
        reviewKind: "evidence_reverify",
      }),
    );
    expect(afterReverify.run.phase).toBe("agent_5_audit");
  });

  it("does not insert evidence reverify for standard topology", () => {
    const result = advanceRun(
      forensicRun({ topology: "standard", phase: "agent_3_review" }),
      artifact("QualityReview", { decision: "pass" }),
    );
    expect(result.run.phase).toBe("agent_5_audit");
  });
});
