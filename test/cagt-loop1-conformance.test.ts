import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { TelicService } from "../packages/mcp/src/service.js";
import { VALID_ARTIFACT_BODIES } from "../packages/protocol/test/test-helpers.js";

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

async function createMicroReportHarness() {
  const repositoryRoot = mkdtempSync(join(tmpdir(), "telic-cagt-loop1-"));
  mkdirSync(join(repositoryRoot, "src"), { recursive: true });
  writeFileSync(
    join(repositoryRoot, "src", "index.ts"),
    "export const x = 1;\n",
  );
  const service = new TelicService({
    repositoryRoot,
    stateDirectory: mkdtempSync(join(tmpdir(), "telic-cagt-loop1-state-")),
  });
  services.push(service);
  const started = service.startRun({
    originalRequest: "What does src/index.ts export?",
    mode: "report_only",
    hostName: "cagt-loop1",
    nativeSubagents: "unavailable",
    hostCapabilities: ["repository.read"],
    authorizationGranted: ["repository.read"],
  });
  expect(started.run.topology).toBe("micro");
  await service.groundContext({ runId: started.run.runId });
  const records = service.getRun(started.run.runId).artifacts;
  const request = records.find((artifact) => artifact.type === "UserMessage");
  if (!request) throw new Error("request artifact expected");
  const firstTrace = service.getTrace(started.run.runId).at(0);
  if (!firstTrace) throw new Error("trace event expected");
  const traceEvidenceRef = `trace://${started.run.runId}/${firstTrace.id}`;
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
  return {
    service,
    runId: started.run.runId,
    traceEvidenceRef,
    body,
    submit,
  };
}

function submitMicroFrame(
  harness: Awaited<ReturnType<typeof createMicroReportHarness>>,
) {
  const frame = harness.body("ProblemFrame");
  frame.intentMode = "report_only";
  frame.applicableRuleRefs = [];
  frame.scope = { include: ["src"], exclude: [] };
  frame.constraints = [];
  frame.nonGoals = [];
  harness.submit("ProblemFrame", "scenario_author", frame);
}

function submitMicroPassReview(
  harness: Awaited<ReturnType<typeof createMicroReportHarness>>,
) {
  const review = harness.body("QualityReview");
  review.decision = "pass";
  review.workResultRefs = [];
  review.ruleCompliance = [];
  review.regressionChecks = [];
  review.verificationResults = [];
  review.taskContractRef = `artifact://${harness.runId}/contract-01`;
  review.workPlanRefs = [`artifact://${harness.runId}/plan-01`];
  review.acceptanceResults = [
    {
      criterionId: "AC-1",
      status: "pass",
      evidenceRefs: [`artifact://${harness.runId}/plan-01`],
      rationaleSummary: "Spot-check passed with plan deliverable.",
    },
  ];
  review.hardGates = [
    {
      id: "spot-primary",
      passed: true,
      description: "Primary criterion satisfied.",
      evidenceRefs: [`artifact://${harness.runId}/plan-01`],
      rationaleSummary: "Spot-check passed.",
    },
  ];
  harness.submit("QualityReview", "quality_controller", review);
}

afterEach(() => {
  for (const service of services.splice(0)) service.close();
});

describe("CAGT loop 1 conformance", () => {
  it("rejects micro UserReport completion claims that cite missing evidence", async () => {
    const harness = await createMicroReportHarness();
    submitMicroFrame(harness);
    submitMicroPassReview(harness);

    const report = harness.body("UserReport");
    report.terminalStatus = "completed";
    report.completionClaims = [
      {
        id: "claim-bad",
        text: "Unsupported claim.",
        status: "observed",
        evidenceRefs: [`artifact://${harness.runId}/missing-evidence`],
        confidence: 1,
      },
    ];
    report.findingRefs = [];
    report.changeRefs = [];
    report.verificationRefs = [];
    report.traceRef = `trace://${harness.runId}`;

    expect(() =>
      harness.submit("UserReport", "release_auditor", report),
    ).toThrow(/Artifact reference does not exist|must target direct evidence/);
  });

  it("escalates micro spot partial to standard and records topology_escalated", async () => {
    const harness = await createMicroReportHarness();
    submitMicroFrame(harness);

    const review = harness.body("QualityReview");
    review.decision = "partial";
    review.workResultRefs = [];
    review.ruleCompliance = [];
    review.regressionChecks = [];
    review.verificationResults = [];
    review.taskContractRef = `artifact://${harness.runId}/contract-01`;
    review.workPlanRefs = [`artifact://${harness.runId}/plan-01`];
    review.acceptanceResults = [
      {
        criterionId: "AC-1",
        status: "fail",
        evidenceRefs: [`artifact://${harness.runId}/plan-01`],
        rationaleSummary: "Spot-check found a gap.",
      },
    ];
    review.hardGates = [
      {
        id: "spot-primary",
        passed: false,
        description: "Primary criterion incomplete.",
        evidenceRefs: [`artifact://${harness.runId}/plan-01`],
        rationaleSummary: "Spot-check found a gap.",
      },
    ];
    review.score = 55;
    review.remainingRemediations = 1;
    review.remediationWorkOrder = null;
    const escalated = harness.submit(
      "QualityReview",
      "quality_controller",
      review,
    );

    expect(escalated.run.topology).toBe("standard");
    expect(escalated.run.phase).toBe("agent_1_review");
    expect(
      harness.service
        .getTrace(harness.runId)
        .some(
          (event) =>
            event.eventType === "topology_escalated" &&
            event.rationaleSummary === "MICRO_SPOT_PARTIAL",
        ),
    ).toBe(true);
    expect(harness.service.getRun(harness.runId).run.topology).toBe("standard");
  });

  it("classifies short fix_only with write capability as micro", () => {
    const repositoryRoot = mkdtempSync(join(tmpdir(), "telic-cagt-classify-"));
    const service = new TelicService({
      repositoryRoot,
      stateDirectory: mkdtempSync(join(tmpdir(), "telic-cagt-classify-state-")),
    });
    services.push(service);
    const started = service.startRun({
      originalRequest: "Fix typo in src/foo.ts: bar→baz",
      mode: "fix_only",
      hostName: "cagt-loop1",
      hostCapabilities: ["repository.read", "repository.write"],
      authorizationGranted: ["repository.read", "repository.write"],
    });
    expect(started.run.topology).toBe("micro");
  });
});
