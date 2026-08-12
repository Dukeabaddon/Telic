import { describe, expect, it } from "vitest";

import type { RunRecord } from "../types.js";
import {
  collectArtifactReferences,
  expectedProducer,
  expectedReferenceType,
  isKnownSystemReference,
  roleByPhase,
  systemReferenceFields,
  terminalField,
} from "./cross-artifact-validator.js";

function run(overrides: Partial<RunRecord> = {}): RunRecord {
  return {
    runId: "run-1",
    schemaVersion: "1.0",
    repositoryRoot: "/repo",
    requestedMode: "analyze_and_fix",
    topology: "micro",
    escalationCount: 0,
    priorRunId: null,
    status: "running",
    phase: "agent_4_execute",
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

describe("collectArtifactReferences", () => {
  it("collects artifact, repo, and trace refs from known fields", () => {
    const refs = collectArtifactReferences({
      evidenceRefs: ["artifact://run-1/ev-1"],
      contextRefs: ["repo://run-1/src"],
      toolEventRefs: ["trace://run-1/event-0001"],
      summary: "ignored",
    });
    expect(refs).toEqual([
      { ref: "artifact://run-1/ev-1", path: "body.evidenceRefs[0]" },
      { ref: "repo://run-1/src", path: "body.contextRefs[0]" },
      { ref: "trace://run-1/event-0001", path: "body.toolEventRefs[0]" },
    ]);
  });

  it("ignores reference-shaped strings in non-reference fields", () => {
    expect(
      collectArtifactReferences({
        summary: "artifact://run-1/ev-1",
      }),
    ).toEqual([]);
  });
});

describe("expectedReferenceType", () => {
  it("maps known reference paths to artifact types", () => {
    expect(expectedReferenceType("body.problemFrameRef")).toBe("ProblemFrame");
    expect(expectedReferenceType("body.workPlanRefs[0]")).toBe("WorkPlan");
    expect(expectedReferenceType("body.workResultRefs[1]")).toBe("WorkResult");
    expect(expectedReferenceType("body.qualityReviewRef")).toBe(
      "QualityReview",
    );
  });

  it("returns null for untyped reference paths", () => {
    expect(expectedReferenceType("body.evidenceRefs[0]")).toBeNull();
  });
});

describe("system reference helpers", () => {
  it("recognizes known system artifact URIs", () => {
    expect(
      isKnownSystemReference("artifact://system/roles/quality-controller-v1"),
    ).toBe(true);
    expect(isKnownSystemReference("artifact://system/roles/unknown-v1")).toBe(
      false,
    );
  });

  it("tracks fields that may hold system references", () => {
    expect(systemReferenceFields.has("policyRefs")).toBe(true);
    expect(systemReferenceFields.has("evidenceRefs")).toBe(false);
  });

  it("extracts terminal field names from reference paths", () => {
    expect(terminalField("body.policyRefs[2]")).toBe("policyRefs");
    expect(terminalField("body.instructionRef")).toBe("instructionRef");
  });
});

describe("expectedProducer", () => {
  it("maps fixed artifact types to producers", () => {
    expect(
      expectedProducer(run({ phase: "agent_4_execute" }), "WorkResult"),
    ).toBe("executor");
    expect(expectedProducer(run({ phase: "agent_3_plan" }), "WorkPlan")).toBe(
      "quality_controller",
    );
  });

  it("uses phase role for ClarificationRequest and unknown types", () => {
    expect(
      expectedProducer(
        run({ phase: "agent_2_compile" }),
        "ClarificationRequest",
      ),
    ).toBe("task_compiler");
    expect(
      expectedProducer(run({ phase: "agent_1_frame" }), "CustomArtifact"),
    ).toBe("scenario_author");
  });
});

describe("roleByPhase", () => {
  it("maps execution phase to executor", () => {
    expect(roleByPhase.agent_4_execute).toBe("executor");
  });
});
