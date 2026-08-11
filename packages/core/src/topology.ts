import type { Phase, RunRecord, RunTopology } from "./types.js";

export type { EscalationReasonCode } from "./escalation.js";
export { escalateTopology } from "./escalation.js";

const roleByPhase: Record<Phase, string> = {
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

export const STANDARD_PHASES = [
  "context_grounding",
  "agent_1_frame",
  "agent_2_compile",
  "agent_1_review",
  "agent_2_revise",
  "agent_3_plan",
  "agent_4_execute",
  "agent_3_review",
  "agent_5_audit",
  "agent_5_report",
] as const satisfies readonly Phase[];

export const FORENSIC_PHASES = [
  "context_grounding",
  "agent_1_frame",
  "agent_2_compile",
  "agent_1_review",
  "agent_2_revise",
  "agent_3_plan",
  "agent_4_execute",
  "agent_3_review",
  "agent_3_evidence_reverify",
  "agent_5_audit",
  "agent_5_report",
] as const satisfies readonly Phase[];

export const MICRO_PHASES = [
  "context_grounding",
  "agent_1_frame",
  "agent_4_execute",
  "agent_3_review",
  "agent_5_report",
] as const satisfies readonly Phase[];

const MICRO_SKIPPED = new Set<Phase>([
  "agent_2_compile",
  "agent_1_review",
  "agent_2_revise",
  "agent_3_plan",
  "agent_5_audit",
  "agent_3_evidence_reverify",
]);

export function phasesForTopology(topology: RunTopology): readonly Phase[] {
  if (topology === "micro") return MICRO_PHASES;
  if (topology === "forensic") return FORENSIC_PHASES;
  return STANDARD_PHASES;
}

export function isSkippedPhase(topology: RunTopology, phase: Phase): boolean {
  return topology === "micro" && MICRO_SKIPPED.has(phase);
}

export function instructionRefFor(run: RunRecord): string {
  if (run.topology === "micro" && run.phase === "agent_1_frame") {
    return "artifact://system/roles/scenario_author-micro-v1";
  }
  if (run.topology === "micro" && run.phase === "agent_3_review") {
    return "artifact://system/roles/quality_controller-spot-v1";
  }
  if (
    run.topology === "forensic" &&
    run.phase === "agent_3_evidence_reverify"
  ) {
    return "artifact://system/roles/quality_controller-reverify-v1";
  }
  return `artifact://system/roles/${roleByPhase[run.phase]}-v1`;
}

export function isMicroBootstrapTransition(
  previous: RunRecord,
  next: RunRecord,
): boolean {
  return (
    previous.topology === "micro" &&
    previous.phase === "agent_1_frame" &&
    (next.phase === "agent_4_execute" || next.phase === "agent_3_review")
  );
}
