import { z } from "zod";

export const SCHEMA_VERSION = "1.0" as const;
export const MAX_TEXT_BYTES = 32_768;
export const MAX_SUMMARY_BYTES = 4_096;
export const MAX_ARTIFACT_BYTES = 2_097_152;
export const MAX_COLLECTION_ITEMS = 256;

const textEncoder = new TextEncoder();

function isWithinUtf8Budget(value: string, maximumBytes: number): boolean {
  return textEncoder.encode(value).byteLength <= maximumBytes;
}

export const SchemaVersionSchema = z.literal(SCHEMA_VERSION);

export const IdentifierSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/, "Invalid Telic identifier");

export const RunIdSchema = IdentifierSchema;
export const TimestampSchema = z.string().datetime({ offset: true });
export const RelativePathSchema = z
  .string()
  .min(1)
  .max(1_024)
  .refine((value) => !value.startsWith("/"), "Path must be repository-relative")
  .refine(
    (value) => !value.split("/").includes(".."),
    "Path must not traverse outside the repository",
  );

export const Sha256Schema = z
  .string()
  .regex(/^sha256:[a-f0-9]{64}$/, "Expected a lowercase sha256 digest");

export const ArtifactUriSchema = z
  .string()
  .min(1)
  .max(2_048)
  .regex(/^artifact:\/\/[A-Za-z0-9._~!$&'()*+,;=:@%/-]+$/);

export const TraceUriSchema = z
  .string()
  .min(1)
  .max(2_048)
  .regex(/^trace:\/\/[A-Za-z0-9._~!$&'()*+,;=:@%/-]+$/);

export const RepositoryUriSchema = z
  .string()
  .min(1)
  .max(2_048)
  .regex(/^repo:\/\/[A-Za-z0-9._~!$&'()*+,;=:@%/-]+$/);

export const ReferenceUriSchema = z.union([
  ArtifactUriSchema,
  TraceUriSchema,
  RepositoryUriSchema,
]);

export const BoundedTextSchema = z
  .string()
  .min(1)
  .max(MAX_TEXT_BYTES)
  .refine(
    (value) => isWithinUtf8Budget(value, MAX_TEXT_BYTES),
    `Text exceeds the ${MAX_TEXT_BYTES}-byte UTF-8 limit`,
  );
export const SummarySchema = z
  .string()
  .min(1)
  .max(MAX_SUMMARY_BYTES)
  .refine(
    (value) => isWithinUtf8Budget(value, MAX_SUMMARY_BYTES),
    `Summary exceeds the ${MAX_SUMMARY_BYTES}-byte UTF-8 limit`,
  );

export const IntentModeSchema = z.enum([
  "report_only",
  "plan_only",
  "analyze_only",
  "fix_only",
  "analyze_and_fix",
]);

export const RunTopologySchema = z.enum(["micro", "standard", "forensic"]);

export const ActionCapabilitySchema = z.enum([
  "repository.read",
  "repository.write",
  "repository.delete",
  "shell.inspect",
  "shell.execute",
  "runtime.inspect",
  "runtime.restart",
  "browser.inspect",
  "browser.mutate",
  "network.read",
  "external.write",
  "subagent.spawn",
]);

export const VerificationCapabilitySchema = z.enum([
  "repository.read",
  "shell.inspect",
  "shell.execute",
  "runtime.inspect",
  "browser.inspect",
  "network.read",
]);

export const TaskContractFieldSchema = z.enum([
  "schemaVersion",
  "id",
  "runId",
  "version",
  "originalRequestRef",
  "problemFrameRef",
  "intentMode",
  "objective",
  "scope",
  "constraints",
  "nonGoals",
  "contextRefs",
  "ruleRefs",
  "permissions",
  "acceptanceCriteria",
  "requiredOutputs",
  "verificationRequirements",
  "stopConditions",
  "assumptions",
  "unresolvedQuestions",
  "rationaleSummary",
]);

export const TaskContractCorrectionFieldSchema = z.enum([
  "objective",
  "contextRefs",
  "requiredOutputs",
  "verificationRequirements",
  "stopConditions",
  "assumptions",
  "unresolvedQuestions",
  "rationaleSummary",
]);

export const RunStatusSchema = z.enum([
  "active",
  "awaiting_input",
  "completed",
  "partial",
  "blocked",
  "cancelled",
  "failed_verification",
]);

export const TerminalStatusSchema = z.enum([
  "completed",
  "partial",
  "blocked",
  "cancelled",
  "failed_verification",
]);

export const PhaseSchema = z.enum([
  "received",
  "context_discovery",
  "awaiting_clarification",
  "agent_1_frame",
  "agent_2_compile",
  "agent_1_review",
  "agent_2_revision",
  "contract_validation",
  "agent_3_plan",
  "plan_validation",
  "agent_4_execute",
  "diagnosis_review",
  "agent_3_quality_review",
  "agent_3_evidence_reverify",
  "remediation_plan",
  "agent_4_remediation",
  "agent_5_release_audit",
  "user_report",
  "completed",
  "partial",
  "blocked",
  "cancelled",
]);

export const LogicalRoleSchema = z.enum([
  "controller",
  "scenario_author",
  "task_compiler",
  "quality_controller",
  "executor",
  "release_auditor",
  "host",
  "tool",
  "user",
]);

export const ArtifactTypeSchema = z.enum([
  "RunEnvelope",
  "ContextManifest",
  "NextAction",
  "ClarificationRequest",
  "ProblemFrame",
  "ScenarioSpec",
  "TaskContract",
  "PromptReview",
  "WorkPlan",
  "WorkResult",
  "QualityReview",
  "ReleaseAudit",
  "ReceiptAudit",
  "UserReport",
  "TraceEvent",
  "Evidence",
]);

export const ArtifactRefSchema = z
  .object({
    uri: ArtifactUriSchema,
    mediaType: z.string().min(1).max(255),
    sha256: Sha256Schema,
    summary: SummarySchema,
  })
  .strict();

export const TraceRefSchema = z
  .object({
    uri: TraceUriSchema,
  })
  .strict();

export const RepositoryPermissionsSchema = z
  .object({
    read: z.array(z.string().min(1).max(1_024)).max(MAX_COLLECTION_ITEMS),
    write: z.array(z.string().min(1).max(1_024)).max(MAX_COLLECTION_ITEMS),
    delete: z.array(z.string().min(1).max(1_024)).max(MAX_COLLECTION_ITEMS),
  })
  .strict();

export const ShellPermissionsSchema = z
  .object({
    inspect: z.boolean(),
    executeAllowlist: z
      .array(z.string().min(1).max(2_048))
      .max(MAX_COLLECTION_ITEMS),
  })
  .strict();

export const RuntimePermissionsSchema = z
  .object({
    inspect: z.array(z.string().min(1).max(255)).max(MAX_COLLECTION_ITEMS),
    restart: z.array(z.string().min(1).max(255)).max(MAX_COLLECTION_ITEMS),
  })
  .strict();

export const BrowserPermissionsSchema = z
  .object({
    inspect: z.boolean(),
    mutateState: z.boolean(),
  })
  .strict();

export const NetworkPermissionsSchema = z
  .object({
    readDomains: z.array(z.string().min(1).max(253)).max(MAX_COLLECTION_ITEMS),
    externalWrite: z.boolean(),
  })
  .strict();

export const SubagentPermissionsSchema = z
  .object({
    spawn: z.boolean(),
    maximumChildren: z.number().int().min(0).max(16),
    maximumDepth: z.number().int().min(0).max(4),
  })
  .strict();

export const PermissionSetSchema = z
  .object({
    repository: RepositoryPermissionsSchema,
    shell: ShellPermissionsSchema,
    runtime: RuntimePermissionsSchema,
    browser: BrowserPermissionsSchema,
    network: NetworkPermissionsSchema,
    subagents: SubagentPermissionsSchema,
  })
  .strict();

export const EMPTY_PERMISSIONS = Object.freeze({
  repository: Object.freeze({ read: [], write: [], delete: [] }),
  shell: Object.freeze({ inspect: false, executeAllowlist: [] }),
  runtime: Object.freeze({ inspect: [], restart: [] }),
  browser: Object.freeze({ inspect: false, mutateState: false }),
  network: Object.freeze({ readDomains: [], externalWrite: false }),
  subagents: Object.freeze({
    spawn: false,
    maximumChildren: 0,
    maximumDepth: 0,
  }),
});

export const EvidenceStatusSchema = z.enum([
  "observed",
  "inferred",
  "user_reported",
  "unverified",
]);

export const EvidenceClaimSchema = z
  .object({
    id: IdentifierSchema,
    text: BoundedTextSchema,
    status: EvidenceStatusSchema,
    evidenceRefs: z.array(ReferenceUriSchema).max(MAX_COLLECTION_ITEMS),
    confidence: z.number().min(0).max(1),
  })
  .strict()
  .superRefine((claim, context) => {
    if (
      (claim.status === "observed" || claim.status === "inferred") &&
      claim.evidenceRefs.length === 0
    ) {
      context.addIssue({
        code: "custom",
        path: ["evidenceRefs"],
        message: `${claim.status} claims require evidence`,
      });
    }
  });

export const FindingSchema = z
  .object({
    id: IdentifierSchema,
    severity: z.enum(["info", "warning", "blocking"]),
    claim: BoundedTextSchema,
    sourceRefs: z.array(ReferenceUriSchema).max(MAX_COLLECTION_ITEMS),
    rubricDimension: z.string().min(1).max(128).nullable(),
    requiredCorrection: BoundedTextSchema.nullable(),
    preserveFields: z.array(TaskContractFieldSchema).max(64),
    correctionFields: z
      .array(TaskContractCorrectionFieldSchema)
      .max(64)
      .default([]),
    rationaleSummary: SummarySchema,
  })
  .strict()
  .superRefine((finding, context) => {
    if (finding.severity === "blocking" && finding.sourceRefs.length === 0) {
      context.addIssue({
        code: "custom",
        path: ["sourceRefs"],
        message: "Blocking findings require supporting source references",
      });
    }
  });

export type IntentMode = z.infer<typeof IntentModeSchema>;
export type RunTopology = z.infer<typeof RunTopologySchema>;
export type ActionCapability = z.infer<typeof ActionCapabilitySchema>;
export type RunStatus = z.infer<typeof RunStatusSchema>;
export type TerminalStatus = z.infer<typeof TerminalStatusSchema>;
export type Phase = z.infer<typeof PhaseSchema>;
export type LogicalRole = z.infer<typeof LogicalRoleSchema>;
export type ArtifactType = z.infer<typeof ArtifactTypeSchema>;
export type ArtifactRef = z.infer<typeof ArtifactRefSchema>;
export type TraceRef = z.infer<typeof TraceRefSchema>;
export type PermissionSet = z.infer<typeof PermissionSetSchema>;
export type EvidenceClaim = z.infer<typeof EvidenceClaimSchema>;
export type Finding = z.infer<typeof FindingSchema>;
