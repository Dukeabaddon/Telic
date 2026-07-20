import { z } from "zod";
import { isAbsolute, win32 } from "node:path";

import {
  ArtifactTypeSchema,
  ArtifactUriSchema,
  BoundedTextSchema,
  IdentifierSchema,
  IntentModeSchema,
  MAX_COLLECTION_ITEMS,
  PermissionSetSchema,
  PhaseSchema,
  ReferenceUriSchema,
  RelativePathSchema,
  RunIdSchema,
  RunStatusSchema,
  SchemaVersionSchema,
  Sha256Schema,
  SummarySchema,
  TimestampSchema,
} from "./common.js";

export const RevisionBudgetsSchema = z
  .object({
    promptRevisions: z.number().int().min(0).max(1),
    postExecutionRemediations: z.number().int().min(0).max(1),
    maximumParallelWorkers: z.number().int().min(1).max(16),
    maximumSubagentDepth: z.number().int().min(0).max(4),
  })
  .strict();

export const WorkingContextSchema = z
  .object({
    repositoryRoot: z
      .string()
      .min(1)
      .max(4_096)
      .refine(
        (value) => isAbsolute(value) || win32.isAbsolute(value),
        "Repository root must be absolute",
      ),
    activeFiles: z.array(RelativePathSchema).max(MAX_COLLECTION_ITEMS),
    applicableRuleRefs: z.array(ReferenceUriSchema).max(MAX_COLLECTION_ITEMS),
  })
  .strict();

export const HostDescriptorSchema = z
  .object({
    name: z.string().min(1).max(128),
    version: z.string().min(1).max(128).nullable(),
    nativeSubagents: z.enum(["available", "unavailable", "unknown"]),
    capabilities: z.array(z.string().min(1).max(255)).max(MAX_COLLECTION_ITEMS),
  })
  .strict();

export const AuthorizationSchema = z
  .object({
    granted: PermissionSetSchema,
    denied: PermissionSetSchema,
  })
  .strict();

export const RunEnvelopeSchema = z
  .object({
    schemaVersion: SchemaVersionSchema,
    runId: RunIdSchema,
    createdAt: TimestampSchema,
    originalRequestRef: ArtifactUriSchema,
    followupRequestRefs: z.array(ArtifactUriSchema).max(MAX_COLLECTION_ITEMS),
    requestedMode: IntentModeSchema.nullable(),
    status: RunStatusSchema,
    workingContext: WorkingContextSchema,
    host: HostDescriptorSchema,
    authorization: AuthorizationSchema,
    budgets: RevisionBudgetsSchema,
    policyRefs: z.array(ReferenceUriSchema).max(MAX_COLLECTION_ITEMS),
  })
  .strict();

const ContextCandidateBaseSchema = z.object({
  id: IdentifierSchema,
  ref: ReferenceUriSchema,
  locations: z.array(z.string().min(1).max(1_024)).max(MAX_COLLECTION_ITEMS),
  contentHash: Sha256Schema.nullable(),
  byteSize: z.number().int().min(0).max(100_000_000).nullable(),
});

export const SelectedContextCandidateSchema = ContextCandidateBaseSchema.extend(
  {
    contentHash: Sha256Schema,
    byteSize: z.number().int().min(0).max(100_000_000),
    decision: z.literal("selected"),
    selectionReason: SummarySchema,
    path: RelativePathSchema,
    score: z.number().int().min(0).max(10_000_000),
    pinned: z.boolean(),
  },
).strict();

export const ExcludedContextCandidateSchema = ContextCandidateBaseSchema.extend(
  {
    decision: z.literal("excluded"),
    exclusionReason: SummarySchema,
  },
).strict();

export const ContextCandidateSchema = z.discriminatedUnion("decision", [
  SelectedContextCandidateSchema,
  ExcludedContextCandidateSchema,
]);

export const ExcludedCandidateSummarySchema = z
  .object({
    reason: z.enum([
      "binary_file",
      "duplicate_content",
      "excluded_directory",
      "file_count_budget",
      "file_too_large",
      "inventory_budget",
      "invalid_path",
      "invalid_utf8",
      "low_relevance",
      "non_regular_file",
      "path_escape",
      "secret_content",
      "secret_like_file",
      "symlink_escape",
      "total_bytes_budget",
      "unreadable_file",
    ]),
    count: z.number().int().min(1).max(10_000_000),
  })
  .strict();

