import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { TelicService } from "../packages/mcp/src/service.js";
import { FileChangeSchema } from "../packages/protocol/src/workflow-execution.js";
import {
  HASH,
  NO_PERMISSIONS,
  VALID_ARTIFACT_BODIES,
} from "../packages/protocol/test/test-helpers.js";

type ArtifactBody = Record<string, any>;
type Mode = "analyze_only" | "fix_only";

interface Harness {
  service: TelicService;
  runId: string;
  mode: Mode;
  requestId: string;
  requestRef: string;
  body: (type: keyof typeof VALID_ARTIFACT_BODIES) => ArtifactBody;
  submit: (
    type: string,
    producer: string,
    body: ArtifactBody,
    sourceRefs?: string[],
  ) => ReturnType<TelicService["submitArtifact"]>;
}

interface HarnessOptions {
  mode?: Mode;
  nativeSubagents?: "available" | "unavailable";
  hostCapabilities?: string[];
  authorizationGranted?: string[];
  shellExecuteAllowlist?: string[];
}

const RULE_REF = "repo://AGENTS.md";
const SOURCE_REF = "repo://apps/web/src/api.ts";
const SOURCE_PATH = "apps/web/src/api.ts";
const OTHER_HASH = `sha256:${"1".repeat(64)}`;
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
      .replaceAll("repo://apps/api/cors.ts", SOURCE_REF);
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

