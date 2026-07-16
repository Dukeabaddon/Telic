import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { TelicService } from "../packages/mcp/src/service.js";
import {
  HASH,
  NO_PERMISSIONS,
  VALID_ARTIFACT_BODIES,
} from "../packages/protocol/test/test-helpers.js";

type ArtifactBody = Record<string, any>;
type IntentMode = "analyze_only" | "fix_only" | "analyze_and_fix";
type EvidenceKind =
  | "repository"
  | "runtime"
  | "browser"
  | "test"
  | "diff"
  | "tool_output"
  | "log"
  | "user_confirmation";

interface Harness {
  service: TelicService;
  runId: string;
  mode: IntentMode;
  requestRef: string;
  contextDocumentRef: string;
  body: (type: keyof typeof VALID_ARTIFACT_BODIES) => ArtifactBody;
  submit: (
    type: string,
    producer: string,
    body: ArtifactBody,
    sourceRefs?: string[],
  ) => ReturnType<TelicService["submitArtifact"]>;
}

interface HarnessOptions {
  mode?: IntentMode;
  hostCapabilities?: string[];
  authorizationGranted?: string[];
  shellExecuteAllowlist?: string[];
  networkReadDomains?: string[];
}

const RULE_REF = "repo://AGENTS.md";
const SOURCE_REF = "repo://apps/web/src/api.ts";
const OLD_SOURCE_REF = "repo://src/old.ts";
const SOURCE_PATH = "apps/web/src/api.ts";
const services: TelicService[] = [];

afterEach(() => {
  for (const service of services.splice(0)) service.close();
});

function bindTemplate(
  value: unknown,
  runId: string,
  requestRef: string,
): unknown {
  if (typeof value === "string") {
    return value
      .replaceAll("run-01", runId)
      .replaceAll(`artifact://${runId}/user-message-01`, requestRef)
      .replaceAll(
        `artifact://${runId}/browser-response-01`,
        `artifact://${runId}/evidence-01`,
      )
      .replaceAll(
        `artifact://${runId}/action-ledger-01`,
        `artifact://${runId}/evidence-01`,
      )
      .replaceAll("repo://apps/api/cors.ts", SOURCE_REF);
  }
  if (Array.isArray(value)) {
    return value.map((child) => bindTemplate(child, runId, requestRef));
  }
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [
        key,
        bindTemplate(child, runId, requestRef),
      ]),
    );
  }
  return value;
}

function permissionsFor(
  capability: string,
  scopes: string[] = ["**"],
): ArtifactBody {
  const permissions = structuredClone(NO_PERMISSIONS) as ArtifactBody;
  switch (capability) {
    case "repository.read":
      permissions.repository.read = scopes;
      break;
    case "repository.write":
      permissions.repository.read = ["**"];
      permissions.repository.write = scopes;
      break;
    case "repository.delete":
      permissions.repository.read = ["**"];
      permissions.repository.delete = scopes;
      break;
    case "shell.inspect":
      permissions.shell.inspect = true;
      break;
    case "shell.execute":
      permissions.shell.executeAllowlist = scopes;
      break;
    case "browser.inspect":
      permissions.browser.inspect = true;
      break;
    case "network.read":
      permissions.network.readDomains = scopes;
      break;
    default:
      throw new Error(`Unsupported test capability: ${capability}`);
  }
  return permissions;
}

function acceptanceCriteria(mode: IntentMode): ArtifactBody[] {
  if (mode === "analyze_and_fix") {
    return [
      {
        id: "AC-DIAGNOSIS",
        stage: "diagnosis",
        requirement: "Identify the supported failure boundary.",
        evidenceRequired: ["direct_diagnosis_evidence"],
      },
      {
        id: "AC-COMPLETION",
        stage: "completion",
        requirement: "Complete and verify the bounded correction.",
        evidenceRequired: ["direct_completion_evidence"],
      },
    ];
  }
  return [
    {
      id: "AC-1",
      stage: "completion",
      requirement: "Complete the bounded task with direct evidence.",
      evidenceRequired: ["direct_evidence"],
    },
  ];
}

