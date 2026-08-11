import type {
  ArtifactSubmission,
  Phase,
  RunRecord,
  RunTopology,
} from "./types.js";

export type EscalationReasonCode =
  | "MICRO_SPOT_REMEDIATE"
  | "MICRO_SPOT_PARTIAL"
  | "MICRO_USER_REPORTED"
  | "STANDARD_USER_REPORTED_CLAIMS"
  | "STANDARD_EVIDENCE_STRESS";

export const MAX_ESCALATIONS_PER_RUN = 2;

export interface EscalationTarget {
  targetTopology: RunTopology;
  phase: Phase;
  reason: EscalationReasonCode;
}

export function escalateTopology(
  run: RunRecord,
  target: RunTopology,
  phase: RunRecord["phase"],
  reason: EscalationReasonCode,
): { run: RunRecord; reason: EscalationReasonCode } {
  if (run.topology === target) {
    throw new Error(`Run is already on ${target} topology`);
  }
  if (run.topology === "forensic" && target !== "forensic") {
    throw new Error("Forensic topology cannot be downgraded");
  }
  if (run.escalationCount >= MAX_ESCALATIONS_PER_RUN) {
    throw new Error("escalation budget exhausted");
  }
  return {
    run: {
      ...run,
      topology: target,
      phase,
      status: "running",
      resumePhase: null,
      escalationCount: run.escalationCount + 1,
    },
    reason,
  };
}

export function evaluateEscalation(
  run: RunRecord,
  submission: ArtifactSubmission,
): EscalationTarget | null {
  const body = submission.body as Record<string, unknown>;

  if (run.topology === "micro" && submission.type === "UserReport") {
    const claims = Array.isArray(body.completionClaims)
      ? (body.completionClaims as Array<Record<string, unknown>>)
      : [];
    if (claims.some((claim) => claim.status === "user_reported")) {
      return {
        targetTopology: "standard",
        phase: "agent_1_review",
        reason: "MICRO_USER_REPORTED",
      };
    }
  }

  if (run.topology === "standard" && submission.type === "ReleaseAudit") {
    const matrix = Array.isArray(body.claimEvidenceMatrix)
      ? (body.claimEvidenceMatrix as Array<Record<string, unknown>>)
      : [];
    if (matrix.some((entry) => entry.basis === "user_reported")) {
      return {
        targetTopology: "forensic",
        phase: "agent_5_audit",
        reason: "STANDARD_USER_REPORTED_CLAIMS",
      };
    }
  }

  return null;
}

export function escalationReasonForQualityReview(
  decision: string,
): EscalationReasonCode {
  return decision === "remediate"
    ? "MICRO_SPOT_REMEDIATE"
    : "MICRO_SPOT_PARTIAL";
}