export const ContextManifestSchema = z
  .object({
    schemaVersion: SchemaVersionSchema,
    id: IdentifierSchema,
    runId: RunIdSchema,
    repositoryFingerprint: z
      .object({
        headCommit: z
          .string()
          .regex(/^[a-f0-9]{40,64}$/)
          .nullable(),
        dirtyWorktreeHash: Sha256Schema,
      })
      .strict(),
    pinnedRefs: z.array(ReferenceUriSchema).max(MAX_COLLECTION_ITEMS),
    candidates: z.array(ContextCandidateSchema).max(2_048),
    derivedRefs: z.array(ReferenceUriSchema).max(MAX_COLLECTION_ITEMS),
    excludedCandidateSummaries: z
      .array(ExcludedCandidateSummarySchema)
      .max(MAX_COLLECTION_ITEMS),
    inventorySource: z.enum(["git", "ripgrep", "filesystem"]),
    warnings: z.array(SummarySchema).max(MAX_COLLECTION_ITEMS),
    budget: z
      .object({
        maximumFiles: z.number().int().min(1).max(100_000),
        maximumFileBytes: z.number().int().min(1).max(100_000_000),
        maximumTotalBytes: z.number().int().min(1).max(100_000_000),
        maximumInventoryFiles: z.number().int().min(1).max(10_000_000),
        candidateFiles: z.number().int().min(0).max(10_000_000),
        selectedFiles: z.number().int().min(0).max(100_000),
        estimatedTokens: z.number().int().min(0).max(10_000_000),
        selectedBytes: z.number().int().min(0).max(100_000_000),
      })
      .strict()
      .refine(
        (budget) => budget.selectedBytes <= budget.maximumTotalBytes,
        "Selected context exceeds its byte budget",
      ),
  })
  .strict()
  .superRefine((manifest, context) => {
    const seen = new Set<string>();
    let selectedByteTotal = 0;

    for (const [index, candidate] of manifest.candidates.entries()) {
      if (seen.has(candidate.ref)) {
        context.addIssue({
          code: "custom",
          path: ["candidates", index, "ref"],
          message: "Context candidate references must be unique",
        });
      }
      seen.add(candidate.ref);
      if (candidate.decision === "selected" && candidate.byteSize !== null) {
        selectedByteTotal += candidate.byteSize;
      }
    }

    if (selectedByteTotal !== manifest.budget.selectedBytes) {
      context.addIssue({
        code: "custom",
        path: ["budget", "selectedBytes"],
        message: "Selected byte total must match selected candidates",
      });
    }
    const selectedCount = manifest.candidates.filter(
      (candidate) => candidate.decision === "selected",
    ).length;
    if (selectedCount !== manifest.budget.selectedFiles) {
      context.addIssue({
        code: "custom",
        path: ["budget", "selectedFiles"],
        message: "Selected file count must match selected candidates",
      });
    }
    const exclusionReasons = new Set<string>();
    for (const [
      index,
      summary,
    ] of manifest.excludedCandidateSummaries.entries()) {
      if (exclusionReasons.has(summary.reason)) {
        context.addIssue({
          code: "custom",
          path: ["excludedCandidateSummaries", index, "reason"],
          message: "Exclusion summary reasons must be unique",
        });
      }
      exclusionReasons.add(summary.reason);
    }
  });

export const ClarificationRequestSchema = z
  .object({
    schemaVersion: SchemaVersionSchema,
    id: IdentifierSchema,
    runId: RunIdSchema,
    question: BoundedTextSchema,
    reason: z.enum(["user_owned_materially_divergent", "permission_expanding"]),
    divergence: BoundedTextSchema,
    evidenceInspected: z
      .array(ReferenceUriSchema)
      .min(1)
      .max(MAX_COLLECTION_ITEMS),
    blockedBoundary: z.string().min(1).max(255),
    responseConstraints: SummarySchema,
    responseChoices: z
      .array(
        z
          .object({
            id: IdentifierSchema,
            label: z.string().min(1).max(255),
            consequence: BoundedTextSchema,
            authorityEffect: z.enum([
              "within_current_authority",
              "requires_new_run",
            ]),
            runEffect: z.enum(["resume", "cancel", "new_run"]),
          })
          .strict(),
      )
      .min(2)
      .max(8),
    permissionExpansionRequired: z.boolean(),
    rationaleSummary: SummarySchema,
  })
  .strict()
  .superRefine((request, context) => {
    if (
      request.permissionExpansionRequired !==
      (request.reason === "permission_expanding")
    ) {
      context.addIssue({
        code: "custom",
        path: ["permissionExpansionRequired"],
        message:
          "Permission expansion flag must match the typed clarification reason",
      });
    }
    const ids = request.responseChoices.map((choice) => choice.id);
    const consequences = request.responseChoices.map(
      (choice) => choice.consequence,
    );
    if (
      new Set(ids).size !== ids.length ||
      new Set(consequences).size !== consequences.length
    ) {
      context.addIssue({
        code: "custom",
        path: ["responseChoices"],
        message:
          "Clarification choices require unique identifiers and materially distinct consequences",
      });
    }
    const authorityEffects = request.responseChoices.map(
      (choice) => choice.authorityEffect,
    );
    for (const [index, choice] of request.responseChoices.entries()) {
      if (
        (choice.authorityEffect === "requires_new_run") !==
        (choice.runEffect === "new_run")
      ) {
        context.addIssue({
          code: "custom",
          path: ["responseChoices", index],
          message:
            "A new-run choice must explicitly require new authority, and only that choice may do so",
        });
      }
    }
    if (
      request.reason === "user_owned_materially_divergent" &&
      authorityEffects.some((effect) => effect !== "within_current_authority")
    ) {
      context.addIssue({
        code: "custom",
        path: ["responseChoices"],
        message:
          "User-owned clarification choices must remain within current authority",
      });
    }
    if (
      request.reason === "permission_expanding" &&
      (!request.responseChoices.some(
        (choice) =>
          choice.authorityEffect === "within_current_authority" &&
          choice.runEffect === "resume",
      ) ||
        !authorityEffects.includes("requires_new_run"))
    ) {
      context.addIssue({
        code: "custom",
        path: ["responseChoices"],
        message:
          "Permission-expanding clarification requires both a bounded current-authority choice and an explicit new-run choice",
      });
    }
  });