async function createFramedHarness(
  options: HarnessOptions = {},
): Promise<Harness> {
  const mode = options.mode ?? "analyze_only";
  const repositoryRoot = mkdtempSync(
    join(tmpdir(), "telic-trust-boundary-repo-"),
  );
  mkdirSync(join(repositoryRoot, "apps/web/src"), { recursive: true });
  mkdirSync(join(repositoryRoot, "infra"), { recursive: true });
  mkdirSync(join(repositoryRoot, "src"), { recursive: true });
  writeFileSync(
    join(repositoryRoot, "AGENTS.md"),
    "# Rules\nRequire direct, capability-compatible evidence.\n",
  );
  writeFileSync(
    join(repositoryRoot, SOURCE_PATH),
    "export const endpoint = '/api/projects';\n",
  );
  writeFileSync(join(repositoryRoot, "infra/prod.yml"), "production: true\n");
  writeFileSync(join(repositoryRoot, "src/old.ts"), "export const old = 1;\n");

  const hostCapabilities = options.hostCapabilities ?? ["repository.read"];
  const authorizationGranted = options.authorizationGranted ?? hostCapabilities;
  const service = new TelicService({
    repositoryRoot,
    stateDirectory: mkdtempSync(join(tmpdir(), "telic-trust-boundary-state-")),
  });
  services.push(service);
  const started = service.startRun({
    originalRequest:
      "Perform the requested bounded work and preserve direct evidence for every claim.",
    mode,
    hostName: "trust-boundary-test-host",
    nativeSubagents: "unavailable",
    hostCapabilities,
    authorizationGranted,
    ...(options.shellExecuteAllowlist
      ? { shellExecuteAllowlist: options.shellExecuteAllowlist }
      : {}),
    ...(options.networkReadDomains
      ? { networkReadDomains: options.networkReadDomains }
      : {}),
  });
  await service.groundContext({
    runId: started.run.runId,
    activePaths: ["AGENTS.md", SOURCE_PATH, "src/old.ts"],
  });
  const records = service.getRun(started.run.runId).artifacts;
  const request = records.find((artifact) => artifact.type === "UserMessage");
  const contextDocument = records.find(
    (artifact) => artifact.type === "ContextDocument",
  );
  if (!request || !contextDocument) {
    throw new Error("Grounding must preserve request and context artifacts");
  }
  const requestRef = `artifact://${started.run.runId}/${request.id}`;
  const body = (type: keyof typeof VALID_ARTIFACT_BODIES) =>
    bindTemplate(
      structuredClone(VALID_ARTIFACT_BODIES[type]),
      started.run.runId,
      requestRef,
    ) as ArtifactBody;
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
  const harness: Harness = {
    service,
    runId: started.run.runId,
    mode,
    requestRef,
    contextDocumentRef: `artifact://${started.run.runId}/${contextDocument.id}`,
    body,
    submit,
  };

  const frame = body("ProblemFrame");
  frame.intentMode = mode;
  frame.applicableRuleRefs = [RULE_REF];
  frame.draftAcceptanceCriteria = acceptanceCriteria(mode);
  if (mode !== "analyze_only") {
    frame.constraints = ["Mutate only within explicitly authorized scope."];
    frame.nonGoals = ["Do not change unrelated files."];
  }
  submit("ProblemFrame", "scenario_author", frame);
  return harness;
}

function contractBody(
  harness: Harness,
  permissions: ArtifactBody,
  verificationRequirements: ArtifactBody[],
): ArtifactBody {
  const contract = harness.body("TaskContract");
  const frame = harness.service.getArtifact(harness.runId, "frame-01")
    .body as ArtifactBody;
  contract.intentMode = harness.mode;
  contract.scope = structuredClone(frame.scope);
  contract.constraints = structuredClone(frame.constraints);
  contract.nonGoals = structuredClone(frame.nonGoals);
  contract.contextRefs = [SOURCE_REF];
  contract.ruleRefs = [RULE_REF];
  contract.permissions = permissions;
  contract.acceptanceCriteria = structuredClone(frame.draftAcceptanceCriteria);
  contract.verificationRequirements = verificationRequirements;
  return contract;
}

function verification(
  capability: string,
  stage: "diagnosis" | "completion" = "completion",
  id = "VR-1",
): ArtifactBody {
  return {
    id,
    stage,
    description: `Capture direct ${stage} evidence through ${capability}.`,
    required: true,
    capability,
    fallback: "Report the unavailable boundary honestly.",
  };
}

