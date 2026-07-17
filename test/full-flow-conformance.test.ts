import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { TelicService } from "../packages/mcp/src/service.js";
import {
  HASH,
  NO_PERMISSIONS,
  VALID_ARTIFACT_BODIES,
} from "../packages/protocol/test/test-helpers.js";

type IntentMode =
  "report_only" | "plan_only" | "analyze_only" | "fix_only" | "analyze_and_fix";

type ArtifactBody = Record<string, any>;

interface Harness {
  service: TelicService;
  runId: string;
  requestId: string;
  repositoryRef: string;
  ruleRef: string;
  traceEvidenceRef: string;
  body: (type: keyof typeof VALID_ARTIFACT_BODIES) => ArtifactBody;
  submit: (
    type: string,
    producer: string,
    body: ArtifactBody,
  ) => ReturnType<TelicService["submitArtifact"]>;
}

const services: TelicService[] = [];

afterEach(() => {
  for (const service of services.splice(0)) service.close();
});

function clonePermissions(
  repository: { read?: string[]; write?: string[] } = {},
): ArtifactBody {
  const permissions = structuredClone(NO_PERMISSIONS) as ArtifactBody;
  permissions.repository.read = repository.read ?? [];
  permissions.repository.write = repository.write ?? [];
  return permissions;
}

function modeCapabilities(mode: IntentMode): string[] {
  if (mode === "report_only") return [];
  if (mode === "fix_only" || mode === "analyze_and_fix") {
    return ["repository.read", "repository.write"];
  }
  return ["repository.read"];
}

function bindTemplate(
  value: unknown,
  runId: string,
  requestId: string,
  repositoryRef: string,
  ruleRef: string,
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
      .replaceAll("repo://apps/web/src/api.ts", repositoryRef)
      .replaceAll("repo://apps/api/cors.ts", repositoryRef)
      .replaceAll("repo://AGENTS.md", ruleRef)
      .replaceAll(`trace://${runId}/event-0042`, `trace://${runId}`);
  }
  if (Array.isArray(value)) {
    return value.map((child) =>
      bindTemplate(child, runId, requestId, repositoryRef, ruleRef),
    );
  }
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [
        key,
        bindTemplate(child, runId, requestId, repositoryRef, ruleRef),
      ]),
    );
  }
  return value;
}

async function createHarness(
  mode: IntentMode,
  options: { repositoryRoot?: string; activePaths?: string[] } = {},
): Promise<Harness> {
  const repositoryRoot =
    options.repositoryRoot ??
    mkdtempSync(join(tmpdir(), "telic-full-flow-repo-"));
  if (!options.repositoryRoot) {
    mkdirSync(join(repositoryRoot, "apps/web/src"), { recursive: true });
    mkdirSync(join(repositoryRoot, "apps/api"), { recursive: true });
    mkdirSync(join(repositoryRoot, "src"), { recursive: true });
    mkdirSync(join(repositoryRoot, "infra"), { recursive: true });
    writeFileSync(
      join(repositoryRoot, "AGENTS.md"),
      "# Rules\nPreserve intent, authorization, evidence, and tests.\n",
    );
    writeFileSync(
      join(repositoryRoot, "apps/web/src/api.ts"),
      "export const projectsEndpoint = '/api/projects';\n",
    );
    writeFileSync(
      join(repositoryRoot, "apps/api/cors.ts"),
      "export const allowedOrigins = ['http://localhost:5173'];\n",
    );
    writeFileSync(join(repositoryRoot, "src/existing.ts"), "export {};\n");
    writeFileSync(join(repositoryRoot, "infra/prod.yml"), "production: true\n");
  }

  const service = new TelicService({
    repositoryRoot,
    stateDirectory: mkdtempSync(join(tmpdir(), "telic-full-flow-state-")),
  });
  services.push(service);
  const capabilities = modeCapabilities(mode);
  const started = service.startRun({
    originalRequest:
      mode === "report_only"
        ? "Report the supplied communication-failure request without inspecting the repository."
        : "Investigate the apps/web API client and prepare only the authorized result.",
    mode,
    hostName: "full-flow-conformance-host",
    nativeSubagents: "unavailable",
    hostCapabilities: capabilities,
    authorizationGranted: capabilities,
  });
  const grounded = await service.groundContext({
    runId: started.run.runId,
    activePaths: options.activePaths ?? [
      "AGENTS.md",
      "apps/web/src/api.ts",
      "apps/api/cors.ts",
    ],
  });
  const records = service.getRun(started.run.runId).artifacts;
  const request = records.find((artifact) => artifact.type === "UserMessage");
  if (!request) throw new Error("immutable request artifact expected");

  const selectedRefs = new Set<string>(grounded.manifest.pinnedRefs);
  for (const candidate of grounded.manifest.candidates) {
    if (candidate.decision === "selected") selectedRefs.add(candidate.ref);
  }
  const repositoryRef = selectedRefs.has("repo://apps/web/src/api.ts")
    ? "repo://apps/web/src/api.ts"
    : [...selectedRefs].find(
        (ref) => ref.startsWith("repo://") && ref !== "repo://AGENTS.md",
      );
  if (mode !== "report_only" && !repositoryRef) {
    throw new Error("grounded repository reference expected");
  }
  const ruleRef = selectedRefs.has("repo://AGENTS.md")
    ? "repo://AGENTS.md"
    : (repositoryRef ?? "repo://AGENTS.md");
  const firstTrace = service.getTrace(started.run.runId).at(0);
  if (!firstTrace) throw new Error("run trace event expected");
  const traceEvidenceRef = `trace://${started.run.runId}/${firstTrace.id}`;

  const body = (type: keyof typeof VALID_ARTIFACT_BODIES) =>
    bindTemplate(
      structuredClone(VALID_ARTIFACT_BODIES[type]),
      started.run.runId,
      request.id,
      repositoryRef ?? "repo://unused-report-only",
      ruleRef,
    ) as ArtifactBody;
  const submit: Harness["submit"] = (type, producer, artifactBody) =>
    service.submitArtifact({
      id: artifactBody.id as string,
      runId: started.run.runId,
      type,
      schemaVersion: "1.0",
      producer,
      body: artifactBody,
    });

  return {
    service,
    runId: started.run.runId,
    requestId: request.id,
    repositoryRef: repositoryRef ?? "repo://unused-report-only",
    ruleRef,
    traceEvidenceRef,
    body,
    submit,
  };
}

