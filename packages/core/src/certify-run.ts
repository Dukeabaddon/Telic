import { createHash } from "node:crypto";

import type { SqliteLedger } from "./ledger.js";
import { sha256Json } from "./canonical-json.js";

export interface ClaimEvidenceEntry {
  claimId: string;
  claim: string;
  criterionIds: string[];
  basis: "direct" | "user_reported";
  status: "supported" | "unsupported" | "contradicted" | "unverified";
  evidenceRefs: string[];
  rationaleSummary: string;
}

export interface CertifyRunResult {
  digestStatus: "verified" | "failed";
  claimEvidenceMatrix: ClaimEvidenceEntry[];
  verifiedEvidenceRefs: string[];
}

const ARTIFACT_REF_PATTERN = /^artifact:\/\/([^/]+)\/([A-Za-z0-9._-]+)$/u;

function parseArtifactRef(
  ref: string,
): { runId: string; artifactId: string } | null {
  const match = ARTIFACT_REF_PATTERN.exec(ref);
  if (!match) return null;
  return { runId: match[1]!, artifactId: match[2]! };
}

function verifyEvidenceDigest(
  ledger: SqliteLedger,
  runId: string,
  ref: string,
): boolean {
  const parsed = parseArtifactRef(ref);
  if (!parsed || parsed.runId !== runId) return false;
  try {
    const artifact = ledger.getArtifact(parsed.runId, parsed.artifactId);
    if (!artifact) return false;
    const recomputed = sha256Json(artifact.body);
    return (
      recomputed === artifact.sha256 ||
      recomputed.slice("sha256:".length) === artifact.sha256
    );
  } catch {
    return false;
  }
}

function collectEvidenceRefs(review: Record<string, unknown>): string[] {
  const refs = new Set<string>();
  const sections = [
    review.acceptanceResults,
    review.verificationResults,
    review.hardGates,
    review.ruleCompliance,
    review.regressionChecks,
  ];
  for (const section of sections) {
    if (!Array.isArray(section)) continue;
    for (const entry of section) {
      if (typeof entry !== "object" || entry === null) continue;
      const evidenceRefs = (entry as { evidenceRefs?: unknown }).evidenceRefs;
      if (!Array.isArray(evidenceRefs)) continue;
      for (const ref of evidenceRefs) {
        if (typeof ref === "string") refs.add(ref);
      }
    }
  }
  return [...refs];
}

function buildMatrixFromReview(
  review: Record<string, unknown>,
  runId: string,
  ledger: SqliteLedger,
): ClaimEvidenceEntry[] {
  const acceptanceResults = Array.isArray(review.acceptanceResults)
    ? review.acceptanceResults
    : [];
  const entries: ClaimEvidenceEntry[] = [];
  for (const [index, result] of acceptanceResults.entries()) {
    if (typeof result !== "object" || result === null) continue;
    const criterionId =
      typeof (result as { criterionId?: unknown }).criterionId === "string"
        ? (result as { criterionId: string }).criterionId
        : `AC-${String(index + 1)}`;
    const status =
      (result as { status?: unknown }).status === "pass"
        ? "supported"
        : "unverified";
    const evidenceRefs = Array.isArray(
      (result as { evidenceRefs?: unknown }).evidenceRefs,
    )
      ? ((result as { evidenceRefs: string[] }).evidenceRefs ?? [])
      : [];
    const rationaleSummary =
      typeof (result as { rationaleSummary?: unknown }).rationaleSummary ===
      "string"
        ? (result as { rationaleSummary: string }).rationaleSummary
        : "Spot-check evidence receipt.";
    const digestOk = evidenceRefs.every((ref) =>
      verifyEvidenceDigest(ledger, runId, ref),
    );
    entries.push({
      claimId: `claim-${criterionId}`,
      claim: `Criterion ${criterionId} spot-check claim`,
      criterionIds: [criterionId],
      basis: "direct",
      status: digestOk && status === "supported" ? "supported" : "unverified",
      evidenceRefs,
      rationaleSummary,
    });
  }
  return entries;
}

export function certifyRun(
  ledger: SqliteLedger,
  runId: string,
  qualityReview: Record<string, unknown>,
): CertifyRunResult {
  const claimEvidenceMatrix = buildMatrixFromReview(
    qualityReview,
    runId,
    ledger,
  );
  const verifiedEvidenceRefs: string[] = [];
  let digestStatus: CertifyRunResult["digestStatus"] = "verified";

  for (const ref of collectEvidenceRefs(qualityReview)) {
    if (verifyEvidenceDigest(ledger, runId, ref)) {
      verifiedEvidenceRefs.push(ref);
      continue;
    }
    digestStatus = "failed";
  }

  if (
    digestStatus === "verified" &&
    claimEvidenceMatrix.some((entry) => entry.status !== "supported")
  ) {
    digestStatus = "failed";
  }

  return {
    digestStatus,
    claimEvidenceMatrix,
    verifiedEvidenceRefs,
  };
}

export function digestSummaryForRefs(refs: string[]): string {
  const digest = createHash("sha256")
    .update(refs.slice().sort().join("|"))
    .digest("hex");
  return `sha256:${digest}`;
}