function submitExecutablePipeline(
  harness: Harness,
  capability: string,
  permissions: ArtifactBody,
): void {
  const verificationCapability =
    capability === "repository.write" || capability === "repository.delete"
      ? "repository.read"
      : capability;
  harness.submit(
    "TaskContract",
    "task_compiler",
    contractBody(harness, permissions, [verification(verificationCapability)]),
  );
  harness.submit(
    "PromptReview",
    "scenario_author",
    harness.body("PromptReview"),
  );
  const plan = harness.body("WorkPlan");
  plan.nodes[0].contextRefs = [SOURCE_REF];
  plan.nodes[0].allowedTools = [
    ...new Set([capability, verificationCapability]),
  ];
  plan.nodes[0].requiredCapabilities = [
    ...new Set([capability, verificationCapability]),
  ];
  plan.nodes[0].permissions = structuredClone(permissions);
  plan.nodes[0].acceptanceCriteria = ["AC-1"];
  plan.nodes[0].budgets.maximumToolCalls = 4;
  plan.nodes[0].budgets.maximumChildren = 0;
  plan.globalBudgets.maximumToolCalls = 4;
  plan.globalBudgets.maximumParallelWorkers = 1;
  plan.globalBudgets.maximumSubagentDepth = 0;
  harness.submit("WorkPlan", "quality_controller", plan);
}

function captureEvidence(
  harness: Harness,
  id: string,
  kind: EvidenceKind,
): string {
  harness.submit("Evidence", "executor", {
    schemaVersion: "1.0",
    id,
    runId: harness.runId,
    kind,
    capturedAt: "2026-07-15T10:05:00Z",
    summary: `Captured ${kind} evidence for the bounded test action.`,
    contentType: "application/json",
    encoding: "utf8",
    content: JSON.stringify({ kind, bounded: true }),
    sourceRefs: [],
    redactions: [],
    rationaleSummary: "The synthetic evidence contains no secret material.",
  });
  return `artifact://${harness.runId}/${id}`;
}

function completedAction(
  capability: string,
  target: string,
  evidenceRef: string,
): ArtifactBody {
  return {
    id: `action-${capability.replace(".", "-")}`,
    capability,
    target,
    mutating:
      capability === "repository.write" || capability === "repository.delete",
    status: "completed",
    evidenceRefs: [evidenceRef],
    rationaleSummary: "The completed action is represented explicitly.",
  };
}

function completedResult(
  harness: Harness,
  evidenceRef: string,
  options: {
    actions?: ArtifactBody[];
    filesChanged?: ArtifactBody[];
    testResults?: ArtifactBody[];
    acceptanceEvidenceRef?: string;
  } = {},
): ArtifactBody {
  const result = harness.body("WorkResult");
  result.observations = [
    {
      id: "claim-01",
      text: "The bounded action produced the captured outcome.",
      status: "observed",
      evidenceRefs: [evidenceRef],
      confidence: 1,
    },
  ];
  result.inferences = [];
  result.actions = options.actions ?? [
    completedAction("repository.read", SOURCE_PATH, evidenceRef),
  ];
  result.filesChanged = options.filesChanged ?? [];
  result.toolEventRefs = [];
  result.evidenceRefs = [evidenceRef];
  result.testResults = options.testResults ?? [];
  result.acceptanceCoverage = [
    {
      criterionId: "AC-1",
      status: "pass",
      evidenceRefs: [options.acceptanceEvidenceRef ?? evidenceRef],
      rationaleSummary: "The direct evidence satisfies the assigned criterion.",
    },
  ];
  result.unresolvedIssues = [];
  result.deviations = [];
  result.rationaleSummary = "The executor reports bounded completed work.";
  return result;
}