function permissionsForMode(mode: IntentMode): ArtifactBody {
  if (mode === "report_only") return clonePermissions();
  if (mode === "fix_only" || mode === "analyze_and_fix") {
    return clonePermissions({ read: ["**"], write: ["src/**"] });
  }
  return clonePermissions({ read: ["**"] });
}

function acceptIntent(
  harness: Harness,
  mode: IntentMode,
  options: { includeSecondCompletionCriterion?: boolean } = {},
): void {
  const frame = harness.body("ProblemFrame");
  frame.intentMode = mode;
  frame.applicableRuleRefs = mode === "report_only" ? [] : [harness.ruleRef];
  if (mode === "fix_only" || mode === "analyze_and_fix") {
    frame.constraints = ["Writes are limited to src/**."];
    frame.nonGoals = ["Do not mutate infrastructure or production state."];
  }
  frame.draftAcceptanceCriteria[0].stage =
    mode === "analyze_and_fix" ? "diagnosis" : "completion";
  if (mode === "analyze_and_fix") {
    frame.draftAcceptanceCriteria.push({
      id: "AC-2",
      stage: "completion",
      requirement: "Apply and verify the bounded correction.",
      evidenceRequired: ["repository_diff_and_post_change_inspection"],
    });
    if (options.includeSecondCompletionCriterion) {
      frame.draftAcceptanceCriteria.push({
        id: "AC-3",
        stage: "completion",
        requirement: "Verify the second bounded completion condition.",
        evidenceRequired: ["second_completion_evidence"],
      });
    }
  }
  harness.submit("ProblemFrame", "scenario_author", frame);

  const contract = harness.body("TaskContract");
  contract.intentMode = mode;
  contract.contextRefs = mode === "report_only" ? [] : [harness.repositoryRef];
  contract.ruleRefs = mode === "report_only" ? [] : [harness.ruleRef];
  contract.permissions = permissionsForMode(mode);
  contract.acceptanceCriteria[0].stage =
    mode === "analyze_and_fix" ? "diagnosis" : "completion";
  if (mode === "analyze_and_fix") {
    contract.acceptanceCriteria.push({
      id: "AC-2",
      stage: "completion",
      requirement: "Apply and verify the bounded correction.",
      evidenceRequired: ["repository_diff_and_post_change_inspection"],
    });
    if (options.includeSecondCompletionCriterion) {
      contract.acceptanceCriteria.push({
        id: "AC-3",
        stage: "completion",
        requirement: "Verify the second bounded completion condition.",
        evidenceRequired: ["second_completion_evidence"],
      });
    }
  }
  contract.verificationRequirements =
    mode === "report_only" || mode === "plan_only"
      ? []
      : mode === "analyze_and_fix"
        ? [
            {
              id: "VR-DIAG",
              stage: "diagnosis",
              description: "Verify the supported diagnosis before mutation.",
              required: true,
              capability: "repository.read",
              fallback: "Report the diagnosis boundary honestly.",
            },
            {
              id: "VR-COMP",
              stage: "completion",
              description: "Inspect the corrected target after mutation.",
              required: true,
              capability: "repository.read",
              fallback: "Report failed post-change verification honestly.",
            },
          ]
        : [
            {
              id: "VR-1",
              stage: "completion",
              description: "Capture direct evidence for the bounded work.",
              required: true,
              capability: "repository.read",
              fallback: "Report the verification boundary honestly.",
            },
          ];
  if (mode === "fix_only" || mode === "analyze_and_fix") {
    contract.constraints = ["Writes are limited to src/**."];
    contract.nonGoals = ["Do not mutate infrastructure or production state."];
  }
  harness.submit("TaskContract", "task_compiler", contract);
  harness.submit(
    "PromptReview",
    "scenario_author",
    harness.body("PromptReview"),
  );
}

function makePlan(
  harness: Harness,
  mode: IntentMode,
  options: {
    id?: string;
    nodeId?: string;
    mutation?: boolean;
    inputRefs?: string[];
    maximumToolCalls?: number;
  } = {},
): ArtifactBody {
  const plan = harness.body("WorkPlan");
  const id = options.id ?? "plan-01";
  const nodeId = options.nodeId ?? "investigate";
  const mutation = options.mutation ?? mode === "fix_only";
  const maximumToolCalls =
    options.maximumToolCalls ?? (mode === "report_only" ? 0 : mutation ? 2 : 1);
  plan.id = id;
  plan.nodes[0].id = nodeId;
  plan.nodes[0].inputRefs = options.inputRefs ?? [
    `artifact://${harness.runId}/contract-01`,
  ];
  plan.nodes[0].contextRefs =
    mode === "report_only" ? [] : [harness.repositoryRef];
  plan.nodes[0].allowedTools =
    mode === "report_only"
      ? []
      : mutation
        ? ["repository.write", "repository.read"]
        : ["repository.read"];
  plan.nodes[0].requiredCapabilities =
    mode === "report_only"
      ? []
      : mutation
        ? ["repository.write", "repository.read"]
        : ["repository.read"];
  plan.nodes[0].permissions = mutation
    ? clonePermissions({ read: ["**"], write: ["src/**"] })
    : mode === "report_only"
      ? clonePermissions()
      : clonePermissions({ read: ["**"] });
  plan.nodes[0].budgets.maximumToolCalls = maximumToolCalls;
  plan.nodes[0].budgets.maximumChildren = 0;
  if (mode === "analyze_and_fix" && mutation) {
    plan.nodes[0].acceptanceCriteria = ["AC-2"];
  }
  plan.globalBudgets.maximumToolCalls = maximumToolCalls;
  plan.globalBudgets.maximumParallelWorkers = 1;
  plan.globalBudgets.maximumSubagentDepth = 0;
  plan.rationaleSummary = mutation
    ? "The serial plan permits one bounded src/** repository write."
    : "The serial plan remains within the selected non-mutating scope.";
  return plan;
}

