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

afterEach(() => {
  for (const service of services.splice(0)) service.close();
});

describe("CAGT loop 3 conformance", () => {
  it("emits ReceiptAudit and digest_verified on micro QualityReview pass", async () => {
    const repositoryRoot = mkdtempSync(join(tmpdir(), "telic-cagt-loop3-"));
    mkdirSync(join(repositoryRoot, "src"), { recursive: true });
    writeFileSync(join(repositoryRoot, "src", "foo.ts"), "export const bar = 1;\n");
    const service = new TelicService({
      repositoryRoot,
      stateDirectory: mkdtempSync(join(tmpdir(), "telic-cagt-loop3-state-")),
    });
    services.push(service);
    const started = service.startRun({
      originalRequest: "Fix typo in src/foo.ts: bar→baz",
      mode: "fix_only",
      hostName: "cagt-loop3",
      nativeSubagents: "unavailable",
      hostCapabilities: ["repository.read", "repository.write"],
      authorizationGranted: ["repository.read", "repository.write"],
    });
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

    const frame = body("ProblemFrame");
    frame.intentMode = "fix_only";
    frame.applicableRuleRefs = [];
    frame.scope = { include: ["src/foo.ts"], exclude: [] };
    frame.constraints = [];
    frame.nonGoals = [];
    submit("ProblemFrame", "scenario_author", frame);

    const evidenceId = "evidence-01";
    submit("Evidence", "executor", {
      schemaVersion: "1.0",
      id: evidenceId,
      runId: started.run.runId,
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

    const result = body("WorkResult");
    result.id = "result-01";
    result.workPlanRef = `artifact://${started.run.runId}/plan-01`;
    result.nodeId = "micro-execute";
    result.observations = [];
    result.inferences = [];
    result.evidenceRefs = [`artifact://${started.run.runId}/${evidenceId}`];
    result.acceptanceCoverage = [
      {
        criterionId: "AC-1",
        status: "pass",
        evidenceRefs: [`artifact://${started.run.runId}/${evidenceId}`],
        rationaleSummary: "The fix satisfies the bounded criterion.",
      },
    ];
    result.filesChanged = [
      {
        path: "src/foo.ts",
        changeType: "modified",
        beforeHash: HASH,
        afterHash: `sha256:${"1".repeat(64)}`,
        diffRef: `artifact://${started.run.runId}/${evidenceId}`,
      },
    ];
    result.actions = [
      {
        id: "action-01",
        capability: "repository.write",
        target: "src/foo.ts",
        mutating: true,
        status: "completed",
        evidenceRefs: [`artifact://${started.run.runId}/${evidenceId}`],
        rationaleSummary: "Applied the bounded file correction.",
      },
      {
        id: "verify-01",
        capability: "repository.read",
        target: "src/foo.ts",
        mutating: false,
        status: "completed",
        evidenceRefs: [`artifact://${started.run.runId}/${evidenceId}`],
        rationaleSummary: "Verified the bounded file correction.",
      },
    ];
    submit("WorkResult", "executor", result);

    const review = body("QualityReview");
    review.decision = "pass";
    review.workResultRefs = [`artifact://${started.run.runId}/result-01`];
    review.ruleCompliance = [];
    review.regressionChecks = [];
    review.verificationResults = [
      {
        requirementId: "VR-MICRO",
        capability: "repository.read",
        status: "pass",
        evidenceRefs: [`artifact://${started.run.runId}/${evidenceId}`],
        rationaleSummary: "Repository evidence captured for the micro fix.",
      },
    ];
    review.taskContractRef = `artifact://${started.run.runId}/contract-01`;
    review.workPlanRefs = [`artifact://${started.run.runId}/plan-01`];
    review.acceptanceResults = [
      {
        criterionId: "AC-1",
        status: "pass",
        evidenceRefs: [`artifact://${started.run.runId}/${evidenceId}`],
        rationaleSummary: "Spot-check passed with direct evidence.",
      },
    ];
    review.hardGates = [
      {
        id: "spot-primary",
        passed: true,
        description: "Primary criterion satisfied.",
        evidenceRefs: [`artifact://${started.run.runId}/${evidenceId}`],
        rationaleSummary: "Spot-check passed.",
      },
    ];
    submit("QualityReview", "quality_controller", review);

    const artifacts = service.getRun(started.run.runId).artifacts;
    const receipt = artifacts.find((artifact) => artifact.type === "ReceiptAudit");
    expect(receipt).toBeDefined();
    const receiptBody = service.getArtifact(started.run.runId, receipt!.id).body as {
      digestStatus?: string;
    };
    expect(receiptBody.digestStatus).toBe("verified");

    const ledgerTrace = service.ledger.listTrace(started.run.runId);
    expect(ledgerTrace.some((event) => event.eventType === "digest_verified")).toBe(
      true,
    );

    const mcpTrace = service.getTrace(started.run.runId);
    expect(
      mcpTrace.some((event) => event.eventType === "digest_verified"),
    ).toBe(true);
  });
});