function passingQualityReview(
  harness: Harness,
  evidenceRef: string,
  verificationEvidenceRef = evidenceRef,
): ArtifactBody {
  const review = harness.body("QualityReview");
  review.acceptanceResults = [
    {
      criterionId: "AC-1",
      status: "pass",
      evidenceRefs: [evidenceRef],
      rationaleSummary: "Direct evidence satisfies required acceptance.",
    },
  ];
  review.ruleCompliance[0].evidenceRefs = [evidenceRef];
  review.verificationResults = [
    {
      requirementId: "VR-1",
      capability: "repository.read",
      status: "pass",
      evidenceRefs: [verificationEvidenceRef],
      rationaleSummary: "The required repository verification passed.",
    },
  ];
  review.hardGates[0].evidenceRefs = [evidenceRef];
  review.findings = [];
  review.decision = "pass";
  review.score = 96;
  return review;
}

function releaseAudit(
  harness: Harness,
  evidenceRef: string,
  claimEvidenceRef = evidenceRef,
): ArtifactBody {
  const audit = harness.body("ReleaseAudit");
  audit.userFidelity[0].evidenceRefs = [evidenceRef];
  audit.claimEvidenceMatrix[0].evidenceRefs = [claimEvidenceRef];
  audit.claimEvidenceMatrix[0].criterionIds = ["AC-1"];
  audit.claimEvidenceMatrix[0].basis = "direct";
  audit.decision = "release";
  audit.remainingRemediations = 1;
  audit.remediationDefect = null;
  return audit;
}

function permissionTraceRef(harness: Harness): string {
  const event = harness.service
    .getTrace(harness.runId)
    .findLast((candidate) => candidate.eventType === "permission_checked");
  if (!event) throw new Error("Expected a permission_checked trace event");
  return `trace://${harness.runId}/${event.id}`;
}