function makeEvidence(
  harness: Harness,
  id = "evidence-01",
  content = '{"result":"bounded-direct-evidence"}',
  kind: "repository" | "diff" = "repository",
): ArtifactBody {
  return {
    schemaVersion: "1.0",
    id,
    runId: harness.runId,
    kind,
    capturedAt: "2026-07-15T10:05:00Z",
    summary: "Captured bounded repository evidence for the current work node.",
    contentType: "application/json",
    encoding: "utf8",
    content,
    sourceRefs: [],
    redactions: [],
    rationaleSummary: "The evidence is local, bounded, and contains no secret.",
  };
}

function captureEvidence(
  harness: Harness,
  id = "evidence-01",
  content?: string,
) {
  const mode = harness.service.getRun(harness.runId).run.requestedMode;
  const kind =
    mode === "fix_only" || (mode === "analyze_and_fix" && id !== "evidence-01")
      ? "diff"
      : "repository";
  return harness.submit(
    "Evidence",
    "executor",
    makeEvidence(harness, id, content, kind),
  );
}

function makeResult(
  harness: Harness,
  options: {
    id?: string;
    planId?: string;
    nodeId?: string;
    evidenceId?: string;
    mutation?: boolean;
    criterionId?: string;
  } = {},
): ArtifactBody {
  const result = harness.body("WorkResult");
  const id = options.id ?? "result-01";
  const planId = options.planId ?? "plan-01";
  const nodeId = options.nodeId ?? "investigate";
  const evidenceId = options.evidenceId ?? "evidence-01";
  const evidenceRef = `artifact://${harness.runId}/${evidenceId}`;
  const mutation = options.mutation ?? false;
  result.id = id;
  result.workPlanRef = `artifact://${harness.runId}/${planId}`;
  result.nodeId = nodeId;
  result.observations = [
    {
      id: `observation-${id}`,
      text: mutation
        ? "The bounded source correction was recorded."
        : "The selected request boundary was inspected.",
      status: "observed",
      evidenceRefs: [evidenceRef],
      confidence: 1,
    },
  ];
  result.inferences = [];
  result.actions = [
    {
      id: `action-${id}`,
      capability: mutation ? "repository.write" : "repository.read",
      target: mutation ? "src/fix.ts" : "apps/web/src/api.ts",
      mutating: mutation,
      status: "completed",
      evidenceRefs: [evidenceRef],
      rationaleSummary: mutation
        ? "The action stayed inside the authorized src/** write scope."
        : "The action read only the bounded repository target.",
    },
    ...(mutation
      ? [
          {
            id: `verify-${id}`,
            capability: "repository.read",
            target: "src/fix.ts",
            mutating: false,
            status: "completed",
            evidenceRefs: [evidenceRef],
            rationaleSummary:
              "The changed target was inspected after the bounded write.",
          },
        ]
      : []),
  ];
  result.filesChanged = mutation
    ? [
        {
          path: "src/fix.ts",
          changeType: "created",
          beforeHash: null,
          afterHash: HASH,
          diffRef: evidenceRef,
        },
      ]
    : [];
  result.toolEventRefs = [];
  result.evidenceRefs = [evidenceRef];
  result.testResults = [];
  result.acceptanceCoverage = [
    {
      criterionId: options.criterionId ?? "AC-1",
      status: "pass",
      evidenceRefs: [evidenceRef],
      rationaleSummary: "The direct evidence satisfies the bounded criterion.",
    },
  ];
  result.unresolvedIssues = [];
  result.deviations = [];
  result.rationaleSummary = "The bounded node completed with direct evidence.";
  return result;
}

function makeQualityReview(
  harness: Harness,
  options: {
    id?: string;
    planIds?: string[];
    resultIds?: string[];
    evidenceRef?: string;
    remainingRemediations?: number;
    decision?: "pass" | "proceed_to_fix" | "remediate" | "block" | "partial";
  } = {},
): ArtifactBody {
  const review = harness.body("QualityReview");
  const evidenceRef = options.evidenceRef ?? harness.traceEvidenceRef;
  review.id = options.id ?? "quality-review-01";
  review.workPlanRefs = (options.planIds ?? ["plan-01"]).map(
    (id) => `artifact://${harness.runId}/${id}`,
  );
  review.workResultRefs = (options.resultIds ?? []).map(
    (id) => `artifact://${harness.runId}/${id}`,
  );
  const mode = harness.service.getRun(harness.runId).run.requestedMode;
  const reviewCriteria =
    mode === "analyze_and_fix" && options.decision !== "proceed_to_fix"
      ? ["AC-1", "AC-2"]
      : ["AC-1"];
  review.acceptanceResults = reviewCriteria.map((criterionId) => ({
    criterionId,
    status: "pass",
    evidenceRefs: [
      criterionId === "AC-1" && mode === "analyze_and_fix"
        ? `artifact://${harness.runId}/evidence-01`
        : evidenceRef,
    ],
    rationaleSummary: "The criterion has direct bounded evidence.",
  }));
  review.ruleCompliance =
    mode === "report_only"
      ? []
      : [
          {
            id: `rule-${review.id}`,
            subjectRef: harness.ruleRef,
            description:
              "The result stayed inside the immutable mode and scope.",
            status: "pass",
            evidenceRefs: [evidenceRef],
            rationaleSummary: "The evidence and ledger show bounded work.",
          },
        ];
  review.regressionChecks = [];
  review.verificationResults =
    mode === "report_only" || mode === "plan_only"
      ? []
      : mode === "analyze_and_fix"
        ? [
            {
              requirementId: "VR-DIAG",
              capability: "repository.read",
              status: "pass",
              evidenceRefs: [`artifact://${harness.runId}/evidence-01`],
              rationaleSummary:
                "The diagnosis capability completed with direct evidence.",
            },
            ...(options.decision === "proceed_to_fix"
              ? []
              : [
                  {
                    requirementId: "VR-COMP",
                    capability: "repository.read",
                    status: "pass",
                    evidenceRefs: [evidenceRef],
                    rationaleSummary:
                      "The post-change capability completed with direct evidence.",
                  },
                ]),
          ]
        : [
            {
              requirementId: "VR-1",
              capability: "repository.read",
              status: "pass",
              evidenceRefs: [evidenceRef],
              rationaleSummary:
                "The contracted capability completed with direct evidence.",
            },
          ];
  review.findings = [];
  review.hardGates = [
    {
      id: `gate-${review.id}`,
      passed: true,
      description: "Acceptance and authorization are evidence-backed.",
      evidenceRefs: [evidenceRef],
      rationaleSummary: "No blocking defect remains in this review.",
    },
  ];
  review.score = 100;
  review.remainingRemediations = options.remainingRemediations ?? 1;
  review.decision = options.decision ?? "pass";
  review.diagnosisGate = null;
  review.remediationWorkOrder = null;
  review.rationaleSummary = "The current work is evidence-backed and bounded.";
  return review;
}

