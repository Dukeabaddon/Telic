import { z } from "zod";

import {
  ActionCapabilitySchema,
  ArtifactUriSchema,
  BoundedTextSchema,
  EvidenceClaimSchema,
  FindingSchema,
  IdentifierSchema,
  MAX_COLLECTION_ITEMS,
  PermissionSetSchema,
  ReferenceUriSchema,
  RelativePathSchema,
  RunIdSchema,
  SchemaVersionSchema,
  Sha256Schema,
  SummarySchema,
} from "./common.js";
import { HardGateResultSchema } from "./workflow-intent.js";

export { ActionCapabilitySchema } from "./common.js";

export const WorkNodeSchema = z
  .object({
    id: IdentifierSchema,
    logicalRole: z.string().min(1).max(255),
    objective: BoundedTextSchema,
    dependsOn: z.array(IdentifierSchema).max(64),
    inputRefs: z.array(ReferenceUriSchema).max(MAX_COLLECTION_ITEMS),
    contextRefs: z.array(ReferenceUriSchema).max(MAX_COLLECTION_ITEMS),
    allowedTools: z.array(ActionCapabilitySchema).max(MAX_COLLECTION_ITEMS),
    requiredCapabilities: z
      .array(ActionCapabilitySchema)
      .max(MAX_COLLECTION_ITEMS),
    permissions: PermissionSetSchema,
    outputType: z.literal("WorkResult"),
    acceptanceCriteria: z.array(IdentifierSchema).max(MAX_COLLECTION_ITEMS),
    stopConditions: z.array(BoundedTextSchema).max(64),
    budgets: z
      .object({
        maximumToolCalls: z.number().int().min(0).max(1_000),
        maximumChildren: z.number().int().min(0).max(16),
      })
      .strict(),
  })
  .strict();

export const WorkPlanSchema = z
  .object({
    schemaVersion: SchemaVersionSchema,
    id: IdentifierSchema,
    runId: RunIdSchema,
    taskContractRef: ArtifactUriSchema,
    executionMode: z.literal("serial"),
    nodes: z.array(WorkNodeSchema).min(1).max(64),
    joinRules: z.array(BoundedTextSchema).max(64),
    globalBudgets: z
      .object({
        maximumToolCalls: z.number().int().min(0).max(4_000),
        maximumParallelWorkers: z.literal(1),
        maximumSubagentDepth: z.number().int().min(0).max(4),
      })
      .strict(),
    planValidation: z.enum(["pending", "valid", "invalid"]),
    rationaleSummary: SummarySchema,
  })
  .strict()
  .superRefine((plan, context) => {
    const nodeIds = new Set<string>();
    for (const [index, node] of plan.nodes.entries()) {
      if (nodeIds.has(node.id)) {
        context.addIssue({
          code: "custom",
          path: ["nodes", index, "id"],
          message: "Work node identifiers must be unique",
        });
      }
      nodeIds.add(node.id);
    }

    for (const [index, node] of plan.nodes.entries()) {
      for (const dependency of node.dependsOn) {
        if (!nodeIds.has(dependency)) {
          context.addIssue({
            code: "custom",
            path: ["nodes", index, "dependsOn"],
            message: `Unknown work-node dependency: ${dependency}`,
          });
        }
        if (dependency === node.id) {
          context.addIssue({
            code: "custom",
            path: ["nodes", index, "dependsOn"],
            message: "A work node cannot depend on itself",
          });
        }
      }
    }

    const graph = new Map(plan.nodes.map((node) => [node.id, node.dependsOn]));
    const visiting = new Set<string>();
    const visited = new Set<string>();
    const hasCycle = (nodeId: string): boolean => {
      if (visiting.has(nodeId)) return true;
      if (visited.has(nodeId)) return false;
      visiting.add(nodeId);
      for (const dependency of graph.get(nodeId) ?? []) {
        if (graph.has(dependency) && hasCycle(dependency)) return true;
      }
      visiting.delete(nodeId);
      visited.add(nodeId);
      return false;
    };

    if (plan.nodes.some((node) => hasCycle(node.id))) {
      context.addIssue({
        code: "custom",
        path: ["nodes"],
        message: "WorkPlan nodes must form a directed acyclic graph",
      });
    }
  });

