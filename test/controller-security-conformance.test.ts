import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { TelicService } from "../packages/mcp/src/service.js";
import {
  HASH,
  NO_PERMISSIONS,
  READ_PERMISSIONS,
  VALID_ARTIFACT_BODIES,
} from "../packages/protocol/test/test-helpers.js";

type IntentMode =
  "report_only" | "plan_only" | "analyze_only" | "fix_only" | "analyze_and_fix";

type ArtifactBody = Record<string, any>;

interface Harness {
  service: TelicService;
  runId: string;
  originalRequestId: string;
  body: (type: keyof typeof VALID_ARTIFACT_BODIES) => ArtifactBody;
  submit: (
    type: string,
    producer: string,
    body: ArtifactBody,
    sourceRefs?: string[],
  ) => ReturnType<TelicService["submitArtifact"]>;
}

const ORIGINAL_REQUEST =
  "Investigate the apps/web client and apps/api communication boundary.";
const services: TelicService[] = [];

afterEach(() => {
  for (const service of services.splice(0)) service.close();
});

function bindTemplate(
  value: unknown,
  runId: string,
  requestId: string,
): unknown {
  if (typeof value === "string") {
    return value
      .replaceAll("run-01", runId)
      .replaceAll(
        `artifact://${runId}/user-message-01`,
        `artifact://${runId}/${requestId}`,
      )
      .replaceAll(
        `artifact://${runId}/browser-response-01`,
        `artifact://${runId}/evidence-01`,
      )
      .replaceAll(
        `artifact://${runId}/action-ledger-01`,
        `artifact://${runId}/evidence-01`,
      )
      .replaceAll("repo://apps/api/cors.ts", "repo://apps/web/src/api.ts")
      .replaceAll(`trace://${runId}/event-0042`, `trace://${runId}`);
  }
  if (Array.isArray(value)) {
    return value.map((child) => bindTemplate(child, runId, requestId));
  }
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [
        key,
        bindTemplate(child, runId, requestId),
      ]),
    );
  }
  return value;
}

async function createHarness(
  options: {
    mode?: IntentMode;
    hostCapabilities?: string[];
    shellExecuteAllowlist?: string[];
    nativeSubagents?: "available" | "unavailable" | "unknown";
  } = {},
): Promise<Harness> {
  const root = mkdtempSync(join(tmpdir(), "telic-conformance-repo-"));
  mkdirSync(join(root, "apps/web/src"), { recursive: true });
  mkdirSync(join(root, "apps/api"), { recursive: true });
  mkdirSync(join(root, "src"), { recursive: true });
  mkdirSync(join(root, "infra"), { recursive: true });
  writeFileSync(join(root, "AGENTS.md"), "# Rules\nPreserve authorization.\n");
  writeFileSync(
    join(root, "apps/web/src/api.ts"),
    "export const endpoint = '/api/projects';\n",
  );
  writeFileSync(
    join(root, "apps/api/cors.ts"),
    "export const allowedOrigins = ['http://localhost:5173'];\n",
  );
  writeFileSync(join(root, "src/allowed.ts"), "export const allowed = true;\n");
  writeFileSync(join(root, "infra/prod.yml"), "environment: production\n");

  const service = new TelicService({
    repositoryRoot: root,
    stateDirectory: mkdtempSync(join(tmpdir(), "telic-conformance-state-")),
  });
  services.push(service);
  const hostCapabilities = options.hostCapabilities ?? [
    "repository.read",
    "shell.inspect",
    "browser.inspect",
    "runtime.inspect",
  ];
  const started = service.startRun({
    originalRequest: ORIGINAL_REQUEST,
    mode: options.mode ?? "analyze_only",
    hostName: "conformance-host",
    nativeSubagents: options.nativeSubagents ?? "unavailable",
    hostCapabilities,
    authorizationGranted: hostCapabilities,
    shellExecuteAllowlist: options.shellExecuteAllowlist,
  });
  const originalRequest = service
    .getRun(started.run.runId)
    .artifacts.find((artifact) => artifact.type === "UserMessage");
  if (!originalRequest) throw new Error("original request artifact expected");

  const body = (type: keyof typeof VALID_ARTIFACT_BODIES) =>
    bindTemplate(
      structuredClone(VALID_ARTIFACT_BODIES[type]),
      started.run.runId,
      originalRequest.id,
    ) as ArtifactBody;
  const contextManifest = body("ContextManifest");
  service.controller.submitArtifact({
    id: contextManifest.id as string,
    runId: started.run.runId,
    type: "ContextManifest",
    schemaVersion: "1.0",
    producer: "controller",
    body: contextManifest,
  });
  const submit: Harness["submit"] = (
    type,
    producer,
    artifactBody,
    sourceRefs,
  ) =>
    service.submitArtifact({
      id: artifactBody.id as string,
      runId: started.run.runId,
      type,
      schemaVersion: "1.0",
      producer,
      body: artifactBody,
      ...(sourceRefs ? { sourceRefs } : {}),
    });

  return {
    service,
    runId: started.run.runId,
    originalRequestId: originalRequest.id,
    body,
    submit,
  };
}