function makeReleaseAudit(
  harness: Harness,
  options: {
    planIds?: string[];
    resultIds?: string[];
    qualityId?: string;
    evidenceRef?: string;
    decision?: "release" | "partial" | "block";
    remainingRemediations?: number;
  } = {},
): ArtifactBody {
  const audit = harness.body("ReleaseAudit");
  const decision = options.decision ?? "release";
  const evidenceRef = options.evidenceRef ?? harness.traceEvidenceRef;
  audit.workPlanRefs = (options.planIds ?? ["plan-01"]).map(
    (id) => `artifact://${harness.runId}/${id}`,
  );
  audit.workResultRefs = (options.resultIds ?? []).map(
    (id) => `artifact://${harness.runId}/${id}`,
  );
  audit.qualityReviewRef = `artifact://${harness.runId}/${options.qualityId ?? "quality-review-01"}`;
  audit.userFidelity = [
    {
      id: "fidelity-01",
      subjectRef: `artifact://${harness.runId}/${harness.requestId}`,
      description: "The terminal result remains faithful to the request.",
      status: "pass",
      evidenceRefs: [evidenceRef],
      rationaleSummary: "The audited result stays inside the requested mode.",
    },
  ];
  audit.modeCompliance = "pass";
  audit.claimEvidenceMatrix =
    decision === "release"
      ? [
          {
            claimId: "completion-01",
            claim:
              "The authorized Telic workflow completed with direct evidence.",
            criterionIds:
              harness.service.getRun(harness.runId).run.requestedMode ===
              "analyze_and_fix"
                ? ["AC-1", "AC-2"]
                : ["AC-1"],
            basis: "direct",
            status: "supported",
            evidenceRefs: [evidenceRef],
            rationaleSummary: "The cited evidence supports this exact claim.",
          },
        ]
      : [];
  audit.unresolvedRisks =
    decision === "release"
      ? []
      : [`The ${decision} audit retained an unresolved release boundary.`];
  audit.findings = [];
  audit.remainingRemediations = options.remainingRemediations ?? 1;
  audit.decision = decision;
  audit.remediationDefect = null;
  audit.userReportRef = `artifact://${harness.runId}/user-report-01`;
  audit.rationaleSummary =
    decision === "release"
      ? "The evidence, fidelity, and mode checks permit release."
      : `The audit requires an honest ${decision} terminal report.`;
  return audit;
}

function makeUserReport(
  harness: Harness,
  terminalStatus: "completed" | "partial" | "blocked" | "failed_verification",
  evidenceRef = harness.traceEvidenceRef,
): ArtifactBody {
  const report = harness.body("UserReport");
  report.terminalStatus = terminalStatus;
  report.summary = `The Telic run reached ${terminalStatus} with an evidence-backed audit.`;
  report.completionClaims =
    terminalStatus === "completed"
      ? [
          {
            id: "completion-01",
            text: "The authorized Telic workflow completed with direct evidence.",
            status: "observed",
            evidenceRefs: [evidenceRef],
            confidence: 1,
          },
        ]
      : [];
  const runArtifacts = harness.service.getRun(harness.runId).artifacts;
  const controllingRecord = [...runArtifacts]
    .reverse()
    .find(
      (artifact) =>
        artifact.type === "ReleaseAudit" || artifact.type === "PromptReview",
    );
  report.findingRefs =
    terminalStatus === "completed" || !controllingRecord
      ? []
      : [`artifact://${harness.runId}/${controllingRecord.id}`];
  report.changeRefs = [
    ...new Set(
      runArtifacts
        .filter((artifact) => artifact.type === "WorkResult")
        .flatMap((artifact) => {
          const body = harness.service.getArtifact(harness.runId, artifact.id)
            .body as { filesChanged?: Array<{ diffRef?: unknown }> };
          return (body.filesChanged ?? [])
            .map((change) => change.diffRef)
            .filter(
              (reference): reference is string => typeof reference === "string",
            );
        }),
    ),
  ];
  const mode = harness.service.getRun(harness.runId).run.requestedMode;
  report.verificationRefs =
    terminalStatus === "completed" &&
    mode !== "report_only" &&
    mode !== "plan_only"
      ? mode === "analyze_and_fix"
        ? [`artifact://${harness.runId}/evidence-01`, evidenceRef]
        : [evidenceRef]
      : [];
  report.unresolvedRisks =
    terminalStatus === "completed"
      ? []
      : terminalStatus === "failed_verification"
        ? ["The required verification did not complete."]
        : [`The run ended ${terminalStatus} with an unresolved boundary.`];
  report.permissionsHonored = true;
  report.nextActions = [];
  report.traceRef = `trace://${harness.runId}`;
  report.rationaleSummary =
    "The report mirrors the independent release decision.";
  return report;
}