export const WorkActionSchema = z
  .object({
    id: IdentifierSchema,
    capability: ActionCapabilitySchema,
    target: z.string().min(1).max(2_048),
    mutating: z.boolean(),
    status: z.enum(["completed", "failed", "denied", "skipped"]),
    evidenceRefs: z.array(ReferenceUriSchema).max(MAX_COLLECTION_ITEMS),
    rationaleSummary: SummarySchema,
  })
  .strict()
  .superRefine((action, context) => {
    if (action.status === "completed" && action.evidenceRefs.length === 0) {
      context.addIssue({
        code: "custom",
        path: ["evidenceRefs"],
        message: "Completed actions require direct evidence references",
      });
    }
  });

export const FileChangeSchema = z
  .object({
    path: RelativePathSchema,
    changeType: z.enum(["created", "modified", "deleted"]),
    beforeHash: Sha256Schema.nullable(),
    afterHash: Sha256Schema.nullable(),
    diffRef: ArtifactUriSchema,
  })
  .strict()
  .superRefine((change, context) => {
    if (change.changeType === "created") {
      if (change.beforeHash !== null) {
        context.addIssue({
          code: "custom",
          path: ["beforeHash"],
          message: "Created files cannot have a before hash",
        });
      }
      if (change.afterHash === null) {
        context.addIssue({
          code: "custom",
          path: ["afterHash"],
          message: "Created files require an after hash",
        });
      }
    }
    if (change.changeType === "deleted") {
      if (change.beforeHash === null) {
        context.addIssue({
          code: "custom",
          path: ["beforeHash"],
          message: "Deleted files require a before hash",
        });
      }
      if (change.afterHash !== null) {
        context.addIssue({
          code: "custom",
          path: ["afterHash"],
          message: "Deleted files cannot have an after hash",
        });
      }
    }
    if (
      change.changeType === "modified" &&
      (change.beforeHash === null ||
        change.afterHash === null ||
        change.beforeHash === change.afterHash)
    ) {
      context.addIssue({
        code: "custom",
        path: ["afterHash"],
        message:
          "Modified files require distinct, non-null before and after hashes",
      });
    }
  });

export const TestResultSchema = z
  .object({
    id: IdentifierSchema,
    name: z.string().min(1).max(512),
    status: z.enum(["passed", "failed", "skipped", "unavailable"]),
    commandRef: ArtifactUriSchema.nullable(),
    outputRef: ArtifactUriSchema.nullable(),
    exitCode: z.number().int().min(0).max(255).nullable(),
    rationaleSummary: SummarySchema,
  })
  .strict()
  .superRefine((test, context) => {
    if (
      (test.status === "passed" || test.status === "failed") &&
      !test.outputRef
    ) {
      context.addIssue({
        code: "custom",
        path: ["outputRef"],
        message: "Executed tests require captured output evidence",
      });
    }
  });

export const AcceptanceCoverageSchema = z
  .object({
    criterionId: IdentifierSchema,
    status: z.enum(["pass", "fail", "unverified", "not_applicable"]),
    evidenceRefs: z.array(ReferenceUriSchema).max(MAX_COLLECTION_ITEMS),
    rationaleSummary: SummarySchema,
  })
  .strict()
  .superRefine((coverage, context) => {
    if (
      (coverage.status === "pass" || coverage.status === "fail") &&
      coverage.evidenceRefs.length === 0
    ) {
      context.addIssue({
        code: "custom",
        path: ["evidenceRefs"],
        message: `${coverage.status} acceptance results require evidence`,
      });
    }
  });

