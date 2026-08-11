import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { TelicService } from "../packages/mcp/src/service.js";
import { VALID_ARTIFACT_BODIES, HASH } from "../packages/protocol/test/test-helpers.js";

type ArtifactBody = Record<string, unknown>;
const services: TelicService[] = [];

function bindTemplate(
  value: unknown,
  runId: string,
  requestId: string,
): unknown {
  const json = JSON.stringify(value).replaceAll("run-01", runId);
  return JSON.parse(json.replaceAll("user-message-01", requestId));
}

async function createMicroFixHarness() {
  const repositoryRoot = mkdtempSync(join(tmpdir(), "telic-cagt-loop2-"));
  mkdirSync(join(repositoryRoot, "src"), { recursive: true });
  writeFileSync(join(repositoryRoot, "src", "foo.ts"), "export const bar = 1;\n");
  const service = new TelicService({
    repositoryRoot,
    stateDirectory: mkdtempSync(join(tmpdir(), "telic-cagt-loop2-state-")),
  });
  services.push(service);
  const started = service.startRun({
    originalRequest: "Fix typo in src/foo.ts: bar→baz",
    mode: "fix_only",
    hostName: "cagt-loop2",
    nativeSubagents: "unavailable",
    hostCapabilities: ["repository.read", "repository.write"],
    authorizationGranted: ["repository.read", "repository.write"],
  });
  expect(started.run.topology).toBe("micro");
  await service.groundContext({ runId: started.run.runId });
  const request = service
    .getRun(started.run.runId)
    .artifacts.find((artifact) => artifact.type === "UserMessage");
  if (!request) throw new Error("request artifact expected");
  const body = (type: keyof typeof VALID_ARTIFACT_BODIES) =>
    bindTemplate(
      structuredClone(VALID_ARTIFACT_BODIES[type]),
      started.run.runId,
      request.id,
    ) as ArtifactBody;
  const submit = (
    type: string,
    producer: string,
    artifactBody: ArtifactBody,
    sourceRefs: string[] = [],
  ) =>
    service.submitArtifact({
      id: artifactBody.id as string,
      runId: started.run.runId,
      type,
      schemaVersion: "1.0",
      producer,
      body: artifactBody,
      ...(sourceRefs.length > 0 ? { sourceRefs } : {}),
    });
  return { service, runId: started.run.runId, body, submit };
}

afterEach(() => {
  for (const service of services.splice(0)) service.close();
});

describe("CAGT loop 2 conformance", () => {
  it("completes micro fix_only without ReleaseAudit", async () => {
    const harness = await createMicroFixHarness();
    const frame = harness.body("ProblemFrame");
    frame.intentMode = "fix_only";
    frame.applicableRuleRefs = [];
    frame.scope = { include: ["src/foo.ts"], exclude: [] };
    frame.constraints = [];
    frame.nonGoals = [];
    harness.submit("ProblemFrame", "scenario_author", frame);

    const evidenceId = "evidence-01";
    harness.submit("Evidence", "executor", {
      schemaVersion: "1.0",
      id: evidenceId,
      runId: harness.runId,
      kind: "diff",
      capturedAt: "2026-07-15T10:05:00Z",
      summary: "Captured bounded repository evidence for the micro fix.",
      contentType: "application/json",
      encoding: "utf8",
      content: '{"diff":"bar→baz"}',
      sourceRefs: [],
      redactions: [],
      rationaleSummary: "Local bounded evidence for the fix.",
    });

    const result = harness.body("WorkResult");
    result.id = "result-01";
    result.workPlanRef = `artifact://${harness.runId}/plan-01`;
    result.nodeId = "micro-execute";
    result.observations = [
      {
        id: "claim-01",
        text: "The bounded typo fix was applied.",
        status: "observed",
        evidenceRefs: [`artifact://${harness.runId}/${evidenceId}`],
        confidence: 1,
      },
    ];
    result.inferences = [];
    result.evidenceRefs = [`artifact://${harness.runId}/${evidenceId}`];
    result.acceptanceCoverage = [
      {
        criterionId: "AC-1",
        status: "pass",
        evidenceRefs: [`artifact://${harness.runId}/${evidenceId}`],
        rationaleSummary: "The fix satisfies the bounded criterion.",
      },
    ];
    result.filesChanged = [
      {
        path: "src/foo.ts",
        changeType: "modified",
        beforeHash: HASH,
        afterHash: `sha256:${"1".repeat(64)}`,
        diffRef: `artifact://${harness.runId}/${evidenceId}`,
      },
    ];
    result.actions = [
      {
        id: "action-01",
        capability: "repository.write",
        target: "src/foo.ts",
        mutating: true,
        status: "completed",
        evidenceRefs: [`artifact://${harness.runId}/${evidenceId}`],
        rationaleSummary: "Applied the bounded file correction.",
      },
      {
        id: "verify-01",
        capability: "repository.read",
        target: "src/foo.ts",
        mutating: false,
        status: "completed",
        evidenceRefs: [`artifact://${harness.runId}/${evidenceId}`],
        rationaleSummary: "Verified the bounded file correction.",
      },
    ];
    harness.submit("WorkResult", "executor", result);

    const review = harness.body("QualityReview");
    review.decision = "pass";
    review.workResultRefs = [`artifact://${harness.runId}/result-01`];
    review.ruleCompliance = [];
    review.regressionChecks = [];
    review.verificationResults = [
      {
        requirementId: "VR-MICRO",
        capability: "repository.read",
        status: "pass",
        evidenceRefs: [`artifact://${harness.runId}/${evidenceId}`],
        rationaleSummary: "Repository evidence captured for the micro fix.",
      },
    ];
    review.taskContractRef = `artifact://${harness.runId}/contract-01`;
    review.workPlanRefs = [`artifact://${harness.runId}/plan-01`];
    review.acceptanceResults = [
      {
        criterionId: "AC-1",
        status: "pass",
        evidenceRefs: [`artifact://${harness.runId}/${evidenceId}`],
        rationaleSummary: "Spot-check passed with direct evidence.",
      },
    ];
    review.hardGates = [
      {
        id: "spot-primary",
        passed: true,
        description: "Primary criterion satisfied.",
        evidenceRefs: [`artifact://${harness.runId}/${evidenceId}`],
        rationaleSummary: "Spot-check passed.",
      },
    ];
    harness.submit("QualityReview", "quality_controller", review);

    const report = harness.body("UserReport");
    report.terminalStatus = "completed";
    report.completionClaims = [
      {
        id: "completion-01",
        text: "The micro fix_only workflow completed.",
        status: "observed",
        evidenceRefs: [`artifact://${harness.runId}/${evidenceId}`],
        confidence: 1,
      },
    ];
    report.findingRefs = [];
    report.changeRefs = [`artifact://${harness.runId}/${evidenceId}`];
    report.verificationRefs = [`artifact://${harness.runId}/${evidenceId}`];
    report.traceRef = `trace://${harness.runId}`;
    const terminal = harness.submit("UserReport", "release_auditor", report);

    expect(terminal.run.status).toBe("completed");
    expect(terminal.run.topology).toBe("micro");
    const types = harness.service
      .getRun(harness.runId)
      .artifacts.map((artifact) => artifact.type);
    expect(types.includes("ReleaseAudit")).toBe(false);
    expect(types.includes("ReceiptAudit")).toBe(true);
    expect(types.includes("PromptReview")).toBe(false);
    expect(types).toEqual(
      expect.arrayContaining([
        "ProblemFrame",
        "TaskContract",
        "WorkPlan",
        "Evidence",
        "WorkResult",
        "QualityReview",
        "UserReport",
      ]),
    );
  });
});
