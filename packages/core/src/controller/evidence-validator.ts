import type { ArtifactSubmission } from "../types.js";

export function requiresDirectEvidence(
  path: string,
  submissionType?: string,
): boolean {
  return (
    (submissionType === "WorkResult" &&
      (/^body\.evidenceRefs\[\d+\]$/u.test(path) ||
        /^body\.actions\[\d+\]\.evidenceRefs\[\d+\]$/u.test(path))) ||
    /\.claimEvidenceMatrix\[\d+\]\.evidenceRefs\[\d+\]$/u.test(path) ||
    /\.completionClaims\[\d+\]\.evidenceRefs\[\d+\]$/u.test(path) ||
    /\.observations\[\d+\]\.evidenceRefs\[\d+\]$/u.test(path) ||
    /\.inferences\[\d+\]\.evidenceRefs\[\d+\]$/u.test(path) ||
    /\.toolEventRefs\[\d+\]$/u.test(path) ||
    /\.verificationRefs\[\d+\]$/u.test(path) ||
    /\.diagnosisGate\.directEvidenceRefs\[\d+\]$/u.test(path) ||
    /\.acceptanceCoverage\[\d+\]\.evidenceRefs\[\d+\]$/u.test(path) ||
    /\.acceptanceResults\[\d+\]\.evidenceRefs\[\d+\]$/u.test(path) ||
    /\.filesChanged\[\d+\]\.diffRef$/u.test(path) ||
    /\.testResults\[\d+\]\.(?:commandRef|outputRef)$/u.test(path) ||
    /\.verificationResults\[\d+\]\.evidenceRefs\[\d+\]$/u.test(path) ||
    /\.(?:ruleCompliance|regressionChecks|userFidelity)\[\d+\]\.evidenceRefs\[\d+\]$/u.test(
      path,
    ) ||
    (submissionType === "QualityReview" &&
      /\.hardGates\[\d+\]\.evidenceRefs\[\d+\]$/u.test(path))
  );
}

export const directEvidenceArtifactTypes = new Set([
  "Evidence",
  "ContextDocument",
  "TraceEvent",
]);

export const directEvidenceTraceEventTypes = new Set<string>();

export function evidenceKindsForCapability(
  capability: string,
): ReadonlySet<string> {
  switch (capability) {
    case "repository.read":
      return new Set(["repository", "diff", "tool_output"]);
    case "repository.write":
    case "repository.delete":
      return new Set(["diff"]);
    case "shell.inspect":
    case "shell.execute":
      return new Set(["tool_output", "log", "test"]);
    case "runtime.inspect":
    case "runtime.restart":
      return new Set(["runtime", "log", "tool_output"]);
    case "browser.inspect":
    case "browser.mutate":
      return new Set(["browser"]);
    case "network.read":
    case "external.write":
    case "subagent.spawn":
      return new Set(["tool_output"]);
    default:
      return new Set();
  }
}

export function isUserReportedEvidencePath(
  submission: ArtifactSubmission,
  path: string,
): boolean {
  if (submission.type === "ReleaseAudit") {
    const match =
      /^body\.claimEvidenceMatrix\[(\d+)\]\.evidenceRefs\[\d+\]$/u.exec(path);
    const matrix =
      typeof submission.body === "object" &&
      submission.body !== null &&
      "claimEvidenceMatrix" in submission.body
        ? (submission.body as { claimEvidenceMatrix?: unknown })
            .claimEvidenceMatrix
        : null;
    return (
      match !== null &&
      Array.isArray(matrix) &&
      typeof matrix[Number(match[1])] === "object" &&
      matrix[Number(match[1])] !== null &&
      (matrix[Number(match[1])] as { basis?: unknown }).basis ===
        "user_reported"
    );
  }
  if (submission.type === "UserReport") {
    const match =
      /^body\.completionClaims\[(\d+)\]\.evidenceRefs\[\d+\]$/u.exec(path);
    const claims =
      typeof submission.body === "object" &&
      submission.body !== null &&
      "completionClaims" in submission.body
        ? (submission.body as { completionClaims?: unknown }).completionClaims
        : null;
    return (
      match !== null &&
      Array.isArray(claims) &&
      typeof claims[Number(match[1])] === "object" &&
      claims[Number(match[1])] !== null &&
      (claims[Number(match[1])] as { status?: unknown }).status ===
        "user_reported"
    );
  }
  return false;
}
