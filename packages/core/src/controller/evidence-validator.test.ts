import { describe, expect, it } from "vitest";

import type { ArtifactSubmission } from "../types.js";
import {
  directEvidenceArtifactTypes,
  directEvidenceTraceEventTypes,
  evidenceKindsForCapability,
  isUserReportedEvidencePath,
  requiresDirectEvidence,
} from "./evidence-validator.js";

describe("requiresDirectEvidence", () => {
  it("matches WorkResult evidence reference paths", () => {
    expect(requiresDirectEvidence("body.evidenceRefs[0]", "WorkResult")).toBe(
      true,
    );
    expect(
      requiresDirectEvidence("body.actions[2].evidenceRefs[1]", "WorkResult"),
    ).toBe(true);
    expect(requiresDirectEvidence("body.observations[0].evidenceRefs[0]")).toBe(
      true,
    );
    expect(requiresDirectEvidence("body.filesChanged[0].diffRef")).toBe(true);
    expect(requiresDirectEvidence("body.testResults[0].commandRef")).toBe(true);
  });

  it("matches QualityReview hard gate evidence paths", () => {
    expect(
      requiresDirectEvidence(
        "body.hardGates[0].evidenceRefs[0]",
        "QualityReview",
      ),
    ).toBe(true);
  });

  it("rejects non-evidence paths", () => {
    expect(requiresDirectEvidence("body.summary")).toBe(false);
    expect(requiresDirectEvidence("body.evidenceRefs[0]", "WorkPlan")).toBe(
      false,
    );
  });
});

describe("directEvidenceArtifactTypes", () => {
  it("includes expected artifact types", () => {
    expect(directEvidenceArtifactTypes).toEqual(
      new Set(["Evidence", "ContextDocument", "TraceEvent"]),
    );
  });
});

describe("directEvidenceTraceEventTypes", () => {
  it("starts empty until trace event types are registered", () => {
    expect(directEvidenceTraceEventTypes.size).toBe(0);
  });
});

describe("evidenceKindsForCapability", () => {
  it("maps repository.read to repository, diff, and tool_output", () => {
    expect(evidenceKindsForCapability("repository.read")).toEqual(
      new Set(["repository", "diff", "tool_output"]),
    );
  });

  it("maps shell capabilities to tool_output, log, and test", () => {
    expect(evidenceKindsForCapability("shell.execute")).toEqual(
      new Set(["tool_output", "log", "test"]),
    );
  });

  it("returns an empty set for unknown capabilities", () => {
    expect(evidenceKindsForCapability("unknown.capability")).toEqual(new Set());
  });
});

describe("isUserReportedEvidencePath", () => {
  it("detects user-reported ReleaseAudit claim evidence", () => {
    const submission: ArtifactSubmission = {
      runId: "run-1",
      type: "ReleaseAudit",
      body: {
        claimEvidenceMatrix: [
          { basis: "user_reported", evidenceRefs: ["artifact://run-1/msg-1"] },
        ],
      },
    };
    expect(
      isUserReportedEvidencePath(
        submission,
        "body.claimEvidenceMatrix[0].evidenceRefs[0]",
      ),
    ).toBe(true);
  });

  it("detects user-reported UserReport completion claims", () => {
    const submission: ArtifactSubmission = {
      runId: "run-1",
      type: "UserReport",
      body: {
        completionClaims: [
          {
            status: "user_reported",
            evidenceRefs: ["artifact://run-1/msg-1"],
          },
        ],
      },
    };
    expect(
      isUserReportedEvidencePath(
        submission,
        "body.completionClaims[0].evidenceRefs[0]",
      ),
    ).toBe(true);
  });

  it("returns false for other artifact types and paths", () => {
    const submission: ArtifactSubmission = {
      runId: "run-1",
      type: "WorkResult",
      body: { evidenceRefs: ["artifact://run-1/ev-1"] },
    };
    expect(isUserReportedEvidencePath(submission, "body.evidenceRefs[0]")).toBe(
      false,
    );
  });
});