async function completeSimpleMode(
  mode: Exclude<IntentMode, "analyze_and_fix">,
) {
  const harness = await createHarness(mode);
  acceptIntent(harness, mode);
  const plan = makePlan(harness, mode);
  const planned = harness.submit("WorkPlan", "quality_controller", plan);
  const executes = mode === "analyze_only" || mode === "fix_only";
  let evidenceRef = `artifact://${harness.runId}/plan-01`;
  const resultIds: string[] = [];
  if (executes) {
    expect(planned.nextAction).toMatchObject({
      kind: "phase",
      phase: "agent_4_execute",
    });
    captureEvidence(harness);
    evidenceRef = `artifact://${harness.runId}/evidence-01`;
    harness.submit(
      "WorkResult",
      "executor",
      makeResult(harness, { mutation: mode === "fix_only" }),
    );
    resultIds.push("result-01");
  } else {
    expect(planned.nextAction).toMatchObject({
      kind: "phase",
      phase: "agent_3_quality_review",
    });
  }
  harness.submit(
    "QualityReview",
    "quality_controller",
    makeQualityReview(harness, { resultIds, evidenceRef }),
  );
  harness.submit(
    "ReleaseAudit",
    "release_auditor",
    makeReleaseAudit(harness, { resultIds, evidenceRef }),
  );
  const terminal = harness.submit(
    "UserReport",
    "release_auditor",
    makeUserReport(harness, "completed", evidenceRef),
  );
  return { harness, terminal, executes };
}

async function advanceAnalyzeRunToAudit(
  failedVerification = false,
  options: { repositoryRoot?: string; activePaths?: string[] } = {},
) {
  const harness = await createHarness("analyze_only", options);
  acceptIntent(harness, "analyze_only");
  harness.submit(
    "WorkPlan",
    "quality_controller",
    makePlan(harness, "analyze_only"),
  );
  captureEvidence(harness);
  harness.submit("WorkResult", "executor", makeResult(harness));
  const review = makeQualityReview(harness, {
    resultIds: ["result-01"],
    evidenceRef: `artifact://${harness.runId}/evidence-01`,
    decision: failedVerification ? "partial" : "pass",
  });
  if (failedVerification) {
    review.verificationResults[0].status = "unverified";
    review.verificationResults[0].evidenceRefs = [];
  }
  harness.submit("QualityReview", "quality_controller", review);
  return harness;
}