describe("trust-boundary conformance", () => {
  describe("permission decisions are not outcome evidence", () => {
    it("rejects permission_checked as acceptance evidence", async () => {
      const harness = await createFramedHarness({
        hostCapabilities: ["repository.read"],
      });
      submitExecutablePipeline(
        harness,
        "repository.read",
        permissionsFor("repository.read", ["apps/web/**"]),
      );
      const evidenceRef = captureEvidence(harness, "evidence-01", "repository");
      const denied = completedResult(harness, evidenceRef, {
        actions: [
          completedAction("repository.read", "infra/prod.yml", evidenceRef),
        ],
      });
      expect(() => harness.submit("WorkResult", "executor", denied)).toThrow(
        /outside node|scope|permission/i,
      );

      const result = completedResult(harness, evidenceRef, {
        acceptanceEvidenceRef: permissionTraceRef(harness),
      });
      expect(() => harness.submit("WorkResult", "executor", result)).toThrow(
        /trace event is not direct evidence/i,
      );
    });

    it("rejects permission_checked as verification evidence", async () => {
      const harness = await createFramedHarness();
      submitExecutablePipeline(
        harness,
        "repository.read",
        permissionsFor("repository.read"),
      );
      const evidenceRef = captureEvidence(harness, "evidence-01", "repository");
      harness.submit(
        "WorkResult",
        "executor",
        completedResult(harness, evidenceRef),
      );

      expect(() =>
        harness.submit(
          "QualityReview",
          "quality_controller",
          passingQualityReview(
            harness,
            evidenceRef,
            permissionTraceRef(harness),
          ),
        ),
      ).toThrow(/trace event is not direct evidence/i);
    });

    it("rejects permission_checked as release evidence", async () => {
      const harness = await createFramedHarness();
      submitExecutablePipeline(
        harness,
        "repository.read",
        permissionsFor("repository.read"),
      );
      const evidenceRef = captureEvidence(harness, "evidence-01", "repository");
      harness.submit(
        "WorkResult",
        "executor",
        completedResult(harness, evidenceRef),
      );
      const traceRef = permissionTraceRef(harness);
      harness.submit(
        "QualityReview",
        "quality_controller",
        passingQualityReview(harness, evidenceRef),
      );

      expect(() =>
        harness.submit(
          "ReleaseAudit",
          "release_auditor",
          releaseAudit(harness, evidenceRef, traceRef),
        ),
      ).toThrow(/trace event is not direct evidence/i);
    });
  });

  it("rejects completed executable work that omits its required action", async () => {
    const harness = await createFramedHarness();
    submitExecutablePipeline(
      harness,
      "repository.read",
      permissionsFor("repository.read"),
    );
    const evidenceRef = captureEvidence(harness, "evidence-01", "repository");

    expect(() =>
      harness.submit(
        "WorkResult",
        "executor",
        completedResult(harness, evidenceRef, { actions: [] }),
      ),
    ).toThrow(/missing required capability repository\.read/i);
  });

  describe("completed mutations require an exact FileChange", () => {
    it.each([
      ["repository.write", "src/fix.ts"],
      ["repository.delete", "src/old.ts"],
    ] as const)(
      "rejects %s without its FileChange",
      async (capability, target) => {
        const harness = await createFramedHarness({
          mode: "fix_only",
          hostCapabilities: ["repository.read", capability],
        });
        submitExecutablePipeline(
          harness,
          capability,
          permissionsFor(capability, ["src/**"]),
        );
        const evidenceRef = captureEvidence(harness, "evidence-01", "diff");

        expect(() =>
          harness.submit(
            "WorkResult",
            "executor",
            completedResult(harness, evidenceRef, {
              actions: [completedAction(capability, target, evidenceRef)],
              filesChanged: [],
            }),
          ),
        ).toThrow(/lacks an exact FileChange/i);
      },
    );
  });

  describe("evidence kind must match its consuming field", () => {
    it("rejects repository Evidence as a FileChange diffRef", async () => {
      const harness = await createFramedHarness({
        mode: "fix_only",
        hostCapabilities: ["repository.read", "repository.write"],
      });
      submitExecutablePipeline(
        harness,
        "repository.write",
        permissionsFor("repository.write", ["src/**"]),
      );
      const actionEvidenceRef = captureEvidence(harness, "evidence-01", "diff");
      const badDiffRef = captureEvidence(harness, "not-a-diff", "repository");

      expect(() =>
        harness.submit(
          "WorkResult",
          "executor",
          completedResult(harness, actionEvidenceRef, {
            actions: [
              completedAction(
                "repository.write",
                "src/fix.ts",
                actionEvidenceRef,
              ),
              completedAction("repository.read", SOURCE_PATH, badDiffRef),
            ],
            filesChanged: [
              {
                path: "src/fix.ts",
                changeType: "created",
                beforeHash: null,
                afterHash: HASH,
                diffRef: badDiffRef,
              },
            ],
          }),
        ),
      ).toThrow(/evidence kind repository is incompatible.*diffRef/i);
    });

    it("rejects repository Evidence for a browser action", async () => {
      const harness = await createFramedHarness({
        hostCapabilities: ["browser.inspect"],
      });
      submitExecutablePipeline(
        harness,
        "browser.inspect",
        permissionsFor("browser.inspect"),
      );
      const evidenceRef = captureEvidence(harness, "evidence-01", "repository");

      expect(() =>
        harness.submit(
          "WorkResult",
          "executor",
          completedResult(harness, evidenceRef, {
            actions: [
              completedAction(
                "browser.inspect",
                "http://localhost:3000",
                evidenceRef,
              ),
            ],
          }),
        ),
      ).toThrow(/evidence kind repository is incompatible.*actions/i);
    });

    it("rejects user_confirmation as executed test output", async () => {
      const harness = await createFramedHarness();
      submitExecutablePipeline(
        harness,
        "repository.read",
        permissionsFor("repository.read"),
      );
      const evidenceRef = captureEvidence(harness, "evidence-01", "repository");
      const outputRef = captureEvidence(
        harness,
        "user-confirmation",
        "user_confirmation",
      );

      expect(() =>
        harness.submit(
          "WorkResult",
          "executor",
          completedResult(harness, evidenceRef, {
            testResults: [executedTest(outputRef)],
          }),
        ),
      ).toThrow(/evidence kind user_confirmation is incompatible.*outputRef/i);
    });

    it("rejects a ContextDocument as executed test output", async () => {
      const harness = await createFramedHarness();
      submitExecutablePipeline(
        harness,
        "repository.read",
        permissionsFor("repository.read"),
      );
      const evidenceRef = captureEvidence(harness, "evidence-01", "repository");

      expect(() =>
        harness.submit(
          "WorkResult",
          "executor",
          completedResult(harness, evidenceRef, {
            testResults: [executedTest(harness.contextDocumentRef)],
          }),
        ),
      ).toThrow(/ContextDocument cannot prove an executed outcome.*outputRef/i);
    });
  });

  describe("permission trace redaction", () => {
    it("never persists credentials from a denied network target", async () => {
      const harness = await createFramedHarness({
        hostCapabilities: ["network.read"],
        authorizationGranted: ["network.read"],
        networkReadDomains: ["api.example.com"],
      });
      submitExecutablePipeline(
        harness,
        "network.read",
        permissionsFor("network.read", ["api.example.com"]),
      );
      const evidenceRef = captureEvidence(
        harness,
        "evidence-01",
        "tool_output",
      );
      const credential = "trace-secret-value";
      const querySecret = "query-secret-value";

      expect(() =>
        harness.submit(
          "WorkResult",
          "executor",
          completedResult(harness, evidenceRef, {
            actions: [
              completedAction(
                "network.read",
                `https://user:${credential}@api.example.com/v1/items?token=${querySecret}#private`,
                evidenceRef,
              ),
            ],
          }),
        ),
      ).toThrow(/permission|outside node/i);

      const trace = JSON.stringify(harness.service.getTrace(harness.runId));
      expect(trace).not.toContain(credential);
      expect(trace).not.toContain(querySecret);
      expect(trace).toContain('"scope":"api.example.com"');
    });
  });

  describe("shell authority is exact and typed", () => {
    it("does not derive command authority from generic shell.execute availability", async () => {
      const harness = await createFramedHarness({
        mode: "fix_only",
        hostCapabilities: ["repository.read", "shell.execute"],
        authorizationGranted: ["repository.read", "shell.execute"],
      });
      const envelope = harness.service.getArtifact(harness.runId, harness.runId)
        .body as ArtifactBody;
      expect(envelope.authorization.granted.shell.executeAllowlist).toEqual([]);

      expect(() =>
        harness.submit(
          "TaskContract",
          "task_compiler",
          contractBody(harness, permissionsFor("shell.execute", ["npm test"]), [
            verification("shell.execute"),
          ]),
        ),
      ).toThrow(/permissions exceed immutable authorization/i);
    });

    it("denies a raw command masquerading as shell.inspect", async () => {
      const harness = await createFramedHarness({
        hostCapabilities: ["shell.inspect"],
      });
      submitExecutablePipeline(
        harness,
        "shell.inspect",
        permissionsFor("shell.inspect"),
      );
      const evidenceRef = captureEvidence(
        harness,
        "evidence-01",
        "tool_output",
      );

      expect(() =>
        harness.submit(
          "WorkResult",
          "executor",
          completedResult(harness, evidenceRef, {
            actions: [
              completedAction("shell.inspect", "rm -rf /", evidenceRef),
            ],
          }),
        ),
      ).toThrow(/typed read-only inspection/i);
      expect(
        harness.service
          .getTrace(harness.runId)
          .some(
            (event) =>
              event.eventType === "permission_checked" &&
              event.permissionDecision?.decision === "deny" &&
              event.permissionDecision.capability === "shell.inspect" &&
              event.permissionDecision.scope === "rm -rf /",
          ),
      ).toBe(true);
    });
  });

  describe("execution contracts require staged verification", () => {
    it.each(["analyze_only", "fix_only", "analyze_and_fix"] as const)(
      "rejects empty required verification in %s",
      async (mode) => {
        const harness = await createFramedHarness({ mode });

        expect(() =>
          harness.submit(
            "TaskContract",
            "task_compiler",
            contractBody(harness, permissionsFor("repository.read"), []),
          ),
        ).toThrow(/require at least one required verification/i);
      },
    );

    it.each(["diagnosis", "completion"] as const)(
      "rejects analyze_and_fix with only %s verification",
      async (stage) => {
        const harness = await createFramedHarness({ mode: "analyze_and_fix" });

        expect(() =>
          harness.submit(
            "TaskContract",
            "task_compiler",
            contractBody(harness, permissionsFor("repository.read"), [
              verification("repository.read", stage),
            ]),
          ),
        ).toThrow(/requires required diagnosis and completion verification/i);
      },
    );
  });
});

function executedTest(outputRef: string): ArtifactBody {
  return {
    id: "test-01",
    name: "bounded verification",
    status: "passed",
    commandRef: null,
    outputRef,
    exitCode: 0,
    rationaleSummary: "The executed test claims a successful result.",
  };
}
