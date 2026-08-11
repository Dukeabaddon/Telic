import type { SqliteLedger } from "./ledger.js";
import type { RunRecord } from "./types.js";

const ARTIFACT_REF_PATTERN =
  /^artifact:\/\/([^/]+)\/([A-Za-z0-9._-]+)$/u;

function parseArtifactRef(ref: string): { runId: string; artifactId: string } | null {
  const match = ARTIFACT_REF_PATTERN.exec(ref);
  if (!match) return null;
  return { runId: match[1]!, artifactId: match[2]! };
}

export function validateCrossRunEvidenceRef(
  ledger: SqliteLedger,
  currentRun: RunRecord,
  ref: string,
  priorRunId: string,
): void {
  const parsed = parseArtifactRef(ref);
  if (!parsed) {
    throw new Error(`Cross-run evidence ref is not an artifact URI: ${ref}`);
  }
  if (parsed.runId !== priorRunId) {
    throw new Error(
      `Cross-run evidence ref must target prior run ${priorRunId}`,
    );
  }
  const priorRun = ledger.getRun(priorRunId);
  if (!priorRun) {
    throw new Error(`Prior run ${priorRunId} does not exist`);
  }
  if (priorRun.repositoryRoot !== currentRun.repositoryRoot) {
    throw new Error(
      "Cross-run evidence requires the same repository root as the prior run",
    );
  }
  const artifact = ledger.getArtifact(priorRunId, parsed.artifactId);
  if (!artifact) {
    throw new Error(`Cross-run evidence artifact does not exist: ${ref}`);
  }
  if (artifact.type !== "Evidence") {
    throw new Error(`Cross-run evidence ref must target an Evidence artifact: ${ref}`);
  }
}

export function collectCrossRunEvidenceRefs(value: unknown): string[] {
  const refs: string[] = [];
  const visit = (node: unknown): void => {
    if (typeof node === "string" && node.startsWith("artifact://")) {
      refs.push(node);
      return;
    }
    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }
    if (typeof node === "object" && node !== null) {
      for (const item of Object.values(node)) visit(item);
    }
  };
  visit(value);
  return refs;
}
