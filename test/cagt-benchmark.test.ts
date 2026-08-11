import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { TelicService } from "../packages/mcp/src/service.js";
import {
  VALID_ARTIFACT_BODIES,
  HASH,
} from "../packages/protocol/test/test-helpers.js";

type Scorecard = {
  topology: string;
  mode: string;
  expectedPhases: string[];
  maxPhases: number;
  requiresReleaseAudit: boolean;
  requiresPromptReview: boolean;
  requiresReceiptAudit?: boolean;
};

const services: TelicService[] = [];

afterEach(() => {
  for (const service of services.splice(0)) service.close();
});

function loadScorecard(name: string): Scorecard {
  return JSON.parse(
    readFileSync(
      join(process.cwd(), "test/fixtures/cagt-benchmark", `${name}.json`),
      "utf8",
    ),
  ) as Scorecard;
}

describe("CAGT benchmark scorecards", () => {
  it("micro report_only matches the scorecard", async () => {
    const scorecard = loadScorecard("micro-report-only");
    const repositoryRoot = mkdtempSync(join(tmpdir(), "telic-cagt-benchmark-"));
    mkdirSync(join(repositoryRoot, "src"), { recursive: true });
    writeFileSync(
      join(repositoryRoot, "src", "index.ts"),
      "export const x = 1;\n",
    );
    const service = new TelicService({
      repositoryRoot,
      stateDirectory: mkdtempSync(
        join(tmpdir(), "telic-cagt-benchmark-state-"),
      ),
    });
    services.push(service);

    const started = service.startRun({
      originalRequest: "What does src/index.ts export?",
      mode: scorecard.mode as "report_only",
      hostName: "cagt-benchmark",
      nativeSubagents: "unavailable",
      hostCapabilities: ["repository.read"],
      authorizationGranted: ["repository.read"],
    });
    expect(started.run.topology).toBe(scorecard.topology);
    await service.groundContext({ runId: started.run.runId });

    const records = service.getRun(started.run.runId).artifacts;
    const request = records.find((artifact) => artifact.type === "UserMessage");
    if (!request) throw new Error("request artifact expected");
    const bind = (type: keyof typeof VALID_ARTIFACT_BODIES) => {
      const json = JSON.stringify(structuredClone(VALID_ARTIFACT_BODIES[type]))
        .replaceAll("run-01", started.run.runId)
        .replaceAll("user-message-01", request.id);
      return JSON.parse(json) as Record<string, unknown>;
    };
    const submit = (
      type: string,
      producer: string,
      body: Record<string, unknown>,
    ) =>
      service.submitArtifact({
        id: body.id as string,
        runId: started.run.runId,
        type,
        schemaVersion: "1.0",
        producer,
        body,
      });

    const frame = bind("ProblemFrame");
    frame.intentMode = scorecard.mode;
    frame.applicableRuleRefs = [];
    frame.scope = { include: ["src"], exclude: [] };
    frame.constraints = [];
    frame.nonGoals = [];
    submit("ProblemFrame", "scenario_author", frame);

    const review = bind("QualityReview");
    review.decision = "pass";
    review.workResultRefs = [];
    review.ruleCompliance = [];
    review.regressionChecks = [];
    review.verificationResults = [];
    review.taskContractRef = `artifact://${started.run.runId}/contract-01`;
    review.workPlanRefs = [`artifact://${started.run.runId}/plan-01`];
    review.acceptanceResults = [
      {
        criterionId: "AC-1",
        status: "pass",
        evidenceRefs: [`artifact://${started.run.runId}/plan-01`],
        rationaleSummary: "Spot-check passed with plan deliverable.",
      },
    ];
    review.hardGates = [
      {
        id: "spot-primary",
        passed: true,
        description: "Primary criterion satisfied.",
        evidenceRefs: [`artifact://${started.run.runId}/plan-01`],
        rationaleSummary: "Spot-check passed.",
      },
    ];
    submit("QualityReview", "quality_controller", review);

    const report = bind("UserReport");
    report.terminalStatus = "completed";
    report.completionClaims = [
      {
        id: "completion-01",
        text: "The micro report_only workflow completed.",
        status: "observed",
        evidenceRefs: [`artifact://${started.run.runId}/plan-01`],
        confidence: 1,
      },
    ];
    report.findingRefs = [];
    report.changeRefs = [];
    report.verificationRefs = [];
    report.traceRef = `trace://${started.run.runId}`;
    const terminal = submit("UserReport", "release_auditor", report);

    expect(terminal.run.status).toBe("completed");
    const artifactTypes = service
      .getRun(started.run.runId)
      .artifacts.map((artifact) => artifact.type);
    expect(artifactTypes.includes("PromptReview")).toBe(
      scorecard.requiresPromptReview,
    );
    expect(artifactTypes.includes("ReleaseAudit")).toBe(
      scorecard.requiresReleaseAudit,
    );
    if (scorecard.requiresReceiptAudit !== undefined) {
      expect(artifactTypes.includes("ReceiptAudit")).toBe(
        scorecard.requiresReceiptAudit,
      );
    }

    const phases = new Set(
      service
        .getTrace(started.run.runId)
        .map((event) => event.phase)
        .filter((phase) => phase !== "terminal"),
    );
    expect(phases.size).toBeLessThanOrEqual(scorecard.maxPhases);
    for (const phase of scorecard.expectedPhases) {
      expect(phases.has(phase)).toBe(true);
    }
  });

  it("micro fix_only matches the scorecard", async () => {
    const scorecard = loadScorecard("micro-fix-only");
    const repositoryRoot = mkdtempSync(
      join(tmpdir(), "telic-cagt-benchmark-fix-"),
    );
    mkdirSync(join(repositoryRoot, "src"), { recursive: true });
    writeFileSync(
      join(repositoryRoot, "src", "foo.ts"),
      "export const bar = 1;\n",
    );
    const service = new TelicService({
      repositoryRoot,
      stateDirectory: mkdtempSync(
        join(tmpdir(), "telic-cagt-benchmark-fix-state-"),
      ),
    });
    services.push(service);

    const started = service.startRun({
      originalRequest: "Fix typo in src/foo.ts: bar→baz",
      mode: scorecard.mode as "fix_only",
      hostName: "cagt-benchmark",
      nativeSubagents: "unavailable",
      hostCapabilities: ["repository.read", "repository.write"],
      authorizationGranted: ["repository.read", "repository.write"],
    });
    expect(started.run.topology).toBe(scorecard.topology);
    await service.groundContext({ runId: started.run.runId });

    const request = service
      .getRun(started.run.runId)
      .artifacts.find((artifact) => artifact.type === "UserMessage");
    if (!request) throw new Error("request artifact expected");
    const bind = (type: keyof typeof VALID_ARTIFACT_BODIES) => {
      const json = JSON.stringify(structuredClone(VALID_ARTIFACT_BODIES[type]))
        .replaceAll("run-01", started.run.runId)
        .replaceAll("user-message-01", request.id);
      return JSON.parse(json) as Record<string, unknown>;
    };
    const submit = (
      type: string,
      producer: string,
      body: Record<string, unknown>,
    ) =>
      service.submitArtifact({
        id: body.id as string,
        runId: started.run.runId,
        type,
        schemaVersion: "1.0",
        producer,
        body,
      });

    const frame = bind("ProblemFrame");
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

    const result = bind("WorkResult");
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

    const review = bind("QualityReview");
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

    const report = bind("UserReport");
    report.terminalStatus = "completed";
    report.completionClaims = [
      {
        id: "completion-01",
        text: "The micro fix_only workflow completed.",
        status: "observed",
        evidenceRefs: [`artifact://${started.run.runId}/${evidenceId}`],
        confidence: 1,
      },
    ];
    report.findingRefs = [];
    report.changeRefs = [`artifact://${started.run.runId}/${evidenceId}`];
    report.verificationRefs = [`artifact://${started.run.runId}/${evidenceId}`];
    report.traceRef = `trace://${started.run.runId}`;
    const terminal = submit("UserReport", "release_auditor", report);

    expect(terminal.run.status).toBe("completed");
    const artifactTypes = service
      .getRun(started.run.runId)
      .artifacts.map((artifact) => artifact.type);
    expect(artifactTypes.includes("ReleaseAudit")).toBe(
      scorecard.requiresReleaseAudit,
    );
    if (scorecard.requiresReceiptAudit !== undefined) {
      expect(artifactTypes.includes("ReceiptAudit")).toBe(
        scorecard.requiresReceiptAudit,
      );
    }
    const phases = new Set(
      service
        .getTrace(started.run.runId)
        .map((event) => event.phase)
        .filter((phase) => phase !== "terminal"),
    );
    expect(phases.size).toBeLessThanOrEqual(scorecard.maxPhases);
    for (const phase of scorecard.expectedPhases) {
      expect(phases.has(phase)).toBe(true);
    }
  });
});

