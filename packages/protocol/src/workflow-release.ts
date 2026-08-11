import { z } from "zod";

import {
  ArtifactUriSchema,
  BoundedTextSchema,
  EvidenceClaimSchema,
  FindingSchema,
  IdentifierSchema,
  MAX_COLLECTION_ITEMS,
  PermissionSetSchema,
  ReferenceUriSchema,
  RunIdSchema,
  SchemaVersionSchema,
  SummarySchema,
  TerminalStatusSchema,
  TimestampSchema,
  TraceUriSchema,
} from "./common.js";
import {
  ActionCapabilitySchema,
  ReviewCheckSchema,
} from "./workflow-execution.js";

export const ClaimEvidenceEntrySchema = z
  .object({
    claimId: IdentifierSchema,
    claim: BoundedTextSchema,
    criterionIds: z.array(IdentifierSchema).min(1).max(MAX_COLLECTION_ITEMS),
    basis: z.enum(["direct", "user_reported"]),
    status: z.enum(["supported", "unsupported", "contradicted", "unverified"]),
    evidenceRefs: z.array(ReferenceUriSchema).max(MAX_COLLECTION_ITEMS),
    rationaleSummary: SummarySchema,
  })
  .strict()
  .superRefine((entry, context) => {
    if (entry.status === "supported" && entry.evidenceRefs.length === 0) {
      context.addIssue({
        code: "custom",
        path: ["evidenceRefs"],
        message: "Supported release claims require evidence",
      });
    }
  });

export const ReleaseDefectSchema = z
  .object({
    id: IdentifierSchema,
    failedCriterionIds: z
      .array(IdentifierSchema)
      .min(1)
      .max(MAX_COLLECTION_ITEMS),
    description: BoundedTextSchema,
    allowedCapabilities: z
      .array(ActionCapabilitySchema)
      .max(MAX_COLLECTION_ITEMS),
    permissions: PermissionSetSchema,
    sourceRefs: z.array(ReferenceUriSchema).min(1).max(MAX_COLLECTION_ITEMS),
    maximumToolCalls: z.number().int().min(1).max(1_000),
    returnToRole: z.literal("quality_controller"),
    rationaleSummary: SummarySchema,
  })
  .strict();

export const ReleaseAuditSchema = z
  .object({
    schemaVersion: SchemaVersionSchema,
    id: IdentifierSchema,
    runId: RunIdSchema,
    originalRequestRef: ArtifactUriSchema,
    taskContractRef: ArtifactUriSchema,
    workPlanRefs: z
      .array(ArtifactUriSchema)
      .max(MAX_COLLECTION_ITEMS)
      .default([]),
    workResultRefs: z.array(ArtifactUriSchema).max(MAX_COLLECTION_ITEMS),
    qualityReviewRef: ArtifactUriSchema,
    userFidelity: z.array(ReviewCheckSchema).min(1).max(MAX_COLLECTION_ITEMS),
    modeCompliance: z.enum(["pass", "fail"]),
    claimEvidenceMatrix: z
      .array(ClaimEvidenceEntrySchema)
      .max(MAX_COLLECTION_ITEMS),
    unresolvedRisks: z.array(BoundedTextSchema).max(MAX_COLLECTION_ITEMS),
    findings: z.array(FindingSchema).max(MAX_COLLECTION_ITEMS),
    remainingRemediations: z.number().int().min(0).max(1),
    decision: z.enum(["release", "remediate", "partial", "block"]),
    remediationDefect: ReleaseDefectSchema.nullable(),
    userReportRef: ArtifactUriSchema.nullable(),
    rationaleSummary: SummarySchema,
  })
  .strict()
  .superRefine((audit, context) => {
    const claimIds = audit.claimEvidenceMatrix.map((entry) => entry.claimId);
    if (new Set(claimIds).size !== claimIds.length) {
      context.addIssue({
        code: "custom",
        path: ["claimEvidenceMatrix"],
        message: "Release-audit claim identifiers must be unique",
      });
    }
    if (audit.workPlanRefs.length === 0 && audit.workResultRefs.length === 0) {
      context.addIssue({
        code: "custom",
        path: ["workResultRefs"],
        message: "Release audit requires a work plan or work result reference",
      });
    }
    const incompleteFidelity = audit.userFidelity.some(
      (check) => check.status !== "pass",
    );
    const unsupportedClaim = audit.claimEvidenceMatrix.some(
      (entry) => entry.status !== "supported",
    );
    const blockingFinding = audit.findings.some(
      (finding) => finding.severity === "blocking",
    );

    if (
      audit.decision === "release" &&
      (audit.modeCompliance === "fail" ||
        incompleteFidelity ||
        unsupportedClaim ||
        blockingFinding)
    ) {
      context.addIssue({
        code: "custom",
        path: ["decision"],
        message:
          "Mode, fidelity, evidence, and blocking defects prevent release",
      });
    }

    if (audit.decision === "remediate") {
      if (audit.remainingRemediations !== 1) {
        context.addIssue({
          code: "custom",
          path: ["remainingRemediations"],
          message: "Release remediation cannot exceed the shared budget",
        });
      }
      if (audit.remediationDefect === null) {
        context.addIssue({
          code: "custom",
          path: ["remediationDefect"],
          message: "A remediation decision requires a typed release defect",
        });
      }
      if (audit.userReportRef !== null) {
        context.addIssue({
          code: "custom",
          path: ["userReportRef"],
          message: "A remediation decision is not ready for a user report",
        });
      }
    } else if (audit.remediationDefect !== null) {
      context.addIssue({
        code: "custom",
        path: ["remediationDefect"],
        message: "Only a remediation decision may include a release defect",
      });
    }

    if (audit.decision !== "remediate" && audit.userReportRef === null) {
      context.addIssue({
        code: "custom",
        path: ["userReportRef"],
        message: `${audit.decision} requires a user report`,
      });
    }
    if (
      (audit.decision === "partial" || audit.decision === "block") &&
      audit.modeCompliance === "pass" &&
      !incompleteFidelity &&
      !unsupportedClaim &&
      audit.findings.length === 0 &&
      audit.unresolvedRisks.length === 0
    ) {
      context.addIssue({
        code: "custom",
        path: ["decision"],
        message:
          "Partial or blocked release audits must retain a concrete failure or unresolved risk",
      });
    }
  });

