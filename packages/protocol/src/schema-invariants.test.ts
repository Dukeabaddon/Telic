import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  ContextManifestSchema,
  ProblemFrameSchema,
  PromptReviewSchema,
  QualityReviewSchema,
  ReleaseAuditSchema,
  TaskContractSchema,
  TraceEventSchema,
  UserReportSchema,
  WorkingContextSchema,
  WorkPlanSchema,
  WorkResultSchema,
} from "./index.js";
import { NO_PERMISSIONS, VALID_ARTIFACT_BODIES } from "../test/test-helpers.js";

const FIXTURE_DIRECTORY = new URL(
  "../../../test/fixtures/protocol/",
  import.meta.url,
);

function fixture(name: string): unknown {
  return JSON.parse(readFileSync(new URL(name, FIXTURE_DIRECTORY), "utf8"));
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

describe("strict input and observability invariants", () => {
  it.each([
    "/workspace/telic",
    "C:\\Users\\Aaron\\Telic",
    "C:/Users/Aaron/Telic",
    "\\\\server\\share\\telic",
  ])(
    "accepts an absolute repository root on every supported platform: %s",
    (repositoryRoot) => {
      expect(
        WorkingContextSchema.safeParse({
          repositoryRoot,
          activeFiles: [],
          applicableRuleRefs: [],
        }).success,
      ).toBe(true);
    },
  );

  it.each(["relative/project", "C:relative\\project", "", "../outside"])(
    "rejects a non-absolute repository root: %s",
    (repositoryRoot) => {
      expect(
        WorkingContextSchema.safeParse({
          repositoryRoot,
          activeFiles: [],
          applicableRuleRefs: [],
        }).success,
      ).toBe(false);
    },
  );

  it("rejects hidden chain-of-thought fields", () => {
    const parsed = PromptReviewSchema.safeParse(
      fixture("invalid-hidden-chain-of-thought.json"),
    );
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(
        parsed.error.issues.some((issue) => issue.code === "unrecognized_keys"),
      ).toBe(true);
    }
  });

  it("rejects unknown nested keys rather than silently stripping them", () => {
    const contract = clone(VALID_ARTIFACT_BODIES.TaskContract) as Record<
      string,
      unknown
    >;
    const permissions = contract.permissions as Record<string, unknown>;
    const repository = permissions.repository as Record<string, unknown>;
    repository.deploy = ["production"];

    expect(TaskContractSchema.safeParse(contract).success).toBe(false);
  });

  it("rejects an unsupported schema version", () => {
    const frame = clone(VALID_ARTIFACT_BODIES.ProblemFrame) as Record<
      string,
      unknown
    >;
    frame.schemaVersion = "0.1.0";
    expect(ProblemFrameSchema.safeParse(frame).success).toBe(false);
  });

  it("bounds rationale summaries", () => {
    const frame = clone(VALID_ARTIFACT_BODIES.ProblemFrame) as Record<
      string,
      unknown
    >;
    frame.rationaleSummary = "x".repeat(4_097);
    expect(ProblemFrameSchema.safeParse(frame).success).toBe(false);
  });

  it("applies text limits to UTF-8 bytes rather than characters", () => {
    const frame = clone(VALID_ARTIFACT_BODIES.ProblemFrame) as Record<
      string,
      unknown
    >;
    frame.rationaleSummary = "🧪".repeat(2_000);
    expect(ProblemFrameSchema.safeParse(frame).success).toBe(false);
  });

  it("requires clarification for a materially divergent unknown", () => {
    const frame = clone(VALID_ARTIFACT_BODIES.ProblemFrame) as Record<
      string,
      unknown
    >;
    frame.unknowns = [
      {
        id: "unknown-01",
        question: "Which design direction should be used?",
        classification: "user_owned_materially_divergent",
        impact: "Different answers change visible product behavior.",
        evidenceInspected: ["repo://AGENTS.md"],
      },
    ];
    expect(ProblemFrameSchema.safeParse(frame).success).toBe(false);
  });

  it("rejects an observed claim without evidence", () => {
    const result = clone(VALID_ARTIFACT_BODIES.WorkResult) as Record<
      string,
      unknown
    >;
    result.observations = [
      {
        id: "claim-no-evidence",
        text: "The runtime returned 500.",
        status: "observed",
        evidenceRefs: [],
        confidence: 1,
      },
    ];
    expect(WorkResultSchema.safeParse(result).success).toBe(false);
  });

  it("rejects completed work and actions without evidence", () => {
    const result = clone(VALID_ARTIFACT_BODIES.WorkResult);
    result.evidenceRefs = [];
    result.actions[0]!.evidenceRefs = [];
    const parsed = WorkResultSchema.safeParse(result);
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ path: ["evidenceRefs"] }),
          expect.objectContaining({ path: ["actions", 0, "evidenceRefs"] }),
        ]),
      );
    }
  });

  it("rejects completed work with failed actions, tests, or acceptance", () => {
    const failedAction = clone(VALID_ARTIFACT_BODIES.WorkResult);
    failedAction.actions[0]!.status = "failed";
    expect(WorkResultSchema.safeParse(failedAction).success).toBe(false);

    const failedTest = clone(VALID_ARTIFACT_BODIES.WorkResult);
    failedTest.testResults = [
      {
        id: "test-01",
        name: "focused verification",
        status: "failed",
        commandRef: null,
        outputRef: "artifact://run-01/test-output-01",
        exitCode: 1,
        rationaleSummary: "The focused verification failed.",
      },
    ];
    expect(WorkResultSchema.safeParse(failedTest).success).toBe(false);

    const failedCoverage = clone(VALID_ARTIFACT_BODIES.WorkResult);
    failedCoverage.acceptanceCoverage[0]!.status = "fail";
    expect(WorkResultSchema.safeParse(failedCoverage).success).toBe(false);
  });

  it("requires permission decisions on permission-check traces", () => {
    const event = clone(VALID_ARTIFACT_BODIES.TraceEvent) as Record<
      string,
      unknown
    >;
    event.eventType = "permission_checked";
    event.permissionDecision = null;
    expect(TraceEventSchema.safeParse(event).success).toBe(false);
  });

  it("rejects duplicate context candidates and understated byte totals", () => {
    const manifest = clone(VALID_ARTIFACT_BODIES.ContextManifest) as Record<
      string,
      unknown
    >;
    const candidates = manifest.candidates as unknown[];
    candidates.push(clone(candidates[0]));
    expect(ContextManifestSchema.safeParse(manifest).success).toBe(false);
  });
});

