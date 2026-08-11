import { z } from "zod";

import {
  ArtifactTypeSchema,
  IdentifierSchema,
  LogicalRoleSchema,
  MAX_ARTIFACT_BYTES,
  MAX_COLLECTION_ITEMS,
  ReferenceUriSchema,
  RunIdSchema,
  SchemaVersionSchema,
  Sha256Schema,
  TimestampSchema,
} from "./common.js";
import {
  ClarificationRequestSchema,
  ContextManifestSchema,
  NextActionSchema,
  RunEnvelopeSchema,
} from "./controller.js";
import { TraceEventSchema } from "./trace.js";
import { EvidenceArtifactSchema } from "./evidence.js";
import {
  ProblemFrameSchema,
  PromptReviewSchema,
  ScenarioSpecSchema,
  TaskContractSchema,
} from "./workflow-intent.js";
import {
  QualityReviewSchema,
  WorkPlanSchema,
  WorkResultSchema,
} from "./workflow-execution.js";
import {
  ReceiptAuditSchema,
  ReleaseAuditSchema,
  UserReportSchema,
} from "./workflow-release.js";

export const ArtifactBodySchemas = {
  RunEnvelope: RunEnvelopeSchema,
  ContextManifest: ContextManifestSchema,
  NextAction: NextActionSchema,
  ClarificationRequest: ClarificationRequestSchema,
  ProblemFrame: ProblemFrameSchema,
  ScenarioSpec: ScenarioSpecSchema,
  TaskContract: TaskContractSchema,
  PromptReview: PromptReviewSchema,
  WorkPlan: WorkPlanSchema,
  WorkResult: WorkResultSchema,
  QualityReview: QualityReviewSchema,
  ReleaseAudit: ReleaseAuditSchema,
  ReceiptAudit: ReceiptAuditSchema,
  UserReport: UserReportSchema,
  TraceEvent: TraceEventSchema,
  Evidence: EvidenceArtifactSchema,
} as const;

const ArtifactMetadataShape = {
  schemaVersion: SchemaVersionSchema,
  id: IdentifierSchema,
  runId: RunIdSchema,
  producer: LogicalRoleSchema,
  createdAt: TimestampSchema,
  sha256: Sha256Schema,
  sourceRefs: z.array(ReferenceUriSchema).max(MAX_COLLECTION_ITEMS),
  redaction: z.enum(["none", "partial", "full"]),
  bodyBytes: z.number().int().min(1).max(MAX_ARTIFACT_BYTES),
  immutable: z.literal(true),
};

const ArtifactEnvelopeVariants = [
  z
    .object({
      ...ArtifactMetadataShape,
      artifactType: z.literal("RunEnvelope"),
      body: RunEnvelopeSchema,
    })
    .strict(),
  z
    .object({
      ...ArtifactMetadataShape,
      artifactType: z.literal("ContextManifest"),
      body: ContextManifestSchema,
    })
    .strict(),
  z
    .object({
      ...ArtifactMetadataShape,
      artifactType: z.literal("NextAction"),
      body: NextActionSchema,
    })
    .strict(),
  z
    .object({
      ...ArtifactMetadataShape,
      artifactType: z.literal("ClarificationRequest"),
      body: ClarificationRequestSchema,
    })
    .strict(),
  z
    .object({
      ...ArtifactMetadataShape,
      artifactType: z.literal("ProblemFrame"),
      body: ProblemFrameSchema,
    })
    .strict(),
  z
    .object({
      ...ArtifactMetadataShape,
      artifactType: z.literal("ScenarioSpec"),
      body: ScenarioSpecSchema,
    })
    .strict(),
  z
    .object({
      ...ArtifactMetadataShape,
      artifactType: z.literal("TaskContract"),
      body: TaskContractSchema,
    })
    .strict(),
  z
    .object({
      ...ArtifactMetadataShape,
      artifactType: z.literal("PromptReview"),
      body: PromptReviewSchema,
    })
    .strict(),
  z
    .object({
      ...ArtifactMetadataShape,
      artifactType: z.literal("WorkPlan"),
      body: WorkPlanSchema,
    })
    .strict(),
  z
    .object({
      ...ArtifactMetadataShape,
      artifactType: z.literal("WorkResult"),
      body: WorkResultSchema,
    })
    .strict(),
  z
    .object({
      ...ArtifactMetadataShape,
      artifactType: z.literal("QualityReview"),
      body: QualityReviewSchema,
    })
    .strict(),
  z
    .object({
      ...ArtifactMetadataShape,
      artifactType: z.literal("ReleaseAudit"),
      body: ReleaseAuditSchema,
    })
    .strict(),
  z
    .object({
      ...ArtifactMetadataShape,
      artifactType: z.literal("ReceiptAudit"),
      body: ReceiptAuditSchema,
    })
    .strict(),
  z
    .object({
      ...ArtifactMetadataShape,
      artifactType: z.literal("UserReport"),
      body: UserReportSchema,
    })
    .strict(),
  z
    .object({
      ...ArtifactMetadataShape,
      artifactType: z.literal("TraceEvent"),
      body: TraceEventSchema,
    })
    .strict(),
  z
    .object({
      ...ArtifactMetadataShape,
      artifactType: z.literal("Evidence"),
      body: EvidenceArtifactSchema,
    })
    .strict(),
] as const;

export const ArtifactEnvelopeSchema = z
  .discriminatedUnion("artifactType", ArtifactEnvelopeVariants)
  .superRefine((artifact, context) => {
    if (artifact.body.runId !== artifact.runId) {
      context.addIssue({
        code: "custom",
        path: ["body", "runId"],
        message: "Artifact body runId must match its envelope",
      });
    }

    const bodyIdentifier =
      "id" in artifact.body ? artifact.body.id : artifact.body.runId;
    if (bodyIdentifier !== artifact.id) {
      context.addIssue({
        code: "custom",
        path: ["id"],
        message: "Artifact envelope id must match its body identifier",
      });
    }
  });

export type ArtifactBodySchemasMap = typeof ArtifactBodySchemas;
export type ArtifactBodyByType = {
  [Type in keyof ArtifactBodySchemasMap]: z.infer<ArtifactBodySchemasMap[Type]>;
};
export type ArtifactEnvelope = z.infer<typeof ArtifactEnvelopeSchema>;

export function parseArtifactBody<Type extends keyof ArtifactBodySchemasMap>(
  artifactType: Type,
  input: unknown,
): ArtifactBodyByType[Type] {
  return ArtifactBodySchemas[artifactType].parse(
    input,
  ) as ArtifactBodyByType[Type];
}

export function safeParseArtifactBody<
  Type extends keyof ArtifactBodySchemasMap,
>(artifactType: Type, input: unknown) {
  return ArtifactBodySchemas[artifactType].safeParse(input);
}

export function parseArtifactEnvelope(input: unknown): ArtifactEnvelope {
  return ArtifactEnvelopeSchema.parse(input);
}

export function safeParseArtifactEnvelope(input: unknown) {
  return ArtifactEnvelopeSchema.safeParse(input);
}

export function isArtifactType(
  input: unknown,
): input is keyof ArtifactBodySchemasMap {
  return ArtifactTypeSchema.safeParse(input).success;
}