export const WorkResultSchema = z
  .object({
    schemaVersion: SchemaVersionSchema,
    id: IdentifierSchema,
    runId: RunIdSchema,
    workPlanRef: ArtifactUriSchema,
    nodeId: IdentifierSchema,
    status: z.enum(["completed", "partial", "blocked", "failed"]),
    observations: z.array(EvidenceClaimSchema).max(MAX_COLLECTION_ITEMS),
    inferences: z.array(EvidenceClaimSchema).max(MAX_COLLECTION_ITEMS),
    actions: z.array(WorkActionSchema).max(MAX_COLLECTION_ITEMS),
    filesChanged: z.array(FileChangeSchema).max(MAX_COLLECTION_ITEMS),
    toolEventRefs: z.array(ReferenceUriSchema).max(MAX_COLLECTION_ITEMS),
    evidenceRefs: z.array(ReferenceUriSchema).max(MAX_COLLECTION_ITEMS),
    testResults: z.array(TestResultSchema).max(MAX_COLLECTION_ITEMS),
    acceptanceCoverage: z
      .array(AcceptanceCoverageSchema)
      .max(MAX_COLLECTION_ITEMS),
    unresolvedIssues: z.array(BoundedTextSchema).max(MAX_COLLECTION_ITEMS),
    deviations: z.array(BoundedTextSchema).max(MAX_COLLECTION_ITEMS),
    rationaleSummary: SummarySchema,
  })
  .strict()
  .superRefine((result, context) => {
    if (result.status === "completed" && result.evidenceRefs.length === 0) {
      context.addIssue({
        code: "custom",
        path: ["evidenceRefs"],
        message: "Completed work requires direct evidence references",
      });
    }
    if (result.status === "completed") {
      for (const [index, action] of result.actions.entries()) {
        if (action.status === "failed" || action.status === "denied") {
          context.addIssue({
            code: "custom",
            path: ["actions", index, "status"],
            message: "Completed work cannot contain failed or denied actions",
          });
        }
      }
      for (const [index, test] of result.testResults.entries()) {
        if (test.status === "failed") {
          context.addIssue({
            code: "custom",
            path: ["testResults", index, "status"],
            message: "Completed work cannot contain failed tests",
          });
        }
      }
      for (const [index, coverage] of result.acceptanceCoverage.entries()) {
        if (coverage.status !== "pass") {
          context.addIssue({
            code: "custom",
            path: ["acceptanceCoverage", index, "status"],
            message:
              "Required acceptance criteria must pass for completed work",
          });
        }
      }
    }
    for (const [index, observation] of result.observations.entries()) {
      if (
        observation.status !== "observed" &&
        observation.status !== "user_reported"
      ) {
        context.addIssue({
          code: "custom",
          path: ["observations", index, "status"],
          message: "Observations must be observed or user-reported",
        });
      }
    }
    for (const [index, inference] of result.inferences.entries()) {
      if (
        inference.status !== "inferred" &&
        inference.status !== "unverified"
      ) {
        context.addIssue({
          code: "custom",
          path: ["inferences", index, "status"],
          message: "Inferences must be inferred or unverified",
        });
      }
    }
  });

export const ReviewCheckSchema = z
  .object({
    id: IdentifierSchema,
    subjectRef: ReferenceUriSchema.nullable().default(null),
    description: BoundedTextSchema,
    status: z.enum(["pass", "fail", "unverified", "not_applicable"]),
    evidenceRefs: z.array(ReferenceUriSchema).max(MAX_COLLECTION_ITEMS),
    rationaleSummary: SummarySchema,
  })
  .strict()
  .superRefine((check, context) => {
    if (
      (check.status === "pass" || check.status === "fail") &&
      check.evidenceRefs.length === 0
    ) {
      context.addIssue({
        code: "custom",
        path: ["evidenceRefs"],
        message: `${check.status} review checks require evidence`,
      });
    }
  });

export const VerificationResultSchema = z
  .object({
    requirementId: IdentifierSchema,
    capability: ActionCapabilitySchema,
    status: z.enum(["pass", "fail", "unverified", "unavailable"]),
    evidenceRefs: z.array(ReferenceUriSchema).max(MAX_COLLECTION_ITEMS),
    rationaleSummary: SummarySchema,
  })
  .strict()
  .superRefine((result, context) => {
    if (
      (result.status === "pass" || result.status === "fail") &&
      result.evidenceRefs.length === 0
    ) {
      context.addIssue({
        code: "custom",
        path: ["evidenceRefs"],
        message: `${result.status} verification results require evidence`,
      });
    }
  });

export const RemediationWorkOrderSchema = z
  .object({
    id: IdentifierSchema,
    failedCriterionIds: z
      .array(IdentifierSchema)
      .min(1)
      .max(MAX_COLLECTION_ITEMS),
    objective: BoundedTextSchema,
    allowedCapabilities: z
      .array(ActionCapabilitySchema)
      .max(MAX_COLLECTION_ITEMS),
    permissions: PermissionSetSchema,
    sourceRefs: z.array(ReferenceUriSchema).min(1).max(MAX_COLLECTION_ITEMS),
    maximumToolCalls: z.number().int().min(1).max(1_000),
    rationaleSummary: SummarySchema,
  })
  .strict();