describe("TelicService full-flow conformance", () => {
  it.each(["report_only", "plan_only", "analyze_only", "fix_only"] as const)(
    "drives %s through its legal completed terminal",
    async (mode) => {
      const { harness, terminal, executes } = await completeSimpleMode(mode);
      expect(terminal.run).toMatchObject({
        requestedMode: mode,
        status: "completed",
      });
      expect(terminal.nextAction).toMatchObject({
        kind: "terminal",
        status: "completed",
        reportRef: `artifact://${harness.runId}/user-report-01`,
      });
      const types = harness.service
        .getRun(harness.runId)
        .artifacts.map((artifact) => artifact.type);
      expect(types.includes("WorkResult")).toBe(executes);
      expect(types).toEqual(
        expect.arrayContaining([
          "ProblemFrame",
          "TaskContract",
          "PromptReview",
          "WorkPlan",
          "QualityReview",
          "ReleaseAudit",
          "UserReport",
        ]),
      );
    },
  );

  it("drives the recommendation-bias fixture to an honest browser-unavailable report", async () => {
    const fixtureSource = join(
      process.cwd(),
      "test/fixtures/demo/recommendation-bias",
    );
    const repositoryRoot = mkdtempSync(
      join(tmpdir(), "telic-recommendation-bias-"),
    );
    cpSync(fixtureSource, repositoryRoot, { recursive: true });
    const rankingPath = join(repositoryRoot, "src/ranking.ts");
    const before = readFileSync(rankingPath, "utf8");
    const harness = await advanceAnalyzeRunToAudit(true, {
      repositoryRoot,
      activePaths: ["AGENTS.md", "src/ranking.ts"],
    });
    const audit = makeReleaseAudit(harness, {
      resultIds: ["result-01"],
      evidenceRef: `artifact://${harness.runId}/evidence-01`,
      decision: "partial",
    });
    audit.userFidelity[0].status = "unverified";
    audit.claimEvidenceMatrix = [
      {
        claimId: "browser-verification-01",
        claim: "Browser or runtime evidence confirmed the data-bias cause.",
        criterionIds: ["AC-1"],
        basis: "direct",
        status: "unverified",
        evidenceRefs: [],
        rationaleSummary:
          "The deterministic fixture has repository evidence only; browser and runtime evidence were unavailable.",
      },
    ];
    audit.unresolvedRisks = [
      "Input-data bias remains unverified because browser and runtime evidence were unavailable.",
    ];
    harness.submit("ReleaseAudit", "release_auditor", audit);
    const report = makeUserReport(harness, "failed_verification");
    report.unresolvedRisks = [...audit.unresolvedRisks];
    const terminal = harness.submit("UserReport", "release_auditor", report);

    expect(terminal.nextAction).toMatchObject({
      kind: "terminal",
      status: "failed_verification",
    });
    expect(
      harness.service
        .getRun(harness.runId)
        .artifacts.map((artifact) => artifact.type),
    ).toEqual(
      expect.arrayContaining([
        "ProblemFrame",
        "TaskContract",
        "PromptReview",
        "WorkPlan",
        "Evidence",
        "WorkResult",
        "QualityReview",
        "ReleaseAudit",
        "UserReport",
      ]),
    );
    expect(harness.repositoryRef).toBe("repo://src/ranking.ts");
    expect(readFileSync(rankingPath, "utf8")).toBe(before);
  });

  it("drives analyze_and_fix through a supported diagnosis gate and bounded fix", async () => {
    const harness = await createHarness("analyze_and_fix");
    acceptIntent(harness, "analyze_and_fix");
    harness.submit(
      "WorkPlan",
      "quality_controller",
      makePlan(harness, "analyze_and_fix"),
    );
    captureEvidence(harness);
    harness.submit("WorkResult", "executor", makeResult(harness));

    const diagnosisReview = makeQualityReview(harness, {
      resultIds: ["result-01"],
      evidenceRef: `artifact://${harness.runId}/evidence-01`,
      decision: "proceed_to_fix",
    });
    diagnosisReview.diagnosisGate = {
      id: "diagnosis-gate-01",
      status: "supported",
      rootCause: "The captured repository evidence supports the bounded cause.",
      directEvidenceRefs: [`artifact://${harness.runId}/evidence-01`],
      correctionWorkOrder: {
        id: "correction-01",
        targetCriterionIds: ["AC-2"],
        objective: "Create the contract-bounded src/fix.ts correction.",
        allowedCapabilities: ["repository.write", "repository.read"],
        permissions: clonePermissions({ read: ["**"], write: ["src/**"] }),
        sourceRefs: [`artifact://${harness.runId}/evidence-01`],
        maximumToolCalls: 2,
        rationaleSummary:
          "The order binds the supported diagnosis to one scoped correction.",
      },
      withinApprovedScope: true,
      permissionsSufficient: true,
      rationaleSummary:
        "Direct evidence, scope, and authority permit a fix plan.",
    };
    const gated = harness.submit(
      "QualityReview",
      "quality_controller",
      diagnosisReview,
    );
    expect(gated.nextAction).toMatchObject({
      phase: "agent_3_plan",
      effectivePermissions: {
        repository: { write: [] },
      },
    });

    const fixPlan = makePlan(harness, "analyze_and_fix", {
      id: "plan-02",
      nodeId: "fix",
      mutation: true,
      inputRefs: [
        `artifact://${harness.runId}/contract-01`,
        `artifact://${harness.runId}/quality-review-01`,
      ],
    });
    const authorizedFix = harness.submit(
      "WorkPlan",
      "quality_controller",
      fixPlan,
    );
    expect(authorizedFix.nextAction).toMatchObject({
      phase: "agent_4_execute",
      workNodeId: "fix",
      effectivePermissions: {
        repository: { write: ["src/**"] },
      },
    });
    captureEvidence(harness, "evidence-02", '{"diff":"bounded-fix"}');
    harness.submit(
      "WorkResult",
      "executor",
      makeResult(harness, {
        id: "result-02",
        planId: "plan-02",
        nodeId: "fix",
        evidenceId: "evidence-02",
        mutation: true,
        criterionId: "AC-2",
      }),
    );
    harness.submit(
      "QualityReview",
      "quality_controller",
      makeQualityReview(harness, {
        id: "quality-review-02",
        planIds: ["plan-02"],
        resultIds: ["result-02"],
        evidenceRef: `artifact://${harness.runId}/evidence-02`,
      }),
    );
    harness.submit(
      "ReleaseAudit",
      "release_auditor",
      makeReleaseAudit(harness, {
        planIds: ["plan-01", "plan-02"],
        resultIds: ["result-01", "result-02"],
        qualityId: "quality-review-02",
        evidenceRef: `artifact://${harness.runId}/evidence-02`,
      }),
    );
    const terminal = harness.submit(
      "UserReport",
      "release_auditor",
      makeUserReport(
        harness,
        "completed",
        `artifact://${harness.runId}/evidence-02`,
      ),
    );

    expect(terminal.run.status).toBe("completed");
    expect(
      harness.service
        .getRun(harness.runId)
        .artifacts.filter((artifact) => artifact.type === "WorkPlan"),
    ).toHaveLength(2);
  });

  it("requires the diagnosis correction order to cover every completion criterion", async () => {
    const harness = await createHarness("analyze_and_fix");
    acceptIntent(harness, "analyze_and_fix", {
      includeSecondCompletionCriterion: true,
    });
    harness.submit(
      "WorkPlan",
      "quality_controller",
      makePlan(harness, "analyze_and_fix"),
    );
    captureEvidence(harness);
    harness.submit("WorkResult", "executor", makeResult(harness));

    const diagnosisReview = makeQualityReview(harness, {
      resultIds: ["result-01"],
      evidenceRef: `artifact://${harness.runId}/evidence-01`,
      decision: "proceed_to_fix",
    });
    diagnosisReview.diagnosisGate = {
      id: "diagnosis-gate-incomplete",
      status: "supported",
      rootCause: "The diagnosis is supported, but the fix order is incomplete.",
      directEvidenceRefs: [`artifact://${harness.runId}/evidence-01`],
      correctionWorkOrder: {
        id: "correction-incomplete",
        targetCriterionIds: ["AC-2"],
        objective: "Incorrectly omit AC-3 from the correction order.",
        allowedCapabilities: ["repository.write", "repository.read"],
        permissions: clonePermissions({ read: ["**"], write: ["src/**"] }),
        sourceRefs: [`artifact://${harness.runId}/evidence-01`],
        maximumToolCalls: 2,
        rationaleSummary:
          "This intentionally incomplete order must not unlock the fix.",
      },
      withinApprovedScope: true,
      permissionsSufficient: true,
      rationaleSummary: "All completion criteria must be included.",
    };

    expect(() =>
      harness.submit("QualityReview", "quality_controller", diagnosisReview),
    ).toThrow(/must cover every authorized criterion exactly once/i);
  });

  it("rejects a passing acceptance result not backed by matching WorkResult coverage", async () => {
    const harness = await createHarness("analyze_only");
    acceptIntent(harness, "analyze_only");
    harness.submit(
      "WorkPlan",
      "quality_controller",
      makePlan(harness, "analyze_only"),
    );
    captureEvidence(harness, "evidence-01", '{"result":"executed"}');
    captureEvidence(harness, "evidence-02", '{"result":"unrelated"}');
    harness.submit("WorkResult", "executor", makeResult(harness));
    const review = makeQualityReview(harness, {
      resultIds: ["result-01"],
      evidenceRef: `artifact://${harness.runId}/evidence-01`,
    });
    review.acceptanceResults[0].evidenceRefs = [
      `artifact://${harness.runId}/evidence-02`,
    ];

    expect(() =>
      harness.submit("QualityReview", "quality_controller", review),
    ).toThrow(/lacks matching WorkResult coverage/i);
  });

  it.each([
    ["partial", "partial"],
    ["block", "blocked"],
  ] as const)(
    "preserves an audited %s outcome in the terminal report",
    async (auditDecision, terminalStatus) => {
      const harness = await advanceAnalyzeRunToAudit();
      harness.submit(
        "ReleaseAudit",
        "release_auditor",
        makeReleaseAudit(harness, {
          resultIds: ["result-01"],
          evidenceRef: `artifact://${harness.runId}/evidence-01`,
          decision: auditDecision,
        }),
      );
      const terminal = harness.submit(
        "UserReport",
        "release_auditor",
        makeUserReport(harness, terminalStatus),
      );
      expect(terminal.run.status).toBe(terminalStatus);
      expect(terminal.nextAction).toMatchObject({
        kind: "terminal",
        status: terminalStatus,
      });
    },
  );

  it("preserves the typed failed_verification terminal projection", async () => {
    const harness = await advanceAnalyzeRunToAudit(true);
    const audit = makeReleaseAudit(harness, {
      resultIds: ["result-01"],
      evidenceRef: `artifact://${harness.runId}/evidence-01`,
      decision: "partial",
    });
    audit.userFidelity[0].status = "unverified";
    audit.claimEvidenceMatrix = [
      {
        claimId: "verification-01",
        claim: "The requested verification completed.",
        criterionIds: ["AC-1"],
        basis: "direct",
        status: "unverified",
        evidenceRefs: [],
        rationaleSummary: "No direct verification evidence was captured.",
      },
    ];
    audit.unresolvedRisks = ["The required verification remains incomplete."];
    harness.submit("ReleaseAudit", "release_auditor", audit);
    const terminal = harness.submit(
      "UserReport",
      "release_auditor",
      makeUserReport(harness, "failed_verification"),
    );

    expect(terminal.run.status).toBe("partial");
    expect(terminal.nextAction).toMatchObject({
      kind: "terminal",
      phase: "partial",
      status: "failed_verification",
    });
  });

  it("rejects a UserReport traceRef from another run", async () => {
    const harness = await advanceAnalyzeRunToAudit();
    harness.submit(
      "ReleaseAudit",
      "release_auditor",
      makeReleaseAudit(harness, {
        resultIds: ["result-01"],
        evidenceRef: `artifact://${harness.runId}/evidence-01`,
      }),
    );
    const report = makeUserReport(
      harness,
      "completed",
      `artifact://${harness.runId}/evidence-01`,
    );
    report.traceRef = "trace://another-run";

    expect(() =>
      harness.submit("UserReport", "release_auditor", report),
    ).toThrow(/traceRef|current run|cross-run trace/i);
  });

  it("consumes exactly one scoped remediation and then releases", async () => {
    const harness = await createHarness("analyze_only");
    acceptIntent(harness, "analyze_only");
    harness.submit(
      "WorkPlan",
      "quality_controller",
      makePlan(harness, "analyze_only"),
    );
    captureEvidence(harness);
    harness.submit("WorkResult", "executor", makeResult(harness));

    const failedReview = makeQualityReview(harness, {
      resultIds: ["result-01"],
      evidenceRef: `artifact://${harness.runId}/evidence-01`,
      decision: "remediate",
    });
    failedReview.acceptanceResults[0].status = "fail";
    failedReview.hardGates[0].passed = false;
    failedReview.score = 55;
    failedReview.remediationWorkOrder = {
      id: "remediation-01",
      failedCriterionIds: ["AC-1"],
      objective: "Repeat the bounded repository inspection for AC-1.",
      allowedCapabilities: ["repository.read"],
      permissions: clonePermissions({ read: ["**"] }),
      sourceRefs: [`artifact://${harness.runId}/evidence-01`],
      maximumToolCalls: 1,
      rationaleSummary: "One bounded retry can resolve the failed criterion.",
    };
    const remediation = harness.submit(
      "QualityReview",
      "quality_controller",
      failedReview,
    );
    expect(remediation.run.budgets.postExecutionRemediationsRemaining).toBe(0);

    harness.submit(
      "WorkPlan",
      "quality_controller",
      makePlan(harness, "analyze_only", {
        id: "plan-02",
        nodeId: "remediate",
        inputRefs: [`artifact://${harness.runId}/quality-review-01`],
      }),
    );
    captureEvidence(harness, "evidence-02", '{"result":"remediated"}');
    harness.submit(
      "WorkResult",
      "executor",
      makeResult(harness, {
        id: "result-02",
        planId: "plan-02",
        nodeId: "remediate",
        evidenceId: "evidence-02",
      }),
    );
    harness.submit(
      "QualityReview",
      "quality_controller",
      makeQualityReview(harness, {
        id: "quality-review-02",
        planIds: ["plan-02"],
        resultIds: ["result-02"],
        evidenceRef: `artifact://${harness.runId}/evidence-02`,
        remainingRemediations: 0,
      }),
    );
    harness.submit(
      "ReleaseAudit",
      "release_auditor",
      makeReleaseAudit(harness, {
        planIds: ["plan-01", "plan-02"],
        resultIds: ["result-01", "result-02"],
        qualityId: "quality-review-02",
        evidenceRef: `artifact://${harness.runId}/evidence-02`,
        remainingRemediations: 0,
      }),
    );
    const terminal = harness.submit(
      "UserReport",
      "release_auditor",
      makeUserReport(
        harness,
        "completed",
        `artifact://${harness.runId}/evidence-02`,
      ),
    );
    expect(terminal.run).toMatchObject({
      status: "completed",
      budgets: { postExecutionRemediationsRemaining: 0 },
    });
  });

  it("terminates through a typed blocked report when PromptReview blocks", async () => {
    const harness = await createHarness("analyze_only");
    const frame = harness.body("ProblemFrame");
    frame.applicableRuleRefs = [harness.ruleRef];
    harness.submit("ProblemFrame", "scenario_author", frame);
    const contract = harness.body("TaskContract");
    contract.contextRefs = [harness.repositoryRef];
    contract.ruleRefs = [harness.ruleRef];
    contract.permissions = clonePermissions({ read: ["**"] });
    contract.verificationRequirements[0].capability = "repository.read";
    harness.submit("TaskContract", "task_compiler", contract);
    const review = harness.body("PromptReview");
    review.decision = "block";
    review.hardGates[0].passed = false;
    review.overallScore = 25;
    review.dimensionScores = {
      intentFidelity: 25,
      repositoryGrounding: 25,
      constraintsAndPermissions: 25,
      testableAcceptance: 25,
      executionFeasibility: 25,
      contextEfficiency: 25,
    };
    const blocked = harness.submit("PromptReview", "scenario_author", review);
    expect(blocked.nextAction).toMatchObject({
      kind: "phase",
      phase: "user_report",
      requiredOutputType: "UserReport",
    });

    const report = makeUserReport(harness, "blocked");
    report.summary =
      "Contract review blocked the run before planning or execution.";
    const terminal = harness.submit("UserReport", "release_auditor", report);
    expect(terminal.run.status).toBe("blocked");
    expect(terminal.nextAction).toMatchObject({
      kind: "terminal",
      status: "blocked",
      reportRef: `artifact://${harness.runId}/user-report-01`,
    });
  });

  it("makes ScenarioSpec replay idempotent and enforces one spec per frame", async () => {
    const harness = await createHarness("analyze_only");
    const frame = harness.body("ProblemFrame");
    frame.applicableRuleRefs = [harness.ruleRef];
    harness.submit("ProblemFrame", "scenario_author", frame);
    const scenario = harness.body("ScenarioSpec");
    const first = harness.submit("ScenarioSpec", "scenario_author", scenario);
    const artifactCount = harness.service.getRun(harness.runId).artifacts
      .length;
    const traceCount = harness.service.getTrace(harness.runId).length;
    const replay = harness.submit(
      "ScenarioSpec",
      "scenario_author",
      structuredClone(scenario),
    );

    expect(replay.artifact).toEqual(first.artifact);
    expect(harness.service.getRun(harness.runId).artifacts).toHaveLength(
      artifactCount,
    );
    expect(harness.service.getTrace(harness.runId)).toHaveLength(traceCount);

    const conflict = structuredClone(scenario);
    conflict.narrative = "A conflicting immutable replay.";
    expect(() =>
      harness.submit("ScenarioSpec", "scenario_author", conflict),
    ).toThrow(/replay conflicts|immutable/i);

    const second = structuredClone(scenario);
    second.id = "scenario-02";
    expect(() =>
      harness.submit("ScenarioSpec", "scenario_author", second),
    ).toThrow(/one ScenarioSpec|only one/i);
  });

  it("makes Evidence replay idempotent and caps each WorkPlan at 128 artifacts", async () => {
    const harness = await createHarness("analyze_only");
    acceptIntent(harness, "analyze_only");
    harness.submit(
      "WorkPlan",
      "quality_controller",
      makePlan(harness, "analyze_only"),
    );
    const evidence = makeEvidence(harness);
    const first = harness.submit("Evidence", "executor", evidence);
    const artifactCount = harness.service.getRun(harness.runId).artifacts
      .length;
    const traceCount = harness.service.getTrace(harness.runId).length;
    const replay = harness.submit(
      "Evidence",
      "executor",
      structuredClone(evidence),
    );
    expect(replay.artifact).toEqual(first.artifact);
    expect(harness.service.getRun(harness.runId).artifacts).toHaveLength(
      artifactCount,
    );
    expect(harness.service.getTrace(harness.runId)).toHaveLength(traceCount);

    const conflict = structuredClone(evidence);
    conflict.content = '{"result":"conflicting-replay"}';
    expect(() => harness.submit("Evidence", "executor", conflict)).toThrow(
      /replay conflicts|immutable/i,
    );

    for (let index = 2; index <= 128; index += 1) {
      const id = `evidence-${String(index).padStart(3, "0")}`;
      harness.submit(
        "Evidence",
        "executor",
        makeEvidence(harness, id, `{"sample":${String(index)}}`),
      );
    }
    expect(
      harness.service
        .getRun(harness.runId)
        .artifacts.filter((artifact) => artifact.type === "Evidence"),
    ).toHaveLength(128);
    expect(() =>
      harness.submit(
        "Evidence",
        "executor",
        makeEvidence(harness, "evidence-129", '{"sample":129}'),
      ),
    ).toThrow(/quota.*128|128.*quota/i);
  }, 20_000);

  it.each([
    ["top-level", "contract-01"],
    ["completed action", "plan-01"],
  ] as const)(
    "rejects %s WorkResult evidence backed by a planning artifact",
    async (location, planningArtifactId) => {
      const harness = await createHarness("analyze_only");
      acceptIntent(harness, "analyze_only");
      harness.submit(
        "WorkPlan",
        "quality_controller",
        makePlan(harness, "analyze_only"),
      );
      captureEvidence(harness);
      const result = makeResult(harness);
      const planningRef = `artifact://${harness.runId}/${planningArtifactId}`;
      if (location === "top-level") result.evidenceRefs = [planningRef];
      else result.actions[0].evidenceRefs = [planningRef];

      expect(() => harness.submit("WorkResult", "executor", result)).toThrow(
        /must target direct evidence/i,
      );
    },
  );

  it("projects each accepted WorkResult action permission into typed trace", async () => {
    const harness = await createHarness("analyze_only");
    acceptIntent(harness, "analyze_only");
    harness.submit(
      "WorkPlan",
      "quality_controller",
      makePlan(harness, "analyze_only"),
    );
    captureEvidence(harness);
    harness.submit("WorkResult", "executor", makeResult(harness));

    const checks = harness.service
      .getTrace(harness.runId)
      .filter((event) => event.eventType === "permission_checked");
    expect(checks).toHaveLength(1);
    expect(checks[0]).toMatchObject({
      actor: "controller",
      phase: "agent_4_execute",
      inputRefs: [
        `artifact://${harness.runId}/contract-01`,
        `artifact://${harness.runId}/plan-01`,
      ],
      outputRefs: [`artifact://${harness.runId}/result-01`],
      permissionDecision: {
        decision: "allow",
        capability: "repository.read",
        scope: "apps/web/src/api.ts",
        policyRefs: [
          `artifact://${harness.runId}/contract-01`,
          `artifact://${harness.runId}/plan-01`,
        ],
      },
    });
  });
});