describe("CAGT benchmark topology scorecards", () => {
  it("standard report_only selects the standard topology", () => {
    const scorecard = loadScorecard("standard-report-only");
    const repositoryRoot = mkdtempSync(join(tmpdir(), "telic-cagt-standard-"));
    mkdirSync(join(repositoryRoot, "src"), { recursive: true });
    writeFileSync(
      join(repositoryRoot, "src", "index.ts"),
      "export const x = 1;\n",
    );
    const service = new TelicService({
      repositoryRoot,
      stateDirectory: mkdtempSync(join(tmpdir(), "telic-cagt-standard-state-")),
    });
    services.push(service);
    const started = service.startRun({
      originalRequest:
        "Summarize how packages/core and packages/mcp interact in a short report.",
      mode: scorecard.mode as "report_only",
      topologyOverride: "standard",
      hostName: "cagt-benchmark",
      nativeSubagents: "unavailable",
      hostCapabilities: ["repository.read"],
      authorizationGranted: ["repository.read"],
    });
    expect(started.run.topology).toBe(scorecard.topology);
  });

  it("forensic analyze_and_fix selects the forensic topology", () => {
    const scorecard = loadScorecard("forensic-analyze-fix");
    const repositoryRoot = mkdtempSync(join(tmpdir(), "telic-cagt-forensic-"));
    mkdirSync(join(repositoryRoot, "src"), { recursive: true });
    writeFileSync(
      join(repositoryRoot, "src", "index.ts"),
      "export const x = 1;\n",
    );
    const service = new TelicService({
      repositoryRoot,
      stateDirectory: mkdtempSync(join(tmpdir(), "telic-cagt-forensic-state-")),
    });
    services.push(service);
    const started = service.startRun({
      originalRequest:
        "Forensic analyze_and_fix: reproduce the regression, capture evidence, and remediate with digest verification.",
      mode: scorecard.mode as "analyze_and_fix",
      hostName: "cagt-benchmark",
      nativeSubagents: "unavailable",
      hostCapabilities: ["repository.read", "repository.write"],
      authorizationGranted: ["repository.read", "repository.write"],
    });
    expect(started.run.topology).toBe(scorecard.topology);
  });
});