describe("permission and bounded-loop invariants", () => {
  it.each(["report_only", "plan_only", "analyze_only"])(
    "rejects mutation permissions for %s",
    (intentMode) => {
      const contract = clone(VALID_ARTIFACT_BODIES.TaskContract) as Record<
        string,
        unknown
      >;
      contract.intentMode = intentMode;
      const permissions = contract.permissions as typeof NO_PERMISSIONS;
      permissions.repository.write.push("src/**");
      expect(TaskContractSchema.safeParse(contract).success).toBe(false);
    },
  );

  it("rejects a second prompt revision", () => {
    expect(
      PromptReviewSchema.safeParse(
        fixture("invalid-second-prompt-revision.json"),
      ).success,
    ).toBe(false);
  });

  it("rejects a prompt pass with a failed hard gate regardless of score", () => {
    const review = clone(VALID_ARTIFACT_BODIES.PromptReview) as Record<
      string,
      unknown
    >;
    review.overallScore = 100;
    review.dimensionScores = {
      intentFidelity: 100,
      repositoryGrounding: 100,
      constraintsAndPermissions: 100,
      testableAcceptance: 100,
      executionFeasibility: 100,
      contextEfficiency: 100,
    };
    const gates = review.hardGates as Array<Record<string, unknown>>;
    gates[0]!.passed = false;
    expect(PromptReviewSchema.safeParse(review).success).toBe(false);
  });

  it("rejects a prompt review with an inconsistent weighted score", () => {
    const review = clone(VALID_ARTIFACT_BODIES.PromptReview) as Record<
      string,
      unknown
    >;
    review.overallScore = 100;
    expect(PromptReviewSchema.safeParse(review).success).toBe(false);
  });

  it("rejects a reasonless blocked prompt review", () => {
    const review = clone(VALID_ARTIFACT_BODIES.PromptReview) as Record<
      string,
      unknown
    >;
    review.decision = "block";
    review.findings = [];
    expect(PromptReviewSchema.safeParse(review).success).toBe(false);
  });

  it("rejects remediation after the shared budget is exhausted", () => {
    const review = clone(VALID_ARTIFACT_BODIES.QualityReview) as Record<
      string,
      unknown
    >;
    review.decision = "remediate";
    review.remainingRemediations = 0;
    review.remediationWorkOrder = {
      id: "remediation-01",
      failedCriterionIds: ["AC-1"],
      objective: "Repair only the failed criterion.",
      allowedCapabilities: ["repository.write"],
      permissions: NO_PERMISSIONS,
      sourceRefs: ["artifact://run-01/result-01"],
      maximumToolCalls: 5,
      rationaleSummary:
        "The shared budget is intentionally exhausted in this invalid case.",
    };
    expect(QualityReviewSchema.safeParse(review).success).toBe(false);
  });

  it("rejects release remediation after Agent 3 consumed the shared budget", () => {
    const audit = clone(VALID_ARTIFACT_BODIES.ReleaseAudit) as Record<
      string,
      unknown
    >;
    audit.decision = "remediate";
    audit.remainingRemediations = 0;
    audit.userReportRef = null;
    audit.remediationDefect = {
      id: "release-defect-01",
      failedCriterionIds: ["AC-1"],
      description: "A release claim is unsupported.",
      allowedCapabilities: ["repository.read"],
      permissions: NO_PERMISSIONS,
      sourceRefs: ["artifact://run-01/result-01"],
      maximumToolCalls: 1,
      returnToRole: "quality_controller",
      rationaleSummary: "The shared remediation budget is already exhausted.",
    };
    expect(ReleaseAuditSchema.safeParse(audit).success).toBe(false);
  });

  it("rejects a release remediation defect without failed criteria", () => {
    const audit = clone(VALID_ARTIFACT_BODIES.ReleaseAudit) as Record<
      string,
      unknown
    >;
    audit.decision = "remediate";
    audit.remainingRemediations = 1;
    audit.userReportRef = null;
    audit.remediationDefect = {
      id: "release-defect-01",
      failedCriterionIds: [],
      description: "A release claim is unsupported.",
      allowedCapabilities: ["repository.read"],
      permissions: NO_PERMISSIONS,
      sourceRefs: ["artifact://run-01/result-01"],
      maximumToolCalls: 1,
      returnToRole: "quality_controller",
      rationaleSummary: "A typed defect must identify what failed.",
    };
    expect(ReleaseAuditSchema.safeParse(audit).success).toBe(false);
  });
});