function acceptContract(
  harness: Harness,
  mode: IntentMode,
  permissions: ArtifactBody = structuredClone(READ_PERMISSIONS),
): void {
  const frame = harness.body("ProblemFrame");
  frame.intentMode = mode;
  if (mode === "fix_only" || mode === "analyze_and_fix") {
    frame.nonGoals = [];
    frame.constraints = ["Remain inside the explicit permission scopes."];
  }
  harness.submit("ProblemFrame", "scenario_author", frame);

  const contract = harness.body("TaskContract");
  contract.intentMode = mode;
  contract.permissions = permissions;
  if (mode === "fix_only" || mode === "analyze_and_fix") {
    contract.nonGoals = [];
    contract.constraints = ["Remain inside the explicit permission scopes."];
    contract.verificationRequirements[0].capability = "repository.read";
  }
  harness.submit("TaskContract", "task_compiler", contract);
  harness.submit(
    "PromptReview",
    "scenario_author",
    harness.body("PromptReview"),
  );
}

function submitPlan(harness: Harness, plan: ArtifactBody): void {
  harness.submit("WorkPlan", "quality_controller", plan);
}

function captureEvidence(harness: Harness): void {
  harness.submit("Evidence", "executor", {
    schemaVersion: "1.0",
    id: "evidence-01",
    runId: harness.runId,
    kind: "browser",
    capturedAt: "2026-07-15T10:05:00Z",
    summary: "Captured bounded local evidence for the current work node.",
    contentType: "application/json",
    encoding: "utf8",
    content: '{"result":"bounded-local-evidence"}',
    sourceRefs: [],
    redactions: [],
    rationaleSummary: "The payload contains no credentials or personal data.",
  });
}

function advanceOrdinaryRunToAudit(harness: Harness): void {
  acceptContract(harness, "analyze_only");
  submitPlan(harness, harness.body("WorkPlan"));
  captureEvidence(harness);
  harness.submit("WorkResult", "executor", harness.body("WorkResult"));
  harness.submit(
    "QualityReview",
    "quality_controller",
    harness.body("QualityReview"),
  );
}

function scopedFixPermissions(): ArtifactBody {
  const permissions = structuredClone(NO_PERMISSIONS) as ArtifactBody;
  permissions.repository.read = ["**"];
  permissions.repository.write = ["src/**"];
  permissions.shell.inspect = true;
  permissions.shell.executeAllowlist = ["npm test"];
  return permissions;
}

async function scopedFixHarness(): Promise<Harness> {
  const harness = await createHarness({
    mode: "fix_only",
    hostCapabilities: [
      "repository.read",
      "repository.write",
      "shell.inspect",
      "shell.execute",
    ],
    shellExecuteAllowlist: ["npm test"],
  });
  acceptContract(harness, "fix_only", scopedFixPermissions());
  return harness;
}

