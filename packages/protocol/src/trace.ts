import { z } from "zod";

import {
  ArtifactUriSchema,
  IdentifierSchema,
  LogicalRoleSchema,
  MAX_COLLECTION_ITEMS,
  PhaseSchema,
  ReferenceUriSchema,
  RunIdSchema,
  SchemaVersionSchema,
  SummarySchema,
  TimestampSchema,
} from "./common.js";

export const ToolTraceSchema = z
  .object({
    name: z.string().min(1).max(255),
    argumentsRef: ArtifactUriSchema.nullable(),
    resultRef: ArtifactUriSchema.nullable(),
    exitStatus: z.number().int().min(0).max(255).nullable(),
  })
  .strict();

export const PermissionDecisionSchema = z
  .object({
    decision: z.enum(["allow", "deny"]),
    capability: z.string().min(1).max(255),
    scope: z.string().min(1).max(2_048),
    policyRefs: z.array(ReferenceUriSchema).max(MAX_COLLECTION_ITEMS),
    rationaleSummary: SummarySchema,
  })
  .strict();

export const TraceEventSchema = z
  .object({
    schemaVersion: SchemaVersionSchema,
    id: IdentifierSchema,
    runId: RunIdSchema,
    sequence: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    timestamp: TimestampSchema,
    actor: LogicalRoleSchema,
    phase: PhaseSchema,
    eventType: z.enum([
      "run_started",
      "context_selected",
      "phase_started",
      "phase_submitted",
      "artifact_recorded",
      "transition_allowed",
      "transition_denied",
      "permission_checked",
      "broker_decision",
      "tool_started",
      "tool_finished",
      "budget_consumed",
      "clarification_requested",
      "redaction_applied",
      "run_terminated",
      "topology_classified",
      "topology_escalated",
      "digest_verified",
      "lineage_linked",
    ]),
    inputRefs: z.array(ReferenceUriSchema).max(MAX_COLLECTION_ITEMS),
    outputRefs: z.array(ReferenceUriSchema).max(MAX_COLLECTION_ITEMS),
    tool: ToolTraceSchema.nullable(),
    permissionDecision: PermissionDecisionSchema.nullable(),
    budgetSnapshot: z
      .object({
        promptRevisions: z.number().int().min(0).max(1),
        postExecutionRemediations: z.number().int().min(0).max(1),
        transportRetries: z.number().int().min(0).max(10),
      })
      .strict(),
    rationaleSummary: SummarySchema,
    redactions: z
      .array(
        z
          .object({
            id: IdentifierSchema,
            targetRef: ReferenceUriSchema,
            category: z.enum([
              "credential",
              "secret",
              "personal_data",
              "sensitive_output",
            ]),
          })
          .strict(),
      )
      .max(MAX_COLLECTION_ITEMS),
  })
  .strict()
  .superRefine((event, context) => {
    if (
      (event.eventType === "permission_checked" ||
        event.eventType === "broker_decision") &&
      event.permissionDecision === null
    ) {
      context.addIssue({
        code: "custom",
        path: ["permissionDecision"],
        message: "Permission-check events require a decision",
      });
    }
    if (
      (event.eventType === "tool_started" ||
        event.eventType === "tool_finished") &&
      event.tool === null
    ) {
      context.addIssue({
        code: "custom",
        path: ["tool"],
        message: "Tool events require tool metadata",
      });
    }
  });

export type ToolTrace = z.infer<typeof ToolTraceSchema>;
export type PermissionDecision = z.infer<typeof PermissionDecisionSchema>;
export type TraceEvent = z.infer<typeof TraceEventSchema>;