export const CorrectionWorkOrderSchema = z
  .object({
    id: IdentifierSchema,
    targetCriterionIds: z
      .array(IdentifierSchema)
      .min(1)
      .max(MAX_COLLECTION_ITEMS),
    objective: BoundedTextSchema,
    allowedCapabilities: z
      .array(ActionCapabilitySchema)
      .min(1)
      .max(MAX_COLLECTION_ITEMS),
    permissions: PermissionSetSchema,
    sourceRefs: z.array(ReferenceUriSchema).min(1).max(MAX_COLLECTION_ITEMS),
    maximumToolCalls: z.number().int().min(1).max(1_000),
    rationaleSummary: SummarySchema,
  })
  .strict();

/**
 * The explicit evidence boundary between read-only diagnosis and mutation.
 * Artifact target types must also be checked by the run controller; this
 * schema keeps the semantic claim, direct references, scope, and authority
 * decision typed.
 */
export const DiagnosisGateSchema = z
  .object({
    id: IdentifierSchema,
    status: z.enum(["supported", "unsupported", "unverified"]),
    rootCause: BoundedTextSchema,
    directEvidenceRefs: z.array(ArtifactUriSchema).max(MAX_COLLECTION_ITEMS),
    correctionWorkOrder: CorrectionWorkOrderSchema.nullable(),
    withinApprovedScope: z.boolean(),
    permissionsSufficient: z.boolean(),
    rationaleSummary: SummarySchema,
  })
  .strict()
  .superRefine((gate, context) => {
    if (gate.status === "supported" && gate.directEvidenceRefs.length === 0) {
      context.addIssue({
        code: "custom",
        path: ["directEvidenceRefs"],
        message: "A supported diagnosis requires direct evidence",
      });
    }
    if (gate.status === "supported" && gate.correctionWorkOrder === null) {
      context.addIssue({
        code: "custom",
        path: ["correctionWorkOrder"],
        message:
          "A supported diagnosis requires a scoped correction work order",
      });
    }
    if (gate.status !== "supported" && gate.correctionWorkOrder !== null) {
      context.addIssue({
        code: "custom",
        path: ["correctionWorkOrder"],
        message:
          "Only a supported diagnosis may authorize a correction work order",
      });
    }
    if (
      gate.correctionWorkOrder !== null &&
      !gate.directEvidenceRefs.every((reference) =>
        gate.correctionWorkOrder!.sourceRefs.includes(reference),
      )
    ) {
      context.addIssue({
        code: "custom",
        path: ["correctionWorkOrder", "sourceRefs"],
        message: "The correction work order must retain all diagnosis evidence",
      });
    }
  });

