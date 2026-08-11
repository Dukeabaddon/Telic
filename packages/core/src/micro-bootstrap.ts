import type { ArtifactSubmission, RunRecord } from "./types.js";

interface ProblemFrameBody {
  id: string;
  goal: string;
  knownFacts?: Array<{ provenance?: string; sourceRef?: string }>;
  inferences?: Array<{ sourceRefs?: string[] }>;
  scope: { include: string[]; exclude: string[] };
  constraints: string[];
  nonGoals: string[];
  applicableRuleRefs: string[];
  draftAcceptanceCriteria: Array<{
    id: string;
    stage: "diagnosis" | "completion";
    requirement: string;
    evidenceRequired: string[];
  }>;
}

interface EnvelopeBody {
  authorization: {
    granted: Record<string, unknown>;
  };
}

export function buildMicroExecutionPack(
  run: RunRecord,
  problemFrame: ProblemFrameBody,
  contextManifestRef: string | null,
  originalRequestRef: string,
  envelope: EnvelopeBody,
): ArtifactSubmission[] {
  const contractId = "contract-01";
  const planId = "plan-01";
  const problemFrameRef = `artifact://${run.runId}/${problemFrame.id}`;
  const criterion = problemFrame.draftAcceptanceCriteria[0];
  if (!criterion) {
    throw new Error("Micro bootstrap requires one draft acceptance criterion");
  }

  const requiredContextRefs = new Set<string>();
  for (const fact of problemFrame.knownFacts ?? []) {
    if (fact.provenance !== "user" && typeof fact.sourceRef === "string") {
      requiredContextRefs.add(fact.sourceRef);
    }
  }
  for (const inference of problemFrame.inferences ?? []) {
    for (const ref of inference.sourceRefs ?? []) requiredContextRefs.add(ref);
  }
  if (contextManifestRef) requiredContextRefs.add(contextManifestRef);

  const sourceRefs = [problemFrameRef, ...(contextManifestRef ? [contextManifestRef] : [])];

  const executes =
    run.requestedMode === "fix_only" || run.requestedMode === "analyze_only";

  const contractBody = {
    schemaVersion: "1.0" as const,
    id: contractId,
    runId: run.runId,
    version: 1,
    originalRequestRef,
    problemFrameRef,
    intentMode: run.requestedMode,
    objective: problemFrame.goal,
    scope: problemFrame.scope,
    constraints: problemFrame.constraints,
    nonGoals: problemFrame.nonGoals,
    contextRefs: [...requiredContextRefs],
    ruleRefs: problemFrame.applicableRuleRefs,
    permissions: envelope.authorization.granted,
    acceptanceCriteria: [criterion],
    requiredOutputs: executes
      ? ["Evidence-backed work result"]
      : ["Evidence-backed answer"],
    verificationRequirements: executes
      ? [
          {
            id: "VR-MICRO",
            stage: "completion" as const,
            description:
              "Capture repository evidence for the bounded micro execution.",
            required: true,
            capability: "repository.read",
            fallback: "Stop if repository evidence cannot be captured.",
          },
        ]
      : [],
    stopConditions: ["Stop within the micro topology scope."],
    assumptions: [],
    unresolvedQuestions: [],
    rationaleSummary:
      "Controller bootstrap contract for micro topology execution.",
  };

  const maximumToolCalls =
    run.requestedMode === "report_only" || run.requestedMode === "plan_only"
      ? 0
      : run.requestedMode === "fix_only" && run.topology === "micro"
        ? 8
        : 32;

  const allowedTools =
    run.requestedMode === "fix_only" && run.topology === "micro"
      ? ["repository.read", "repository.write"]
      : ["repository.read"];
  const requiredCapabilities =
    run.requestedMode === "fix_only" && run.topology === "micro"
      ? ["repository.read", "repository.write"]
      : ["repository.read"];

  const planBody = {
    schemaVersion: "1.0" as const,
    id: planId,
    runId: run.runId,
    taskContractRef: `artifact://${run.runId}/${contractId}`,
    executionMode: "serial" as const,
    nodes: [
      {
        id: "micro-execute",
        logicalRole: "executor" as const,
        objective: problemFrame.goal,
        dependsOn: [] as string[],
        inputRefs: [`artifact://${run.runId}/${contractId}`],
        contextRefs: [...requiredContextRefs],
        allowedTools,
        requiredCapabilities,
        permissions: envelope.authorization.granted,
        outputType: "WorkResult" as const,
        acceptanceCriteria: [criterion.id],
        stopConditions: ["Stop within the micro topology scope."],
        budgets: { maximumToolCalls, maximumChildren: 0 },
      },
    ],
    joinRules: [],
    globalBudgets: {
      maximumToolCalls,
      maximumParallelWorkers: 1,
      maximumSubagentDepth: 0,
    },
    planValidation: "valid" as const,
    rationaleSummary: "Controller bootstrap serial plan for micro topology.",
  };

  return [
    {
      id: contractId,
      runId: run.runId,
      type: "TaskContract",
      schemaVersion: "1.0",
      producer: "task_compiler",
      sourceRefs,
      body: contractBody,
    },
    {
      id: planId,
      runId: run.runId,
      type: "WorkPlan",
      schemaVersion: "1.0",
      producer: "quality_controller",
      sourceRefs: [`artifact://${run.runId}/${contractId}`],
      body: planBody,
    },
  ];
}
