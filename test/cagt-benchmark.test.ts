import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { TelicService } from "../packages/mcp/src/service.js";
import { VALID_ARTIFACT_BODIES } from "../packages/protocol/test/test-helpers.js";

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
    writeFileSync(join(repositoryRoot, "src", "index.ts"), "export const x = 1;\n");
    const service = new TelicService({
      repositoryRoot,
      stateDirectory: mkdtempSync(join(tmpdir(), "telic-cagt-benchmark-state-")),
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
});