describe("controller security and conformance", () => {
  describe("action target authorization", () => {
    it("rejects a repository action outside the WorkPlan node write scope", async () => {
      const harness = await scopedFixHarness();
      const plan = harness.body("WorkPlan");
      plan.nodes[0].allowedTools = ["repository.write", "repository.read"];
      plan.nodes[0].requiredCapabilities = [
        "repository.write",
        "repository.read",
      ];
      plan.nodes[0].permissions = scopedFixPermissions();
      submitPlan(harness, plan);
      captureEvidence(harness);

      const result = harness.body("WorkResult");
      result.actions = [
        {
          id: "write-outside-scope",
          capability: "repository.write",
          target: "infra/prod.yml",
          mutating: true,
          status: "completed",
          evidenceRefs: [`artifact://${harness.runId}/evidence-01`],
          rationaleSummary: "This target is outside the node write scope.",
        },
      ];

      expect(() => harness.submit("WorkResult", "executor", result)).toThrow(
        /target|scope|permission/i,
      );
    });

    it("rejects a changed file outside the WorkPlan node write scope", async () => {
      const harness = await scopedFixHarness();
      const plan = harness.body("WorkPlan");
      plan.nodes[0].allowedTools = ["repository.write", "repository.read"];
      plan.nodes[0].requiredCapabilities = [
        "repository.write",
        "repository.read",
      ];
      plan.nodes[0].permissions = scopedFixPermissions();
      submitPlan(harness, plan);
      captureEvidence(harness);

      const result = harness.body("WorkResult");
      result.actions = [
        {
          id: "write-allowed-target",
          capability: "repository.write",
          target: "src/allowed.ts",
          mutating: true,
          status: "completed",
          evidenceRefs: [`artifact://${harness.runId}/evidence-01`],
          rationaleSummary: "The declared action target is in scope.",
        },
      ];
      result.filesChanged = [
        {
          path: "infra/prod.yml",
          changeType: "modified",
          beforeHash: HASH,
          afterHash: HASH,
          diffRef: `artifact://${harness.runId}/evidence-01`,
        },
      ];

      expect(() => harness.submit("WorkResult", "executor", result)).toThrow(
        /file|path|scope|permission/i,
      );
    });

    it("rejects a shell command outside the node execute allowlist", async () => {
      const harness = await scopedFixHarness();
      const plan = harness.body("WorkPlan");
      plan.nodes[0].allowedTools = ["shell.execute", "repository.read"];
      plan.nodes[0].requiredCapabilities = ["shell.execute", "repository.read"];
      plan.nodes[0].permissions = scopedFixPermissions();
      submitPlan(harness, plan);
      captureEvidence(harness);

      const result = harness.body("WorkResult");
      result.actions = [
        {
          id: "unlisted-command",
          capability: "shell.execute",
          target: "rm -rf build",
          mutating: true,
          status: "completed",
          evidenceRefs: [`artifact://${harness.runId}/evidence-01`],
          rationaleSummary: "The command is not present in the allowlist.",
        },
      ];

      expect(() => harness.submit("WorkResult", "executor", result)).toThrow(
        /command|allowlist|target|permission/i,
      );
    });
  });

  it("rejects semantic claims that cite a TaskContract as execution evidence", async () => {
    const harness = await createHarness();
    acceptContract(harness, "analyze_only");
    submitPlan(harness, harness.body("WorkPlan"));
    const contractRef = `artifact://${harness.runId}/contract-01`;
    const result = harness.body("WorkResult");
    result.observations[0].evidenceRefs = [contractRef];
    result.inferences[0].evidenceRefs = [contractRef];
    result.actions[0].evidenceRefs = [contractRef];
    result.evidenceRefs = [contractRef];
    result.toolEventRefs = [];
    result.acceptanceCoverage[0].evidenceRefs = [contractRef];

    expect(() => harness.submit("WorkResult", "executor", result)).toThrow(
      /evidence.*(?:artifact|type)|artifact.*evidence/i,
    );
  });

  it("accepts a blocking ReleaseAudit that honestly records failed mode compliance", async () => {
    const harness = await createHarness();
    advanceOrdinaryRunToAudit(harness);
    const audit = harness.body("ReleaseAudit");
    audit.decision = "block";
    audit.modeCompliance = "fail";
    audit.userFidelity[0].status = "fail";
    audit.claimEvidenceMatrix[0].status = "unsupported";

    expect(() =>
      harness.submit("ReleaseAudit", "release_auditor", audit),
    ).not.toThrow();
  });

  it("routes an early contract block through a typed final UserReport", async () => {
    const harness = await createHarness();
    const frame = harness.body("ProblemFrame");
    harness.submit("ProblemFrame", "scenario_author", frame);
    harness.submit(
      "TaskContract",
      "task_compiler",
      harness.body("TaskContract"),
    );
    const review = harness.body("PromptReview");
    review.decision = "block";
    review.hardGates[0].passed = false;
    const blocked = harness.submit("PromptReview", "scenario_author", review);
    expect(blocked.nextAction).toMatchObject({
      kind: "phase",
      phase: "user_report",
      logicalRole: "release_auditor",
    });

    const report = harness.body("UserReport");
    report.terminalStatus = "blocked";
    report.completionClaims = [];
    report.findingRefs = [`artifact://${harness.runId}/prompt-review-01`];
    report.changeRefs = [];
    report.verificationRefs = [];
    report.permissionsHonored = true;
    report.summary = "Contract review blocked execution before any work began.";
    const terminal = harness.submit("UserReport", "release_auditor", report);
    expect(terminal.run.status).toBe("blocked");
    expect(terminal.nextAction).toMatchObject({
      kind: "terminal",
      status: "blocked",
      reportRef: `artifact://${harness.runId}/user-report-01`,
    });
  });

  it.each([
    ["block", "blocked"],
    ["partial", "partial"],
  ] as const)(
    "accepts an honest %s report after permissions were not honored",
    async (auditDecision, terminalStatus) => {
      const harness = await createHarness();
      advanceOrdinaryRunToAudit(harness);
      const audit = harness.body("ReleaseAudit");
      audit.decision = auditDecision;
      audit.modeCompliance = "fail";
      harness.submit("ReleaseAudit", "release_auditor", audit);

      const report = harness.body("UserReport");
      report.terminalStatus = terminalStatus;
      report.permissionsHonored = false;
      report.completionClaims = [];
      report.findingRefs = [`artifact://${harness.runId}/release-audit-01`];
      report.summary =
        "The run did not release because a permission violation was detected.";

      const submitted = harness.submit("UserReport", "release_auditor", report);
      expect(submitted.run.status).toBe(terminalStatus);
    },
  );

  it("rejects a completed UserReport claim that was not approved by ReleaseAudit", async () => {
    const harness = await createHarness();
    advanceOrdinaryRunToAudit(harness);
    harness.submit(
      "ReleaseAudit",
      "release_auditor",
      harness.body("ReleaseAudit"),
    );
    const report = harness.body("UserReport");
    report.completionClaims[0].id = "claim-unreviewed";
    report.completionClaims[0].text =
      "The production database was repaired and deployed.";
    report.summary = "An unreviewed production repair is claimed as complete.";

    expect(() =>
      harness.submit("UserReport", "release_auditor", report),
    ).toThrow(/claim.*(?:audit|release|approved|drift)/i);
  });

  it("preserves the original request after a delayed clarification", async () => {
    const harness = await createHarness();
    acceptContract(harness, "analyze_only");
    const clarification = harness.body("ClarificationRequest");
    clarification.evidenceInspected = ["repo://AGENTS.md"];
    harness.submit("ClarificationRequest", "quality_controller", clarification);
    harness.service.answerClarification(harness.runId, "local-only");

    const userMessages = harness.service
      .getRun(harness.runId)
      .artifacts.filter((artifact) => artifact.type === "UserMessage");
    expect(userMessages).toHaveLength(2);
    const followup = userMessages.find(
      (artifact) => artifact.id !== harness.originalRequestId,
    );
    if (!followup) throw new Error("clarification response artifact expected");
    const envelope = harness.service
      .getRun(harness.runId)
      .artifacts.find((artifact) => artifact.type === "RunEnvelope");
    if (!envelope) throw new Error("run envelope expected");
    expect(
      harness.service.getArtifact(harness.runId, envelope.id).body,
    ).toMatchObject({
      originalRequestRef: `artifact://${harness.runId}/${harness.originalRequestId}`,
    });

    const clarificationRequest = harness.service
      .getRun(harness.runId)
      .artifacts.find((artifact) => artifact.type === "ClarificationRequest");
    if (!clarificationRequest) {
      throw new Error("clarification request expected");
    }
    harness.submit("WorkPlan", "quality_controller", harness.body("WorkPlan"), [
      `artifact://${harness.runId}/${clarificationRequest.id}`,
      `artifact://${harness.runId}/${followup.id}`,
    ]);
    captureEvidence(harness);
    harness.submit("WorkResult", "executor", harness.body("WorkResult"));
    harness.submit(
      "QualityReview",
      "quality_controller",
      harness.body("QualityReview"),
    );

    const driftedAudit = harness.body("ReleaseAudit");
    driftedAudit.originalRequestRef = `artifact://${harness.runId}/${followup.id}`;
    expect(() =>
      harness.submit("ReleaseAudit", "release_auditor", driftedAudit),
    ).toThrow(/original|lineage/i);
    expect(() =>
      harness.submit(
        "ReleaseAudit",
        "release_auditor",
        harness.body("ReleaseAudit"),
      ),
    ).not.toThrow();
  });

  it.each(["failed", "blocked"] as const)(
    "does not unlock a dependent DAG node after a %s prerequisite",
    async (status) => {
      const harness = await createHarness();
      acceptContract(harness, "analyze_only");
      const plan = harness.body("WorkPlan");
      plan.nodes.push({
        ...structuredClone(plan.nodes[0]),
        id: "dependent-verification",
        dependsOn: ["investigate"],
        objective: "Verify only after the prerequisite succeeds.",
      });
      plan.globalBudgets.maximumToolCalls = 24;
      submitPlan(harness, plan);
      captureEvidence(harness);
      const result = harness.body("WorkResult");
      result.status = status;
      result.actions[0].status = status === "failed" ? "failed" : "skipped";
      result.acceptanceCoverage[0].status =
        status === "failed" ? "fail" : "unverified";
      result.unresolvedIssues = ["The prerequisite did not complete."];

      const submitted = harness.submit("WorkResult", "executor", result);
      expect(submitted.nextAction).not.toMatchObject({
        phase: "agent_4_execute",
        workNodeId: "dependent-verification",
      });
    },
  );

  describe("tool and subagent budgets", () => {
    it("rejects a WorkPlan whose node tool budgets exceed its global budget", async () => {
      const harness = await createHarness();
      acceptContract(harness, "analyze_only");
      const plan = harness.body("WorkPlan");
      plan.nodes[0].budgets.maximumToolCalls = 13;
      plan.globalBudgets.maximumToolCalls = 12;

      expect(() => submitPlan(harness, plan)).toThrow(/tool.*budget/i);
    });

    it("rejects a node child budget that exceeds its subagent permission", async () => {
      const harness = await createHarness();
      acceptContract(harness, "analyze_only");
      const plan = harness.body("WorkPlan");
      plan.nodes[0].budgets.maximumChildren = 3;
      plan.nodes[0].permissions.subagents = {
        spawn: false,
        maximumChildren: 0,
        maximumDepth: 0,
      };

      expect(() => submitPlan(harness, plan)).toThrow(
        /child|subagent|budget|permission/i,
      );
    });

    it("rejects a WorkResult that exceeds its node tool-call budget", async () => {
      const harness = await createHarness();
      acceptContract(harness, "analyze_only");
      const plan = harness.body("WorkPlan");
      plan.nodes[0].budgets.maximumToolCalls = 1;
      plan.globalBudgets.maximumToolCalls = 1;
      submitPlan(harness, plan);
      captureEvidence(harness);

      const result = harness.body("WorkResult");
      result.actions.push({
        ...structuredClone(result.actions[0]),
        id: "action-over-budget",
      });

      expect(() => harness.submit("WorkResult", "executor", result)).toThrow(
        /tool.*budget|budget.*tool/i,
      );
    });
  });
});
