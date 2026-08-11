export const intentModes = [
  "report_only",
  "plan_only",
  "analyze_only",
  "fix_only",
  "analyze_and_fix",
] as const;

export type IntentMode = (typeof intentModes)[number];

export const runTopologies = ["micro", "standard", "forensic"] as const;
export type RunTopology = (typeof runTopologies)[number];

export const phases = [
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
] as const;

export type Phase = (typeof phases)[number];
export type RunStatus =
  | "running"
  | "awaiting_clarification"
  | "completed"
  | "partial"
  | "blocked"
  | "cancelled";

export interface RetryBudgets {
  promptRevisionsRemaining: number;
  postExecutionRemediationsRemaining: number;
}

export interface RunRecord {
  runId: string;
  schemaVersion: "1.0";
  repositoryRoot: string;
  requestedMode: IntentMode;
  topology: RunTopology;
  escalationCount: number;
  priorRunId: string | null;
  status: RunStatus;
  phase: Phase;
  resumePhase: Phase | null;
  version: number;
  budgets: RetryBudgets;
  outcomeHint: "completed" | "partial" | "blocked" | null;
  createdAt: string;
  updatedAt: string;
}

export interface ArtifactSubmission {
  id: string;
  runId: string;
  type: string;
  schemaVersion: string;
  producer: string;
  body: unknown;
  sourceRefs?: string[];
  redaction?: "none" | "partial" | "full";
}

export interface StoredArtifact extends Omit<ArtifactSubmission, "body"> {
  sha256: string;
  createdAt: string;
  sourceRefs: string[];
  redaction: "none" | "partial" | "full";
}

export interface HydratedArtifact extends StoredArtifact {
  body: unknown;
}

export interface TracePermissionDecision {
  decision: "allow" | "deny";
  capability: string;
  scope: string;
  policyRefs: string[];
  rationaleSummary: string;
}

export interface TraceEventRecord {
  id: string;
  runId: string;
  sequence: number;
  timestamp: string;
  actor: string;
  phase: Phase;
  eventType: string;
  inputRefs: string[];
  outputRefs: string[];
  permissionDecision: TracePermissionDecision | null;
  decisionSummary: string;
  budgetSnapshot: RetryBudgets;
}

interface NextActionBase {
  schemaVersion: "1.0";
  id: string;
  runId: string;
  createdAt: string;
  rationaleSummary: string;
}

export interface PhaseNextAction extends NextActionBase {
  kind: "phase";
  phase: string;
  logicalRole:
    | "controller"
    | "scenario_author"
    | "task_compiler"
    | "quality_controller"
    | "executor"
    | "release_auditor";
  instructionRef: string;
  inputRefs: string[];
  contextManifestRef: string | null;
  requiredOutputType: string;
  requiredOutputSchema: Record<string, unknown>;
  additionalOutputSchemas: Record<string, Record<string, unknown>>;
  workNodeId: string | null;
  effectivePermissions: StructuredPermissionSet;
  remainingBudgets: {
    promptRevisions: number;
    postExecutionRemediations: number;
    remainingPlanToolCalls: number;
    maximumParallelWorkers: number;
    maximumSubagentDepth: number;
  };
  stopConditions: string[];
}

export interface ClarificationNextAction extends NextActionBase {
  kind: "clarification";
  phase: "awaiting_clarification";
  clarificationRequestRef: string;
  effectivePermissions: StructuredPermissionSet;
  remainingBudgets: {
    promptRevisions: number;
    postExecutionRemediations: number;
    remainingPlanToolCalls: number;
    maximumParallelWorkers: number;
    maximumSubagentDepth: number;
  };
}

export interface TerminalNextAction extends NextActionBase {
  kind: "terminal";
  phase: "completed" | "partial" | "blocked" | "cancelled";
  status:
    "completed" | "partial" | "blocked" | "cancelled" | "failed_verification";
  reportRef: string | null;
}

export type NextAction =
  PhaseNextAction | ClarificationNextAction | TerminalNextAction;

export interface StructuredPermissionSet {
  repository: { read: string[]; write: string[]; delete: string[] };
  shell: { inspect: boolean; executeAllowlist: string[] };
  runtime: { inspect: string[]; restart: string[] };
  browser: { inspect: boolean; mutateState: boolean };
  network: { readDomains: string[]; externalWrite: boolean };
  subagents: { spawn: boolean; maximumChildren: number; maximumDepth: number };
}

export interface PermissionProjection {
  repository_read: boolean;
  repository_write: boolean;
  repository_delete: boolean;
  shell_inspect: boolean;
  shell_execute: boolean;
  runtime_inspect: boolean;
  runtime_mutate: boolean;
  browser_inspect: boolean;
  browser_mutate: boolean;
  network_read: boolean;
  external_write: boolean;
  subagent_spawn: boolean;
}

export type ArtifactValidator = (type: string, body: unknown) => unknown;
export type ArtifactSchemaProvider = (type: string) => Record<string, unknown>;