export const NextUserActionSchema = z
  .object({
    id: IdentifierSchema,
    description: BoundedTextSchema,
    requiresAuthorization: z.boolean(),
  })
  .strict();

export const UserReportSchema = z
  .object({
    schemaVersion: SchemaVersionSchema,
    id: IdentifierSchema,
    runId: RunIdSchema,
    terminalStatus: TerminalStatusSchema,
    summary: BoundedTextSchema,
    completionClaims: z.array(EvidenceClaimSchema).max(MAX_COLLECTION_ITEMS),
    findingRefs: z.array(ReferenceUriSchema).max(MAX_COLLECTION_ITEMS),
    changeRefs: z.array(ReferenceUriSchema).max(MAX_COLLECTION_ITEMS),
    verificationRefs: z.array(ReferenceUriSchema).max(MAX_COLLECTION_ITEMS),
    unresolvedRisks: z.array(BoundedTextSchema).max(MAX_COLLECTION_ITEMS),
    permissionsHonored: z.boolean(),
    nextActions: z.array(NextUserActionSchema).max(MAX_COLLECTION_ITEMS),
    traceRef: TraceUriSchema,
    rationaleSummary: SummarySchema,
  })
  .strict()
  .superRefine((report, context) => {
    if (report.terminalStatus === "completed") {
      if (report.completionClaims.length === 0) {
        context.addIssue({
          code: "custom",
          path: ["completionClaims"],
          message: "Completed reports require at least one completion claim",
        });
      }
      if (!report.permissionsHonored) {
        context.addIssue({
          code: "custom",
          path: ["permissionsHonored"],
          message: "A permission violation cannot be reported as completed",
        });
      }
      for (const [index, claim] of report.completionClaims.entries()) {
        if (claim.status === "unverified" || claim.evidenceRefs.length === 0) {
          context.addIssue({
            code: "custom",
            path: ["completionClaims", index],
            message:
              "Completed reports require evidence-backed completion claims",
          });
        }
      }
    }
    if (
      report.terminalStatus !== "completed" &&
      report.terminalStatus !== "cancelled" &&
      report.findingRefs.length === 0 &&
      report.unresolvedRisks.length === 0 &&
      report.nextActions.length === 0
    ) {
      context.addIssue({
        code: "custom",
        path: ["unresolvedRisks"],
        message:
          "Non-completed reports must retain a finding, unresolved risk, or next action",
      });
    }
  });

export const ReceiptAuditSchema = z
  .object({
    schemaVersion: SchemaVersionSchema,
    id: IdentifierSchema,
    runId: RunIdSchema,
    controllingReviewRef: ArtifactUriSchema,
    claimEvidenceMatrix: z
      .array(ClaimEvidenceEntrySchema)
      .max(MAX_COLLECTION_ITEMS),
    digestStatus: z.enum(["verified", "failed"]),
    verifiedAt: TimestampSchema,
  })
  .strict()
  .superRefine((receipt, context) => {
    const claimIds = receipt.claimEvidenceMatrix.map((entry) => entry.claimId);
    if (new Set(claimIds).size !== claimIds.length) {
      context.addIssue({
        code: "custom",
        path: ["claimEvidenceMatrix"],
        message: "Receipt-audit claim identifiers must be unique",
      });
    }
    if (
      receipt.digestStatus === "verified" &&
      receipt.claimEvidenceMatrix.some((entry) => entry.status !== "supported")
    ) {
      context.addIssue({
        code: "custom",
        path: ["digestStatus"],
        message: "Verified receipts require supported claim evidence",
      });
    }
  });

export type ClaimEvidenceEntry = z.infer<typeof ClaimEvidenceEntrySchema>;
export type ReleaseDefect = z.infer<typeof ReleaseDefectSchema>;
export type ReleaseAudit = z.infer<typeof ReleaseAuditSchema>;
export type ReceiptAudit = z.infer<typeof ReceiptAuditSchema>;
export type UserReport = z.infer<typeof UserReportSchema>;