export const QualityReviewSchema = z
  .object({
    schemaVersion: SchemaVersionSchema,
    id: IdentifierSchema,
    runId: RunIdSchema,
    taskContractRef: ArtifactUriSchema,
    workPlanRefs: z
      .array(ArtifactUriSchema)
      .max(MAX_COLLECTION_ITEMS)
      .default([]),
    workResultRefs: z.array(ArtifactUriSchema).max(MAX_COLLECTION_ITEMS),
    rubricId: z.literal("execution-quality-v1"),
    acceptanceResults: z
      .array(AcceptanceCoverageSchema)
      .min(1)
      .max(MAX_COLLECTION_ITEMS),
    ruleCompliance: z.array(ReviewCheckSchema).max(MAX_COLLECTION_ITEMS),
    regressionChecks: z.array(ReviewCheckSchema).max(MAX_COLLECTION_ITEMS),
    verificationResults: z
      .array(VerificationResultSchema)
      .max(MAX_COLLECTION_ITEMS),
    findings: z.array(FindingSchema).max(MAX_COLLECTION_ITEMS),
    hardGates: z.array(HardGateResultSchema).min(1).max(MAX_COLLECTION_ITEMS),
    score: z.number().min(0).max(100),
    remainingRemediations: z.number().int().min(0).max(1),
    decision: z.enum([
      "pass",
      "proceed_to_fix",
      "remediate",
      "block",
      "partial",
    ]),
    diagnosisGate: DiagnosisGateSchema.nullable()
      .default(null)
      .describe(
        "Required with supported direct evidence, approved scope, and sufficient permissions when decision is proceed_to_fix.",
      ),
    remediationWorkOrder: RemediationWorkOrderSchema.nullable(),
    rationaleSummary: SummarySchema,
  })
  .strict()
  .superRefine((review, context) => {
    if (
      review.workPlanRefs.length === 0 &&
      review.workResultRefs.length === 0
    ) {
      context.addIssue({
        code: "custom",
        path: ["workResultRefs"],
        message: "Quality review requires a work plan or work result reference",
      });
    }
    const failedGate = review.hardGates.some((gate) => !gate.passed);
    const blockingFinding = review.findings.some(
      (finding) => finding.severity === "blocking",
    );
    const incompleteCriterion = review.acceptanceResults.some(
      (result) => result.status !== "pass",
    );
    const incompleteReviewCheck = [
      ...review.ruleCompliance,
      ...review.regressionChecks,
    ].some((check) => check.status !== "pass");

    if (
      (review.decision === "pass" || review.decision === "proceed_to_fix") &&
      review.score < 80
    ) {
      context.addIssue({
        code: "custom",
        path: ["score"],
        message: "Progression requires a quality score of at least 80",
      });
    }

    if (
      review.decision === "pass" &&
      (failedGate ||
        blockingFinding ||
        incompleteCriterion ||
        incompleteReviewCheck)
    ) {
      context.addIssue({
        code: "custom",
        path: ["decision"],
        message:
          "Required acceptance must pass; failed gates, checks, or blocking findings prevent progression",
      });
    }

    if (review.decision === "remediate") {
      if (review.remainingRemediations !== 1) {
        context.addIssue({
          code: "custom",
          path: ["remainingRemediations"],
          message:
            "Remediation cannot be requested after the shared budget is exhausted",
        });
      }
      if (review.remediationWorkOrder === null) {
        context.addIssue({
          code: "custom",
          path: ["remediationWorkOrder"],
          message: "A remediation decision requires a scoped work order",
        });
      }
    } else if (review.remediationWorkOrder !== null) {
      context.addIssue({
        code: "custom",
        path: ["remediationWorkOrder"],
        message:
          "Only a remediation decision may include a remediation work order",
      });
    }

    if (
      review.decision === "proceed_to_fix" &&
      (failedGate || blockingFinding || incompleteReviewCheck)
    ) {
      context.addIssue({
        code: "custom",
        path: ["decision"],
        message:
          "A failed hard gate, review check, or blocking finding prevents progression to a fix plan",
      });
    }

    if (review.decision === "proceed_to_fix") {
      if (review.diagnosisGate === null) {
        context.addIssue({
          code: "custom",
          path: ["diagnosisGate"],
          message:
            "Progression to a fix plan requires a typed diagnosis evidence gate",
        });
      } else if (
        review.diagnosisGate.status !== "supported" ||
        review.diagnosisGate.directEvidenceRefs.length === 0 ||
        review.diagnosisGate.correctionWorkOrder === null ||
        !review.diagnosisGate.withinApprovedScope ||
        !review.diagnosisGate.permissionsSufficient
      ) {
        context.addIssue({
          code: "custom",
          path: ["diagnosisGate"],
          message:
            "The diagnosis gate must support the cause and correction with direct evidence, approved scope, and sufficient permissions",
        });
      }
    }
    if (review.decision !== "proceed_to_fix" && review.diagnosisGate !== null) {
      context.addIssue({
        code: "custom",
        path: ["diagnosisGate"],
        message: "Only proceed_to_fix may include a diagnosis correction gate",
      });
    }
  });

export type WorkNode = z.infer<typeof WorkNodeSchema>;
export type WorkPlan = z.infer<typeof WorkPlanSchema>;
export type WorkAction = z.infer<typeof WorkActionSchema>;
export type FileChange = z.infer<typeof FileChangeSchema>;
export type TestResult = z.infer<typeof TestResultSchema>;
export type AcceptanceCoverage = z.infer<typeof AcceptanceCoverageSchema>;
export type WorkResult = z.infer<typeof WorkResultSchema>;
export type RemediationWorkOrder = z.infer<typeof RemediationWorkOrderSchema>;
export type VerificationResult = z.infer<typeof VerificationResultSchema>;
export type CorrectionWorkOrder = z.infer<typeof CorrectionWorkOrderSchema>;
export type DiagnosisGate = z.infer<typeof DiagnosisGateSchema>;
export type QualityReview = z.infer<typeof QualityReviewSchema>;