describe("planning, review, and release gates", () => {
  it.each([
    ["pass", "ruleCompliance"],
    ["pass", "regressionChecks"],
    ["proceed_to_fix", "ruleCompliance"],
    ["proceed_to_fix", "regressionChecks"],
  ] as const)(
    "rejects %s when %s contains a failed check",
    (decision, collection) => {
      const review =
        decision === "proceed_to_fix"
          ? (fixture("valid-quality-review-proceed-to-fix.json") as Record<
              string,
              unknown
            >)
          : (clone(VALID_ARTIFACT_BODIES.QualityReview) as Record<
              string,
              unknown
            >);
      review.decision = decision;
      review[collection] = [
        {
          id: `failed-${collection}`,
          description: "A required quality check failed.",
          status: "fail",
          evidenceRefs: ["artifact://run-01/evidence-failure-01"],
          rationaleSummary:
            "A failed check cannot be overridden by a score or generic gate.",
        },
      ];

      expect(QualityReviewSchema.safeParse(review).success).toBe(false);
    },
  );

  it("rejects a nominal pass with a failed rule fixture", () => {
    expect(
      QualityReviewSchema.safeParse(
        fixture("invalid-quality-review-pass-with-failed-rule.json"),
      ).success,
    ).toBe(false);
  });

  it.each([
    ["status", "unsupported"],
    ["directEvidenceRefs", []],
    ["correctionWorkOrder", null],
    ["withinApprovedScope", false],
    ["permissionsSufficient", false],
  ] as const)(
    "rejects analyze-and-fix progression with invalid diagnosis gate field %s",
    (field, value) => {
      const review = fixture(
        "valid-quality-review-proceed-to-fix.json",
      ) as Record<string, unknown>;
      const diagnosisGate = review.diagnosisGate as Record<string, unknown>;
      diagnosisGate[field] = value;

      expect(QualityReviewSchema.safeParse(review).success).toBe(false);
    },
  );

  it("accepts plan-only reviews when the plan is the reviewed artifact", () => {
    const review = clone(VALID_ARTIFACT_BODIES.QualityReview) as Record<
      string,
      unknown
    >;
    review.workPlanRefs = ["artifact://run-01/plan-01"];
    review.workResultRefs = [];
    expect(QualityReviewSchema.safeParse(review).success).toBe(true);

    const audit = clone(VALID_ARTIFACT_BODIES.ReleaseAudit) as Record<
      string,
      unknown
    >;
    audit.workPlanRefs = ["artifact://run-01/plan-01"];
    audit.workResultRefs = [];
    expect(ReleaseAuditSchema.safeParse(audit).success).toBe(true);
  });

  it("rejects a review that cites neither a plan nor a result", () => {
    const review = clone(VALID_ARTIFACT_BODIES.QualityReview) as Record<
      string,
      unknown
    >;
    review.workPlanRefs = [];
    review.workResultRefs = [];
    expect(QualityReviewSchema.safeParse(review).success).toBe(false);
  });

  it("rejects cyclic WorkPlan nodes", () => {
    const plan = clone(VALID_ARTIFACT_BODIES.WorkPlan) as Record<
      string,
      unknown
    >;
    const firstNode = clone((plan.nodes as unknown[])[0]) as Record<
      string,
      unknown
    >;
    firstNode.id = "first";
    firstNode.dependsOn = ["second"];
    const secondNode = clone(firstNode);
    secondNode.id = "second";
    secondNode.dependsOn = ["first"];
    plan.nodes = [firstNode, secondNode];
    expect(WorkPlanSchema.safeParse(plan).success).toBe(false);
  });

  it("rejects a quality pass with failed acceptance", () => {
    const review = clone(VALID_ARTIFACT_BODIES.QualityReview) as Record<
      string,
      unknown
    >;
    const results = review.acceptanceResults as Array<Record<string, unknown>>;
    results[0]!.status = "fail";
    expect(QualityReviewSchema.safeParse(review).success).toBe(false);
  });

  it("rejects a release with an unsupported claim", () => {
    const audit = clone(VALID_ARTIFACT_BODIES.ReleaseAudit) as Record<
      string,
      unknown
    >;
    const matrix = audit.claimEvidenceMatrix as Array<Record<string, unknown>>;
    matrix[0]!.status = "unsupported";
    expect(ReleaseAuditSchema.safeParse(audit).success).toBe(false);
  });

  it("rejects an unverified completion claim", () => {
    const report = clone(VALID_ARTIFACT_BODIES.UserReport) as Record<
      string,
      unknown
    >;
    const claims = report.completionClaims as Array<Record<string, unknown>>;
    claims[0]!.status = "unverified";
    claims[0]!.evidenceRefs = [];
    expect(UserReportSchema.safeParse(report).success).toBe(false);
  });
});
