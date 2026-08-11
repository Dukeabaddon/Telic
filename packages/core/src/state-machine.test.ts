import { describe, expect, it } from "vitest";

import {
  advanceRun,
  resumeAfterClarification,
  TransitionError,
} from "./state-machine.js";
import type { ArtifactSubmission, RunRecord } from "./types.js";

function run(overrides: Partial<RunRecord> = {}): RunRecord {
  return {
    runId: "00000000-0000-4000-8000-000000000001",
    schemaVersion: "1.0",
    repositoryRoot: "/repo",
    requestedMode: "analyze_and_fix",
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

describe("bounded state machine", () => {
  it("rejects out-of-order artifacts", () => {
    expect(() => advanceRun(run(), artifact("WorkResult"))).toThrow(
      TransitionError,
    );
  });

  it("micro report_only skips compile and routes to spot review", () => {
    const result = advanceRun(
      run({
        phase: "agent_1_frame",
        topology: "micro",
    escalationCount: 0,
        requestedMode: "report_only",
      }),
      artifact("ProblemFrame"),
    );
    expect(result.run.phase).toBe("agent_3_review");
  });

  it("micro quality pass goes directly to report", () => {
    const result = advanceRun(
      run({
        phase: "agent_3_review",
        topology: "micro",
        requestedMode: "report_only",
      }),
      artifact("QualityReview", { decision: "pass" }),
    );
    expect(result.run.phase).toBe("agent_5_report");
  });

  it("allows exactly one prompt revision", () => {
    const first = advanceRun(
      run({ phase: "agent_1_review" }),
      artifact("PromptReview", { decision: "revise" }),
    );
    expect(first.run.phase).toBe("agent_2_revise");
    expect(first.run.budgets.promptRevisionsRemaining).toBe(0);
    const again = advanceRun(
      { ...first.run, phase: "agent_1_review" },
      artifact("PromptReview", { decision: "revise" }),
    );
    expect(again.run).toMatchObject({
      status: "running",
      phase: "agent_5_report",
      outcomeHint: "blocked",
    });
  });

  it("shares one remediation across quality and release review", () => {
    const quality = advanceRun(
      run({ phase: "agent_3_review" }),
      artifact("QualityReview", { decision: "remediate" }),
    );
    expect(quality.run.budgets.postExecutionRemediationsRemaining).toBe(0);
    const lateAudit = advanceRun(
      { ...quality.run, phase: "agent_5_audit" },
      artifact("ReleaseAudit", { decision: "remediate" }),
    );
    expect(lateAudit.run.phase).toBe("agent_5_report");
    expect(lateAudit.run.outcomeHint).toBe("blocked");
  });

  it("skips execution for plan-only runs", () => {
    const result = advanceRun(
      run({ phase: "agent_3_plan", requestedMode: "plan_only" }),
      artifact("WorkPlan"),
    );
    expect(result.run.phase).toBe("agent_3_review");
  });

  it("pauses and resumes the same phase for clarification", () => {
    const paused = advanceRun(
      run({ phase: "agent_2_compile" }),
      artifact("ClarificationRequest"),
    ).run;
    expect(paused).toMatchObject({
      status: "awaiting_clarification",
      phase: "agent_2_compile",
      resumePhase: "agent_2_compile",
    });
    expect(resumeAfterClarification(paused)).toMatchObject({
      status: "running",
      phase: "agent_2_compile",
      resumePhase: null,
    });
  });

  it("prevents a partial outcome from being reported as completed", () => {
    expect(() =>
      advanceRun(
        run({ phase: "agent_5_report", outcomeHint: "partial" }),
        artifact("UserReport", { terminalStatus: "completed" }),
      ),
    ).toThrow(/partial audit/);
  });

  it("advances the ordinary serial phase sequence", () => {
    let current = advanceRun(run(), artifact("ContextManifest")).run;
    expect(current.phase).toBe("agent_1_frame");
    current = advanceRun(current, artifact("ProblemFrame")).run;
    current = advanceRun(current, artifact("TaskContract")).run;
    current = advanceRun(
      current,
      artifact("PromptReview", { decision: "pass" }),
    ).run;
    current = advanceRun(current, artifact("WorkPlan")).run;
    current = advanceRun(current, artifact("WorkResult")).run;
    current = advanceRun(
      current,
      artifact("QualityReview", { decision: "pass" }),
    ).run;
    current = advanceRun(
      current,
      artifact("ReleaseAudit", { decision: "release" }),
    ).run;
    current = advanceRun(
      current,
      artifact("UserReport", { terminalStatus: "completed" }),
    ).run;
    expect(current.status).toBe("completed");
  });

  it("returns revised contracts to the frozen reviewer", () => {
    const result = advanceRun(
      run({
        phase: "agent_2_revise",
        budgets: {
          promptRevisionsRemaining: 0,
          postExecutionRemediationsRemaining: 1,
        },
      }),
      artifact("TaskContract"),
    );
    expect(result.run.phase).toBe("agent_1_review");
  });

  it("routes an uncorrectable contract hard gate through final reporting", () => {
    const result = advanceRun(
      run({ phase: "agent_1_review" }),
      artifact("PromptReview", { decision: "block" }),
    );
    expect(result.run).toMatchObject({
      status: "running",
      phase: "agent_5_report",
      outcomeHint: "blocked",
    });
  });

  it.each([
    ["pass", null],
    ["partial", "partial"],
    ["block", "blocked"],
  ] as const)(
    "routes quality decision %s to release audit",
    (decision, outcomeHint) => {
      const result = advanceRun(
        run({ phase: "agent_3_review" }),
        artifact("QualityReview", { decision }),
      );
      expect(result.run).toMatchObject({ phase: "agent_5_audit", outcomeHint });
    },
  );

  it("reports remediation exhaustion through release audit", () => {
    const result = advanceRun(
      run({
        phase: "agent_3_review",
        budgets: {
          promptRevisionsRemaining: 1,
          postExecutionRemediationsRemaining: 0,
        },
      }),
      artifact("QualityReview", { decision: "remediate" }),
    );
    expect(result.run).toMatchObject({
      phase: "agent_5_audit",
      outcomeHint: "blocked",
    });
  });

  it.each([
    ["release", "completed"],
    ["partial", "partial"],
    ["block", "blocked"],
  ] as const)(
    "routes release decision %s to reporting",
    (decision, outcomeHint) => {
      const result = advanceRun(
        run({ phase: "agent_5_audit" }),
        artifact("ReleaseAudit", { decision }),
      );
      expect(result.run).toMatchObject({
        phase: "agent_5_report",
        outcomeHint,
      });
    },
  );

  it("lets release audit consume the still-available shared remediation", () => {
    const result = advanceRun(
      run({ phase: "agent_5_audit" }),
      artifact("ReleaseAudit", { decision: "remediate" }),
    );
    expect(result.run.phase).toBe("agent_3_plan");
    expect(result.run.budgets.postExecutionRemediationsRemaining).toBe(0);
  });

  it.each([
    ["partial", "partial"],
    ["failed_verification", "partial"],
    ["blocked", "blocked"],
  ] as const)(
    "maps user report status %s to run status %s",
    (terminalStatus, status) => {
      const result = advanceRun(
        run({
          phase: "agent_5_report",
          outcomeHint: status === "blocked" ? "blocked" : "partial",
        }),
        artifact("UserReport", { terminalStatus }),
      );
      expect(result.run.status).toBe(status);
    },
  );

  it("rejects malformed review decisions and invalid resumes", () => {
    expect(() =>
      advanceRun(
        run({ phase: "agent_1_review" }),
        artifact("PromptReview", {}),
      ),
    ).toThrow(/decision/);
    expect(() =>
      advanceRun(
        run({ phase: "agent_3_review" }),
        artifact("QualityReview", { decision: "unknown" }),
      ),
    ).toThrow(/Unsupported/);
    expect(() => resumeAfterClarification(run())).toThrow(/not awaiting/);
  });

  it('routes forensic quality pass through evidence reverify', () => {
    const result = advanceRun(
      run({ topology: 'forensic', phase: 'agent_3_review' }),
      artifact('QualityReview', { decision: 'pass' }),
    );
    expect(result.run.phase).toBe('agent_3_evidence_reverify');

    const reverify = advanceRun(
      result.run,
      artifact('QualityReview', {
        decision: 'pass',
        reviewKind: 'evidence_reverify',
      }),
    );
    expect(reverify.run.phase).toBe('agent_5_audit');
  });

  it("rejects artifacts from another run and submissions to stopped runs", () => {
    expect(() =>
      advanceRun(run(), {
        ...artifact("ContextManifest"),
        runId: "00000000-0000-4000-8000-000000000099",
      }),
    ).toThrow(/different run/);
    expect(() =>
      advanceRun(run({ status: "blocked" }), artifact("ContextManifest")),
    ).toThrow(/not running/);
  });
});
