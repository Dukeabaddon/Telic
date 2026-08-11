import type { HydratedArtifact, RunRecord } from "./types.js";

export interface ContractDelta {
  objective: string | null;
  scope: { include: string[]; exclude: string[] } | null;
  inheritedCriterionIds: string[];
  inheritedEvidenceRefs: string[];
  priorProblemFrameRef: string | null;
  priorTaskContractRef: string | null;
  priorUserReportRef: string | null;
}

function latestBody(
  artifacts: HydratedArtifact[],
  type: string,
): Record<string, unknown> | null {
  const record = [...artifacts]
    .reverse()
    .find((artifact) => artifact.type === type);
  if (!record || typeof record.body !== "object" || record.body === null) {
    return null;
  }
  return record.body as Record<string, unknown>;
}

export function buildContractDelta(
  priorRun: RunRecord,
  priorArtifacts: HydratedArtifact[],
): ContractDelta {
  const problemFrame = latestBody(priorArtifacts, "ProblemFrame");
  const taskContract = latestBody(priorArtifacts, "TaskContract");
  const userReport = latestBody(priorArtifacts, "UserReport");

  const inheritedCriterionIds = Array.isArray(taskContract?.acceptanceCriteria)
    ? (taskContract.acceptanceCriteria as Array<{ id?: unknown }>)
        .map((criterion) =>
          typeof criterion.id === "string" ? criterion.id : null,
        )
        .filter((id): id is string => id !== null)
    : [];

  const inheritedEvidenceRefs: string[] = [];
  if (Array.isArray(userReport?.completionClaims)) {
    for (const claim of userReport.completionClaims as Array<{
      evidenceRefs?: unknown;
    }>) {
      if (!Array.isArray(claim.evidenceRefs)) continue;
      for (const ref of claim.evidenceRefs) {
        if (typeof ref === "string") inheritedEvidenceRefs.push(ref);
      }
    }
  }

  const scope =
    typeof problemFrame?.scope === "object" && problemFrame.scope !== null
      ? (problemFrame.scope as { include: string[]; exclude: string[] })
      : null;

  return {
    objective:
      typeof problemFrame?.goal === "string" ? problemFrame.goal : null,
    scope,
    inheritedCriterionIds,
    inheritedEvidenceRefs,
    priorProblemFrameRef: problemFrame
      ? `artifact://${priorRun.runId}/${String(problemFrame.id)}`
      : null,
    priorTaskContractRef: taskContract
      ? `artifact://${priorRun.runId}/${String(taskContract.id)}`
      : null,
    priorUserReportRef: userReport
      ? `artifact://${priorRun.runId}/${String(userReport.id)}`
      : null,
  };
}