async function createGroundedHarness(
  options: HarnessOptions = {},
): Promise<Harness> {
  const mode = options.mode ?? "analyze_only";
  const repositoryRoot = mkdtempSync(
    join(tmpdir(), "telic-closure-authority-repo-"),
  );
  mkdirSync(join(repositoryRoot, "apps/web/src"), { recursive: true });
  writeFileSync(
    join(repositoryRoot, "AGENTS.md"),
    "# Rules\nPreserve authority, closure, and cumulative budgets.\n",
  );
  writeFileSync(
    join(repositoryRoot, SOURCE_PATH),
    "export const endpoint = '/api/projects';\n",
  );

  const hostCapabilities = options.hostCapabilities ?? ["repository.read"];
  const service = new TelicService({
    repositoryRoot,
    stateDirectory: mkdtempSync(
      join(tmpdir(), "telic-closure-authority-state-"),
    ),
  });
  services.push(service);
  const started = service.startRun({
    originalRequest:
      "Perform bounded work while preserving authority and evidence closure.",
    mode,
    hostName: "closure-authority-test-host",
    nativeSubagents: options.nativeSubagents ?? "unavailable",
    hostCapabilities,
    authorizationGranted: options.authorizationGranted ?? hostCapabilities,
    ...(options.shellExecuteAllowlist
      ? { shellExecuteAllowlist: options.shellExecuteAllowlist }
      : {}),
  });
  await service.groundContext({
    runId: started.run.runId,
    activePaths: ["AGENTS.md", SOURCE_PATH],
  });
  const records = service.getRun(started.run.runId).artifacts;
  const request = records.find((artifact) => artifact.type === "UserMessage");
  if (!request) throw new Error("Immutable request artifact expected");

  const body = (type: keyof typeof VALID_ARTIFACT_BODIES) =>
    bindTemplate(
      structuredClone(VALID_ARTIFACT_BODIES[type]),
      started.run.runId,
      request.id,
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
  return {
    service,
    runId: started.run.runId,
    mode,
    requestId: request.id,
    requestRef: `artifact://${started.run.runId}/${request.id}`,
    body,
    submit,
  };
}

function readPermissions(): ArtifactBody {
  const permissions = structuredClone(NO_PERMISSIONS) as ArtifactBody;
  permissions.repository.read = ["**"];
  return permissions;
}

function shellPermissions(command: string): ArtifactBody {
  const permissions = structuredClone(NO_PERMISSIONS) as ArtifactBody;
  permissions.shell.executeAllowlist = [command];
  return permissions;
}

function submitFrame(
  harness: Harness,
  sourceRefs?: string[],
): ReturnType<Harness["submit"]> {
  const frame = harness.body("ProblemFrame");
  frame.intentMode = harness.mode;
  frame.applicableRuleRefs = [RULE_REF];
  if (harness.mode === "fix_only") {
    frame.constraints = ["Mutate only within explicit authority."];
    frame.nonGoals = ["Do not modify unrelated paths."];
  }
  return harness.submit("ProblemFrame", "scenario_author", frame, sourceRefs);
}

function contractBody(
  harness: Harness,
  capability = "repository.read",
  permissions: ArtifactBody = readPermissions(),
): ArtifactBody {
  const frame = harness.service.getArtifact(harness.runId, "frame-01")
    .body as ArtifactBody;
  const contract = harness.body("TaskContract");
  contract.intentMode = harness.mode;
  contract.scope = structuredClone(frame.scope);
  contract.constraints = structuredClone(frame.constraints);
  contract.nonGoals = structuredClone(frame.nonGoals);
  contract.contextRefs = [SOURCE_REF];
  contract.ruleRefs = [RULE_REF];
  contract.permissions = permissions;
  contract.acceptanceCriteria = structuredClone(frame.draftAcceptanceCriteria);
  contract.verificationRequirements = [
    {
      id: "VR-1",
      stage: "completion",
      description: `Capture direct completion evidence with ${capability}.`,
      required: true,
      capability,
      fallback: "Report the unavailable boundary honestly.",
    },
  ];
  return contract;
}

function submitContract(
  harness: Harness,
  capability = "repository.read",
  permissions: ArtifactBody = readPermissions(),
  sourceRefs?: string[],
): void {
  harness.submit(
    "TaskContract",
    "task_compiler",
    contractBody(harness, capability, permissions),
    sourceRefs,
  );
}

function submitAcceptedContract(
  harness: Harness,
  capability = "repository.read",
  permissions: ArtifactBody = readPermissions(),
): void {
  submitFrame(harness);
  submitContract(harness, capability, permissions);
  harness.submit(
    "PromptReview",
    "scenario_author",
    harness.body("PromptReview"),
  );
}

function planBody(
  harness: Harness,
  budgets: number[],
  options: {
    id?: string;
    capability?: string;
    permissions?: ArtifactBody;
    globalBudget?: number;
    controlRef?: string;
  } = {},
): ArtifactBody {
  const plan = harness.body("WorkPlan");
  plan.id = options.id ?? "plan-01";
  const capability = options.capability ?? "repository.read";
  const permissions = options.permissions ?? readPermissions();
  plan.nodes = budgets.map((maximumToolCalls, index) => ({
    ...structuredClone(plan.nodes[0]),
    id: `node-${String(index + 1).padStart(2, "0")}`,
    dependsOn: [],
    inputRefs: [
      `artifact://${harness.runId}/contract-01`,
      ...(options.controlRef ? [options.controlRef] : []),
    ],
    contextRefs: [SOURCE_REF],
    allowedTools: [capability],
    requiredCapabilities: [capability],
    permissions: structuredClone(permissions),
    acceptanceCriteria: ["AC-1"],
    budgets: { maximumToolCalls, maximumChildren: 0 },
  }));
  plan.globalBudgets.maximumToolCalls =
    options.globalBudget ?? budgets.reduce((sum, value) => sum + value, 0);
  plan.globalBudgets.maximumParallelWorkers = 1;
  plan.globalBudgets.maximumSubagentDepth = 0;
  return plan;
}

function captureEvidence(
  harness: Harness,
  sourceRefs?: string[],
  kind: "repository" | "tool_output" | "diff" = "repository",
  id = "evidence-01",
): string {
  harness.submit(
    "Evidence",
    "executor",
    {
      schemaVersion: "1.0",
      id,
      runId: harness.runId,
      kind,
      capturedAt: "2026-07-15T10:05:00Z",
      summary: "Captured bounded evidence for the executed action.",
      contentType: "application/json",
      encoding: "utf8",
      content: '{"bounded":true}',
      sourceRefs: [],
      redactions: [],
      rationaleSummary: "The synthetic evidence contains no secret material.",
    },
    sourceRefs,
  );
  return `artifact://${harness.runId}/${id}`;
}

function resultBody(
  harness: Harness,
  nodeId: string,
  evidenceRef: string,
  options: {
    id?: string;
    capability?: string;
    target?: string;
    mutating?: boolean;
    actionEvidenceRef?: string;
  } = {},
): ArtifactBody {
  const result = harness.body("WorkResult");
  result.id = options.id ?? "result-01";
  result.nodeId = nodeId;
  result.observations = [
    {
      id: "claim-01",
      text: "The bounded action produced the captured result.",
      status: "observed",
      evidenceRefs: [evidenceRef],
      confidence: 1,
    },
  ];
  result.inferences = [];
  result.actions = [
    {
      id: `action-${result.id}`,
      capability: options.capability ?? "repository.read",
      target: options.target ?? SOURCE_PATH,
      mutating: options.mutating ?? false,
      status: "completed",
      evidenceRefs: [options.actionEvidenceRef ?? evidenceRef],
      rationaleSummary: "The completed action is recorded explicitly.",
    },
  ];
  result.filesChanged = [];
  result.toolEventRefs = [];
  result.evidenceRefs = [evidenceRef];
  result.testResults = [];
  result.acceptanceCoverage = [
    {
      criterionId: "AC-1",
      status: "pass",
      evidenceRefs: [evidenceRef],
      rationaleSummary: "Direct evidence supports the assigned criterion.",
    },
  ];
  result.unresolvedIssues = [];
  result.deviations = [];
  return result;
}

function passingQualityReview(
  harness: Harness,
  evidenceRef: string,
  options: {
    capability?: string;
    verificationEvidenceRef?: string;
    workResultRefs?: string[];
  } = {},
): ArtifactBody {
  const review = harness.body("QualityReview");
  review.workResultRefs = options.workResultRefs ?? [
    `artifact://${harness.runId}/result-01`,
  ];
  review.acceptanceResults[0].evidenceRefs = [evidenceRef];
  review.ruleCompliance[0].evidenceRefs = [evidenceRef];
  review.verificationResults = [
    {
      requirementId: "VR-1",
      capability: options.capability ?? "repository.read",
      status: "pass",
      evidenceRefs: [options.verificationEvidenceRef ?? evidenceRef],
      rationaleSummary: "The contracted verification claims to pass.",
    },
  ];
  review.hardGates[0].evidenceRefs = [evidenceRef];
  return review;
}

function permissionExpansionRequest(harness: Harness): ArtifactBody {
  return {
    schemaVersion: "1.0",
    id: "clarification-permission-expansion",
    runId: harness.runId,
    question: "Should the task stay bounded or move to a newly authorized run?",
    reason: "permission_expanding",
    divergence: "Mutation requires authority absent from the current run.",
    evidenceInspected: [harness.requestRef],
    blockedBoundary: "repository.write",
    responseConstraints: "Choose bounded, new-run, or cancel.",
    responseChoices: [
      {
        id: "bounded",
        label: "Stay bounded",
        consequence: "Resume read-only work under current authority.",
        authorityEffect: "within_current_authority",
        runEffect: "resume",
      },
      {
        id: "new-run",
        label: "Authorize new run",
        consequence:
          "Terminate this run and request a separately authorized run.",
        authorityEffect: "requires_new_run",
        runEffect: "new_run",
      },
      {
        id: "cancel",
        label: "Cancel",
        consequence: "Terminate this run without mutation.",
        authorityEffect: "within_current_authority",
        runEffect: "cancel",
      },
    ],
    permissionExpansionRequired: true,
    rationaleSummary:
      "The immutable current authorization cannot be broadened.",
  };
}

function clarificationLineage(harness: Harness): {
  requestRef: string;
  answerRef: string;
} {
  const request = harness.service
    .getRun(harness.runId)
    .artifacts.find((artifact) => artifact.type === "ClarificationRequest");
  if (!request) throw new Error("ClarificationRequest expected");
  const requestRef = `artifact://${harness.runId}/${request.id}`;
  const answer = harness.service
    .getRun(harness.runId)
    .artifacts.find(
      (artifact) =>
        artifact.type === "UserMessage" &&
        artifact.sourceRefs.includes(requestRef),
    );
  if (!answer) throw new Error("Clarification answer expected");
  return {
    requestRef,
    answerRef: `artifact://${harness.runId}/${answer.id}`,
  };
}

function ledgerSnapshot(harness: Harness): unknown {
  return structuredClone({
    state: harness.service.getRun(harness.runId),
    trace: harness.service.getTrace(harness.runId),
  });
}

function submitPlanResults(
  harness: Harness,
  plan: ArtifactBody,
  evidenceRef: string,
): string[] {
  const resultRefs: string[] = [];
  for (const [index, node] of plan.nodes.entries()) {
    const id = `result-${String(index + 1).padStart(2, "0")}`;
    harness.submit(
      "WorkResult",
      "executor",
      resultBody(harness, node.id, evidenceRef, { id }),
    );
    resultRefs.push(`artifact://${harness.runId}/${id}`);
  }
  return resultRefs;
}

function remediationReview(
  harness: Harness,
  evidenceRef: string,
  resultRefs: string[],
): ArtifactBody {
  const review = passingQualityReview(harness, evidenceRef, {
    workResultRefs: resultRefs,
  });
  review.acceptanceResults[0].status = "fail";
  review.verificationResults[0].status = "fail";
  review.hardGates[0].passed = false;
  review.score = 50;
  review.decision = "remediate";
  review.findings = [
    {
      id: "finding-remediation",
      severity: "blocking",
      claim: "The accepted result needs a bounded remediation pass.",
      sourceRefs: [evidenceRef],
      rubricDimension: "acceptance",
      requiredCorrection: "Re-run the bounded repository verification.",
      preserveFields: [],
      correctionFields: [],
      rationaleSummary: "The correction remains inside current authority.",
    },
  ];
  review.remediationWorkOrder = {
    id: "remediation-order-01",
    failedCriterionIds: ["AC-1"],
    objective: "Repeat the bounded repository verification.",
    allowedCapabilities: ["repository.read"],
    permissions: readPermissions(),
    sourceRefs: [evidenceRef],
    maximumToolCalls: 1_000,
    rationaleSummary: "The remediation is evidence-backed and bounded.",
  };
  return review;
}

describe("closure and authority conformance", () => {
  describe("caller-supplied sourceRefs remain strict", () => {
    it("rejects an invalid top-level sourceRef", async () => {
      const harness = await createGroundedHarness();
      const before = ledgerSnapshot(harness);

      expect(() => submitFrame(harness, ["not-a-reference"])).toThrow(
        /sourceRefs must be unique valid reference URIs/i,
      );
      expect(ledgerSnapshot(harness)).toEqual(before);
    });

    it("rejects duplicate top-level sourceRefs instead of normalizing them", async () => {
      const harness = await createGroundedHarness();
      const before = ledgerSnapshot(harness);

      expect(() =>
        submitFrame(harness, [harness.requestRef, harness.requestRef]),
      ).toThrow(/sourceRefs must be unique/i);
      expect(ledgerSnapshot(harness)).toEqual(before);
    });

    it("rejects more than 256 top-level sourceRefs", async () => {
      const harness = await createGroundedHarness();
      const before = ledgerSnapshot(harness);
      const references = Array.from(
        { length: 257 },
        (_, index) => `repo://generated/source-${String(index)}.ts`,
      );

      expect(() => submitFrame(harness, references)).toThrow(
        /sourceRefs exceed the 256 item limit|at most 256/i,
      );
      expect(ledgerSnapshot(harness)).toEqual(before);
    });
  });

  describe("ProblemFrame identifiers are unique across the whole frame", () => {
    it.each(["knownFacts", "inferences", "unknowns", "criteria"] as const)(
      "rejects a known-fact identifier reused in %s",
      async (collection) => {
        const harness = await createGroundedHarness();
        const frame = harness.body("ProblemFrame");
        frame.applicableRuleRefs = [RULE_REF];
        if (collection === "knownFacts") {
          frame.knownFacts.push({
            ...structuredClone(frame.knownFacts[0]),
            claim: "A second fact illegally reuses the identifier.",
          });
        } else if (collection === "inferences") {
          frame.inferences = [
            {
              id: frame.knownFacts[0].id,
              claim: "An inference illegally reuses the fact identifier.",
              sourceRefs: [harness.requestRef],
              confidence: 0.5,
            },
          ];
        } else if (collection === "unknowns") {
          frame.unknowns = [
            {
              id: frame.knownFacts[0].id,
              question: "Which boundary remains unknown?",
              classification: "discoverable",
              impact: "The bounded diagnosis may remain incomplete.",
              evidenceInspected: [SOURCE_REF],
            },
          ];
        } else {
          frame.draftAcceptanceCriteria[0].id = frame.knownFacts[0].id;
        }

        expect(() =>
          harness.submit("ProblemFrame", "scenario_author", frame),
        ).toThrow(/identifier .* must be unique across the frame/i);
      },
    );
  });

  describe("FileChange hash truth table", () => {
    it.each([
      ["created", null, HASH],
      ["deleted", HASH, null],
      ["modified", HASH, OTHER_HASH],
    ] as const)(
      "accepts %s with before=%s and after=%s",
      (changeType, beforeHash, afterHash) => {
        expect(
          FileChangeSchema.safeParse({
            path: "src/example.ts",
            changeType,
            beforeHash,
            afterHash,
            diffRef: "artifact://run-01/diff-01",
          }).success,
        ).toBe(true);
      },
    );

    it.each([
      ["created", HASH, OTHER_HASH],
      ["created", null, null],
      ["deleted", null, null],
      ["deleted", HASH, OTHER_HASH],
      ["modified", null, OTHER_HASH],
      ["modified", HASH, null],
      ["modified", HASH, HASH],
    ] as const)(
      "rejects %s with before=%s and after=%s",
      (changeType, beforeHash, afterHash) => {
        expect(
          FileChangeSchema.safeParse({
            path: "src/example.ts",
            changeType,
            beforeHash,
            afterHash,
            diffRef: "artifact://run-01/diff-01",
          }).success,
        ).toBe(false);
      },
    );

    it("rejects a partial result that hides a completed repository write", async () => {
      const permissions = readPermissions();
      permissions.repository.write = ["apps/web/src/**"];
      const harness = await createGroundedHarness({
        mode: "fix_only",
        hostCapabilities: ["repository.read", "repository.write"],
      });
      submitAcceptedContract(harness, "repository.read", permissions);
      const plan = planBody(harness, [2], {
        capability: "repository.write",
        permissions,
      });
      plan.nodes[0].allowedTools = ["repository.read", "repository.write"];
      plan.nodes[0].requiredCapabilities = [
        "repository.read",
        "repository.write",
      ];
      harness.submit("WorkPlan", "quality_controller", plan);
      const evidenceRef = captureEvidence(harness, undefined, "diff");
      const result = resultBody(harness, "node-01", evidenceRef, {
        capability: "repository.write",
        target: SOURCE_PATH,
        mutating: true,
      });
      result.status = "partial";
      result.filesChanged = [];

      expect(() => harness.submit("WorkResult", "executor", result)).toThrow(
        /completed repository\.write action lacks an exact FileChange/i,
      );
    });
  });

  describe("completion verification ordering", () => {
    it("rejects a verifier scheduled before a mutating node", async () => {
      const permissions = readPermissions();
      permissions.repository.write = ["apps/web/src/**"];
      const harness = await createGroundedHarness({
        mode: "fix_only",
        hostCapabilities: ["repository.read", "repository.write"],
      });
      submitAcceptedContract(harness, "repository.read", permissions);
      const plan = planBody(harness, [1, 1], { permissions });
      plan.nodes[0].allowedTools = ["repository.read"];
      plan.nodes[0].requiredCapabilities = ["repository.read"];
      plan.nodes[0].permissions = readPermissions();
      plan.nodes[1].dependsOn = ["node-01"];
      plan.nodes[1].allowedTools = ["repository.write"];
      plan.nodes[1].requiredCapabilities = ["repository.write"];
      plan.nodes[1].permissions = structuredClone(permissions);

      expect(() =>
        harness.submit("WorkPlan", "quality_controller", plan),
      ).toThrow(/completion verification .* after mutating node/i);
    });

    it("rejects same-node verification recorded before mutation", async () => {
      const permissions = readPermissions();
      permissions.repository.write = ["apps/web/src/**"];
      const harness = await createGroundedHarness({
        mode: "fix_only",
        hostCapabilities: ["repository.read", "repository.write"],
      });
      submitAcceptedContract(harness, "repository.read", permissions);
      const plan = planBody(harness, [2], { permissions });
      plan.nodes[0].allowedTools = ["repository.read", "repository.write"];
      plan.nodes[0].requiredCapabilities = [
        "repository.read",
        "repository.write",
      ];
      harness.submit("WorkPlan", "quality_controller", plan);
      const evidenceRef = captureEvidence(harness, undefined, "diff");
      const result = resultBody(harness, "node-01", evidenceRef);
      result.actions = [
        result.actions[0],
        {
          id: "action-write",
          capability: "repository.write",
          target: SOURCE_PATH,
          mutating: true,
          status: "completed",
          evidenceRefs: [evidenceRef],
          rationaleSummary: "The bounded write completed.",
        },
      ];
      result.filesChanged = [
        {
          path: SOURCE_PATH,
          changeType: "modified",
          beforeHash: HASH,
          afterHash: OTHER_HASH,
          diffRef: evidenceRef,
        },
      ];

      expect(() => harness.submit("WorkResult", "executor", result)).toThrow(
        /completion verification .* after the final mutating action/i,
      );
    });
  });

  describe("repository context cannot prove execution", () => {
    it("rejects repo:// as completed action evidence", async () => {
      const harness = await createGroundedHarness();
      submitAcceptedContract(harness);
      harness.submit("WorkPlan", "quality_controller", planBody(harness, [1]));
      const evidenceRef = captureEvidence(harness);
      const result = resultBody(harness, "node-01", evidenceRef, {
        actionEvidenceRef: SOURCE_REF,
      });

      expect(() => harness.submit("WorkResult", "executor", result)).toThrow(
        /Repository context cannot prove an executed outcome.*actions/i,
      );
    });

    it("rejects repo:// as passed verification evidence", async () => {
      const harness = await createGroundedHarness();
      submitAcceptedContract(harness);
      harness.submit("WorkPlan", "quality_controller", planBody(harness, [1]));
      const evidenceRef = captureEvidence(harness);
      harness.submit(
        "WorkResult",
        "executor",
        resultBody(harness, "node-01", evidenceRef),
      );
      const review = passingQualityReview(harness, evidenceRef, {
        verificationEvidenceRef: SOURCE_REF,
      });

      expect(() =>
        harness.submit("QualityReview", "quality_controller", review),
      ).toThrow(
        /Repository context cannot prove an executed outcome.*verificationResults/i,
      );
    });

    it("rejects a mutating-only completion verification before review", async () => {
      const command = "npm test";
      const permissions = shellPermissions(command);
      const harness = await createGroundedHarness({
        mode: "fix_only",
        hostCapabilities: ["shell.execute"],
        shellExecuteAllowlist: [command],
      });
      submitAcceptedContract(harness, "shell.execute", permissions);
      harness.submit(
        "WorkPlan",
        "quality_controller",
        planBody(harness, [1], {
          capability: "shell.execute",
          permissions,
        }),
      );
      const evidenceRef = captureEvidence(harness, undefined, "tool_output");
      expect(() =>
        harness.submit(
          "WorkResult",
          "executor",
          resultBody(harness, "node-01", evidenceRef, {
            capability: "shell.execute",
            target: command,
            mutating: true,
          }),
        ),
      ).toThrow(/completion verification .* after the final mutating action/i);
    });

    it("does not accept pre-mutation evidence when a later verifier exists in the same node", async () => {
      const permissions = readPermissions();
      permissions.repository.write = ["apps/web/src/**"];
      const harness = await createGroundedHarness({
        mode: "fix_only",
        hostCapabilities: ["repository.read", "repository.write"],
      });
      submitAcceptedContract(harness, "repository.read", permissions);
      const plan = planBody(harness, [3], { permissions });
      plan.nodes[0].allowedTools = ["repository.read", "repository.write"];
      plan.nodes[0].requiredCapabilities = [
        "repository.read",
        "repository.write",
      ];
      harness.submit("WorkPlan", "quality_controller", plan);
      const oldEvidenceRef = captureEvidence(
        harness,
        undefined,
        "diff",
        "evidence-old",
      );
      const newEvidenceRef = captureEvidence(
        harness,
        undefined,
        "diff",
        "evidence-new",
      );
      const result = resultBody(harness, "node-01", newEvidenceRef);
      result.actions = [
        {
          ...result.actions[0],
          id: "action-read-old",
          evidenceRefs: [oldEvidenceRef],
        },
        {
          id: "action-write",
          capability: "repository.write",
          target: SOURCE_PATH,
          mutating: true,
          status: "completed",
          evidenceRefs: [oldEvidenceRef],
          rationaleSummary: "The bounded write completed.",
        },
        {
          ...result.actions[0],
          id: "action-read-new",
          evidenceRefs: [newEvidenceRef],
        },
      ];
      result.filesChanged = [
        {
          path: SOURCE_PATH,
          changeType: "modified",
          beforeHash: HASH,
          afterHash: OTHER_HASH,
          diffRef: oldEvidenceRef,
        },
      ];
      result.evidenceRefs = [oldEvidenceRef, newEvidenceRef];
      harness.submit("WorkResult", "executor", result);
      const review = passingQualityReview(harness, newEvidenceRef, {
        verificationEvidenceRef: oldEvidenceRef,
      });

      expect(() =>
        harness.submit("QualityReview", "quality_controller", review),
      ).toThrow(/verification .* lacks a completed capability action/i);
    });

    it("binds completion evidence to the scheduled post-mutation node", async () => {
      const permissions = readPermissions();
      permissions.repository.write = ["apps/web/src/**"];
      const harness = await createGroundedHarness({
        mode: "fix_only",
        hostCapabilities: ["repository.read", "repository.write"],
      });
      submitAcceptedContract(harness, "repository.read", permissions);
      const plan = planBody(harness, [1, 1, 1], { permissions });
      plan.nodes[0].acceptanceCriteria = [];
      plan.nodes[0].permissions = readPermissions();
      plan.nodes[1].dependsOn = ["node-01"];
      plan.nodes[1].allowedTools = ["repository.write"];
      plan.nodes[1].requiredCapabilities = ["repository.write"];
      plan.nodes[1].acceptanceCriteria = [];
      plan.nodes[1].permissions = structuredClone(permissions);
      plan.nodes[2].dependsOn = ["node-02"];
      plan.nodes[2].permissions = readPermissions();
      harness.submit("WorkPlan", "quality_controller", plan);

      const oldEvidenceRef = captureEvidence(
        harness,
        undefined,
        "repository",
        "evidence-old",
      );
      const preflight = resultBody(harness, "node-01", oldEvidenceRef, {
        id: "result-preflight",
      });
      preflight.acceptanceCoverage = [];
      harness.submit("WorkResult", "executor", preflight);

      const diffEvidenceRef = captureEvidence(
        harness,
        undefined,
        "diff",
        "evidence-diff",
      );
      const mutation = resultBody(harness, "node-02", diffEvidenceRef, {
        id: "result-mutation",
        capability: "repository.write",
        target: SOURCE_PATH,
        mutating: true,
      });
      mutation.acceptanceCoverage = [];
      mutation.filesChanged = [
        {
          path: SOURCE_PATH,
          changeType: "modified",
          beforeHash: HASH,
          afterHash: OTHER_HASH,
          diffRef: diffEvidenceRef,
        },
      ];
      harness.submit("WorkResult", "executor", mutation);

      const newEvidenceRef = captureEvidence(
        harness,
        undefined,
        "repository",
        "evidence-new",
      );
      harness.submit(
        "WorkResult",
        "executor",
        resultBody(harness, "node-03", newEvidenceRef, {
          id: "result-verification",
        }),
      );
      const review = passingQualityReview(harness, newEvidenceRef, {
        verificationEvidenceRef: oldEvidenceRef,
        workResultRefs: [
          `artifact://${harness.runId}/result-preflight`,
          `artifact://${harness.runId}/result-mutation`,
          `artifact://${harness.runId}/result-verification`,
        ],
      });

      expect(() =>
        harness.submit("QualityReview", "quality_controller", review),
      ).toThrow(/verification .* lacks a completed capability action/i);
    });
  });

  describe("permission-expanding clarification handoff", () => {
    it.each(["bounded", "new-run"] as const)(
      "requires the missing %s choice",
      async (missingChoice) => {
        const harness = await createGroundedHarness();
        const request = permissionExpansionRequest(harness);
        request.responseChoices = request.responseChoices.filter(
          (choice: ArtifactBody) => choice.id !== missingChoice,
        );

        expect(() =>
          harness.submit("ClarificationRequest", "scenario_author", request),
        ).toThrow(
          /requires both a bounded current-authority choice and an explicit new-run choice/i,
        );
      },
    );

    it("resumes the paused phase for the bounded choice", async () => {
      const harness = await createGroundedHarness();
      harness.submit(
        "ClarificationRequest",
        "scenario_author",
        permissionExpansionRequest(harness),
      );

      const answered = harness.service.answerClarification(
        harness.runId,
        "bounded",
      );
      expect(answered.run).toMatchObject({
        status: "running",
        phase: "agent_1_frame",
        resumePhase: null,
      });
      expect(answered.nextAction).toMatchObject({
        kind: "phase",
        phase: "agent_1_frame",
      });
    });

    it.each(["new-run", "cancel"] as const)(
      "terminal-cancels the current run for the %s choice",
      async (choice) => {
        const harness = await createGroundedHarness();
        harness.submit(
          "ClarificationRequest",
          "scenario_author",
          permissionExpansionRequest(harness),
        );

        const answered = harness.service.answerClarification(
          harness.runId,
          choice,
        );
        expect(answered.run.status).toBe("cancelled");
        expect(answered.nextAction).toMatchObject({
          kind: "terminal",
          phase: "cancelled",
          status: "cancelled",
          reportRef: null,
        });
      },
    );
  });

  describe("supporting artifacts cannot consume clarification lineage", () => {
    it("keeps lineage pending after ScenarioSpec", async () => {
      const harness = await createGroundedHarness();
      submitFrame(harness);
      harness.submit(
        "ClarificationRequest",
        "task_compiler",
        permissionExpansionRequest(harness),
      );
      harness.service.answerClarification(harness.runId, "bounded");
      const lineage = clarificationLineage(harness);

      expect(() =>
        harness.submit(
          "ScenarioSpec",
          "scenario_author",
          harness.body("ScenarioSpec"),
          [lineage.requestRef, lineage.answerRef],
        ),
      ).not.toThrow();
      expect(() => submitContract(harness)).toThrow(
        /resumed phase artifact must cite the exact clarification request and answer/i,
      );
      expect(() =>
        submitContract(harness, "repository.read", readPermissions(), [
          lineage.requestRef,
          lineage.answerRef,
        ]),
      ).not.toThrow();
    });

    it("keeps lineage pending after Evidence", async () => {
      const harness = await createGroundedHarness();
      submitAcceptedContract(harness);
      harness.submit("WorkPlan", "quality_controller", planBody(harness, [1]));
      harness.submit(
        "ClarificationRequest",
        "executor",
        permissionExpansionRequest(harness),
      );
      harness.service.answerClarification(harness.runId, "bounded");
      const lineage = clarificationLineage(harness);
      const evidenceRef = captureEvidence(harness, [
        lineage.requestRef,
        lineage.answerRef,
      ]);
      const result = resultBody(harness, "node-01", evidenceRef);

      expect(() => harness.submit("WorkResult", "executor", result)).toThrow(
        /resumed phase artifact must cite the exact clarification request and answer/i,
      );
      expect(() =>
        harness.submit("WorkResult", "executor", result, [
          lineage.requestRef,
          lineage.answerRef,
        ]),
      ).not.toThrow();
    });
  });

  describe("clarification budget exhaustion", () => {
    it("routes a second divergent boundary to an honest blocked report", async () => {
      const harness = await createGroundedHarness();
      harness.submit(
        "ClarificationRequest",
        "scenario_author",
        permissionExpansionRequest(harness),
      );
      harness.service.answerClarification(harness.runId, "bounded");
      const firstLineage = clarificationLineage(harness);
      submitFrame(harness, [firstLineage.requestRef, firstLineage.answerRef]);

      const second = permissionExpansionRequest(harness);
      second.id = "clarification-second-boundary";
      const routed = harness.submit(
        "ClarificationRequest",
        "task_compiler",
        second,
      );
      expect(routed.run).toMatchObject({
        status: "running",
        phase: "agent_5_report",
        outcomeHint: "blocked",
      });
      expect(routed.nextAction).toMatchObject({
        kind: "phase",
        phase: "user_report",
        requiredOutputType: "UserReport",
      });

      const report = harness.body("UserReport");
      report.terminalStatus = "blocked";
      report.completionClaims = [];
      report.findingRefs = [`artifact://${harness.runId}/${second.id}`];
      report.changeRefs = [];
      report.verificationRefs = [];
      report.summary =
        "A second material divergence exhausted the one-question budget.";
      const terminal = harness.submit("UserReport", "release_auditor", report);
      expect(terminal.run.status).toBe("blocked");
    });
  });

  describe("cumulative work-plan budgets and NextAction closure", () => {
    it("rejects a WorkPlan that cannot perform required contracted verification", async () => {
      const harness = await createGroundedHarness({
        hostCapabilities: ["repository.read", "browser.inspect"],
      });
      const contractPermissions = readPermissions();
      contractPermissions.browser.inspect = true;
      submitAcceptedContract(harness, "browser.inspect", contractPermissions);
      const before = ledgerSnapshot(harness);
      const plan = planBody(harness, [1]);

      expect(() =>
        harness.submit("WorkPlan", "quality_controller", plan),
      ).toThrow(/required verification VR-1.*browser\.inspect.*WorkPlan/i);
      expect(ledgerSnapshot(harness)).toEqual(before);
    });

    it("rejects an executable node whose budget cannot satisfy its required capabilities", async () => {
      const harness = await createGroundedHarness({
        hostCapabilities: ["repository.read", "browser.inspect"],
      });
      const permissions = readPermissions();
      permissions.browser.inspect = true;
      submitAcceptedContract(harness, "repository.read", permissions);
      const plan = planBody(harness, [1], { permissions });
      plan.nodes[0].requiredCapabilities = [
        "repository.read",
        "browser.inspect",
      ];
      plan.nodes[0].allowedTools = ["repository.read", "browser.inspect"];
      plan.nodes[0].permissions.browser.inspect = true;

      expect(() =>
        harness.submit("WorkPlan", "quality_controller", plan),
      ).toThrow(/tool budget cannot satisfy its required capabilities/i);
    });

    it("rejects required subagent spawning with no child budget", async () => {
      const harness = await createGroundedHarness({
        hostCapabilities: ["repository.read", "subagent.spawn"],
        nativeSubagents: "available",
      });
      const permissions = readPermissions();
      permissions.subagents = {
        spawn: true,
        maximumChildren: 1,
        maximumDepth: 1,
      };
      submitAcceptedContract(harness, "repository.read", permissions);
      const plan = planBody(harness, [1], {
        capability: "subagent.spawn",
        permissions,
      });
      plan.globalBudgets.maximumSubagentDepth = 1;
      plan.nodes[0].budgets.maximumChildren = 0;

      expect(() =>
        harness.submit("WorkPlan", "quality_controller", plan),
      ).toThrow(/requires a child budget for subagent\.spawn/i);
    });

    it("accepts exactly 4000 reserved node calls and reports zero remaining", async () => {
      const harness = await createGroundedHarness();
      submitAcceptedContract(harness);
      const accepted = harness.submit(
        "WorkPlan",
        "quality_controller",
        planBody(harness, [1_000, 1_000, 1_000, 1_000]),
      );

      expect(accepted.nextAction).toMatchObject({
        kind: "phase",
        phase: "agent_4_execute",
        remainingBudgets: { remainingPlanToolCalls: 0 },
      });
    });

    it("rejects a single plan reserving 4001 calls without changing the ledger", async () => {
      const harness = await createGroundedHarness();
      submitAcceptedContract(harness);
      const before = ledgerSnapshot(harness);
      const overBudget = planBody(harness, [1_000, 1_000, 1_000, 1_000, 1], {
        globalBudget: 4_000,
      });

      expect(() =>
        harness.submit("WorkPlan", "quality_controller", overBudget),
      ).toThrow(/node tool budgets exceed the global budget/i);
      expect(ledgerSnapshot(harness)).toEqual(before);
    });

    it("rejects cumulative multi-plan overage atomically and retains the controlling review", async () => {
      const harness = await createGroundedHarness();
      submitAcceptedContract(harness);
      const firstPlan = planBody(harness, [1_000, 1_000, 1_000, 500]);
      const planned = harness.submit(
        "WorkPlan",
        "quality_controller",
        firstPlan,
      );
      expect(planned.nextAction).toMatchObject({
        remainingBudgets: { remainingPlanToolCalls: 500 },
      });
      const evidenceRef = captureEvidence(harness);
      const resultRefs = submitPlanResults(harness, firstPlan, evidenceRef);
      const reviewed = harness.submit(
        "QualityReview",
        "quality_controller",
        remediationReview(harness, evidenceRef, resultRefs),
      );
      const controlRef = `artifact://${harness.runId}/quality-review-01`;
      expect(reviewed.nextAction).toMatchObject({
        kind: "phase",
        phase: "agent_3_plan",
        remainingBudgets: { remainingPlanToolCalls: 500 },
      });
      if (reviewed.nextAction.kind !== "phase") {
        throw new Error("Phase NextAction expected after remediation");
      }
      expect(reviewed.nextAction.inputRefs).toContain(controlRef);

      const before = ledgerSnapshot(harness);
      const secondPlan = planBody(harness, [501], {
        id: "plan-02",
        controlRef,
      });
      expect(() =>
        harness.submit("WorkPlan", "quality_controller", secondPlan),
      ).toThrow(/cumulative run tool-call budget of 4000/i);
      expect(ledgerSnapshot(harness)).toEqual(before);

      const current = harness.service.controller.getNextAction(harness.runId);
      expect(current).toMatchObject({
        remainingBudgets: { remainingPlanToolCalls: 500 },
      });
      if (current.kind !== "phase") throw new Error("Phase action expected");
      expect(current.inputRefs).toContain(controlRef);
    });
  });
});