const RemainingBudgetsSchema = z
  .object({
    promptRevisions: z.number().int().min(0).max(1),
    postExecutionRemediations: z.number().int().min(0).max(1),
    remainingPlanToolCalls: z.number().int().min(0).max(4_000),
    maximumParallelWorkers: z.number().int().min(1).max(16),
    maximumSubagentDepth: z.number().int().min(0).max(4),
  })
  .strict();

const NextActionBaseSchema = z.object({
  schemaVersion: SchemaVersionSchema,
  id: IdentifierSchema,
  runId: RunIdSchema,
  createdAt: TimestampSchema,
  rationaleSummary: SummarySchema,
});

export const PhaseNextActionSchema = NextActionBaseSchema.extend({
  kind: z.literal("phase"),
  phase: PhaseSchema.exclude([
    "awaiting_clarification",
    "completed",
    "partial",
    "blocked",
    "cancelled",
  ]),
  logicalRole: z.enum([
    "controller",
    "scenario_author",
    "task_compiler",
    "quality_controller",
    "executor",
    "release_auditor",
  ]),
  instructionRef: ArtifactUriSchema,
  inputRefs: z.array(ReferenceUriSchema).max(MAX_COLLECTION_ITEMS),
  contextManifestRef: ArtifactUriSchema.nullable(),
  requiredOutputType: ArtifactTypeSchema,
  requiredOutputSchema: z.record(z.string(), z.unknown()),
  additionalOutputSchemas: z.record(
    z.string().min(1).max(128),
    z.record(z.string(), z.unknown()),
  ),
  workNodeId: IdentifierSchema.nullable(),
  effectivePermissions: PermissionSetSchema,
  remainingBudgets: RemainingBudgetsSchema,
  stopConditions: z.array(BoundedTextSchema).max(64),
}).strict();

export const ClarificationNextActionSchema = NextActionBaseSchema.extend({
  kind: z.literal("clarification"),
  phase: z.literal("awaiting_clarification"),
  clarificationRequestRef: ArtifactUriSchema,
  effectivePermissions: PermissionSetSchema,
  remainingBudgets: RemainingBudgetsSchema,
}).strict();

export const TerminalNextActionSchema = NextActionBaseSchema.extend({
  kind: z.literal("terminal"),
  phase: z.enum(["completed", "partial", "blocked", "cancelled"]),
  status: z.enum([
    "completed",
    "partial",
    "blocked",
    "cancelled",
    "failed_verification",
  ]),
  reportRef: ArtifactUriSchema.nullable(),
}).strict();

export const NextActionSchema = z.discriminatedUnion("kind", [
  PhaseNextActionSchema,
  ClarificationNextActionSchema,
  TerminalNextActionSchema,
]);

export type RevisionBudgets = z.infer<typeof RevisionBudgetsSchema>;
export type RunEnvelope = z.infer<typeof RunEnvelopeSchema>;
export type ContextCandidate = z.infer<typeof ContextCandidateSchema>;
export type ExcludedCandidateSummary = z.infer<
  typeof ExcludedCandidateSummarySchema
>;
export type ContextManifest = z.infer<typeof ContextManifestSchema>;
export type ClarificationRequest = z.infer<typeof ClarificationRequestSchema>;
export type NextAction = z.infer<typeof NextActionSchema>;
