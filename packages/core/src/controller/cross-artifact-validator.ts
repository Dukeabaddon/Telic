import type { PhaseNextAction, RunRecord } from "../types.js";

export interface LocatedReference {
  ref: string;
  path: string;
}

const referenceFieldNames = new Set([
  "applicableRuleRefs",
  "argumentsRef",
  "changeRefs",
  "clarificationRequestRef",
  "commandRef",
  "contextManifestRef",
  "contextRefs",
  "derivedRefs",
  "directEvidenceRefs",
  "diffRef",
  "evidenceInspected",
  "evidenceRefs",
  "findingRefs",
  "followupRequestRefs",
  "inputRefs",
  "instructionRef",
  "originalRequestRef",
  "outputRef",
  "outputRefs",
  "pinnedRefs",
  "policyRefs",
  "problemFrameRef",
  "promptReadinessRubricRef",
  "qualityReviewRef",
  "ref",
  "requestRef",
  "resultRef",
  "ruleRefs",
  "subjectRef",
  "sourceRef",
  "sourceRefs",
  "targetRef",
  "taskContractRef",
  "traceRef",
  "toolEventRefs",
  "userReportRef",
  "verificationRefs",
  "workPlanRef",
  "workPlanRefs",
  "workResultRefs",
]);

export function collectArtifactReferences(
  value: unknown,
  path = "body",
  key = "",
): LocatedReference[] {
  if (typeof value === "string") {
    return referenceFieldNames.has(key) &&
      /^(?:artifact|repo|trace):\/\//u.test(value)
      ? [{ ref: value, path }]
      : [];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item, index) =>
      collectArtifactReferences(item, `${path}[${index}]`, key),
    );
  }
  if (typeof value !== "object" || value === null) return [];
  return Object.entries(value).flatMap(([childKey, child]) =>
    collectArtifactReferences(child, `${path}.${childKey}`, childKey),
  );
}

const fixedProducerByType: Readonly<Record<string, string>> = {
  ContextManifest: "controller",
  Evidence: "executor",
  ProblemFrame: "scenario_author",
  PromptReview: "scenario_author",
  QualityReview: "quality_controller",
  ReleaseAudit: "release_auditor",
  ReceiptAudit: "controller",
  RunEnvelope: "controller",
  ScenarioSpec: "scenario_author",
  TaskContract: "task_compiler",
  TraceEvent: "controller",
  UserReport: "release_auditor",
  WorkPlan: "quality_controller",
  WorkResult: "executor",
};

export const roleByPhase: Record<
  RunRecord["phase"],
  PhaseNextAction["logicalRole"]
> = {
  context_grounding: "controller",
  agent_1_frame: "scenario_author",
  agent_2_compile: "task_compiler",
  agent_1_review: "scenario_author",
  agent_2_revise: "task_compiler",
  agent_3_plan: "quality_controller",
  agent_4_execute: "executor",
  agent_3_review: "quality_controller",
  agent_3_evidence_reverify: "quality_controller",
  agent_5_audit: "release_auditor",
  agent_5_report: "release_auditor",
};

export function expectedProducer(run: RunRecord, type: string): string {
  if (type === "ClarificationRequest") return roleByPhase[run.phase];
  return fixedProducerByType[type] ?? roleByPhase[run.phase];
}

export function expectedReferenceType(path: string): string | null {
  if (path.endsWith(".originalRequestRef")) return "UserMessage";
  if (path.endsWith(".problemFrameRef")) return "ProblemFrame";
  if (path.endsWith(".targetRef")) return "TaskContract";
  if (path.endsWith(".taskContractRef")) return "TaskContract";
  if (/\.workPlanRefs?(?:\[\d+\])?$/u.test(path)) return "WorkPlan";
  if (/\.workResultRefs\[\d+\]$/u.test(path)) return "WorkResult";
  if (path.endsWith(".qualityReviewRef")) return "QualityReview";
  if (path.endsWith(".contextManifestRef")) return "ContextManifest";
  if (path.endsWith(".clarificationRequestRef")) return "ClarificationRequest";
  return null;
}

export const systemReferenceFields = new Set([
  "applicableRuleRefs",
  "instructionRef",
  "policyRefs",
  "promptReadinessRubricRef",
  "ruleRefs",
]);

const knownSystemReferencePatterns = [
  /^artifact:\/\/system\/roles\/(?:controller|scenario[_-]author(?:-micro)?|task[_-]compiler|quality[_-]controller(?:-spot)?|executor|release[_-]auditor)-v1$/u,
  /^artifact:\/\/system\/rubrics\/contract-readiness-v1$/u,
];

export function isKnownSystemReference(reference: string): boolean {
  return knownSystemReferencePatterns.some((pattern) =>
    pattern.test(reference),
  );
}

export function terminalField(path: string): string {
  return /\.([A-Za-z][A-Za-z0-9]*)(?:\[\d+\])?$/u.exec(path)?.[1] ?? "";
}
