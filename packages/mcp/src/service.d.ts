import { type GroundingBudgetInput } from "@telic/context";
import { type NextAction, RunController, SqliteLedger, type ArtifactSubmission, type BrokerDecision, type IntentMode, type ReplayReport, type RunRecord } from "@telic/core";
export interface ServiceOptions {
    repositoryRoot: string;
    stateDirectory?: string;
}
export declare function defaultStateDirectory(repositoryRoot: string): string;
export interface StartRunRequest {
    originalRequest: string;
    mode: IntentMode;
    hostName?: string;
    nativeSubagents?: "available" | "unavailable" | "unknown";
    hostCapabilities?: string[];
    authorizationGranted?: string[];
    authorizationDenied?: string[];
    shellExecuteAllowlist?: string[];
    networkReadDomains?: string[];
    topologyOverride?: import("@telic/core").RunTopology | null;
    priorRunId?: string | null;
}
export interface GroundContextRequest {
    runId: string;
    activePaths?: string[];
    budget?: GroundingBudgetInput;
}
export type RunSummary = Pick<RunRecord, "runId" | "schemaVersion" | "requestedMode" | "topology" | "status" | "phase" | "resumePhase" | "version" | "outcomeHint" | "createdAt" | "updatedAt">;
export declare class TelicService {
    readonly repositoryRoot: string;
    readonly stateDirectory: string;
    readonly ledger: SqliteLedger;
    readonly controller: RunController;
    constructor(options: ServiceOptions);
    close(): void;
    assertActionToken(runId: string, actionId: string, expectedRunVersion: number): void;
    startRun(input: StartRunRequest): {
        run: RunRecord;
        nextAction: NextAction;
    };
    private publishActiveSession;
    groundContext(input: GroundContextRequest): Promise<{
        run: RunRecord;
        nextAction: NextAction;
        manifest: {
            schemaVersion: "1.0";
            id: string;
            runId: string;
            repositoryFingerprint: {
                headCommit: string | null;
                dirtyWorktreeHash: string;
            };
            pinnedRefs: string[];
            candidates: ({
                id: string;
                ref: string;
                locations: string[];
                contentHash: string;
                byteSize: number;
                decision: "selected";
                selectionReason: string;
                path: string;
                score: number;
                pinned: boolean;
            } | {
                id: string;
                ref: string;
                locations: string[];
                contentHash: string | null;
                byteSize: number | null;
                decision: "excluded";
                exclusionReason: string;
            })[];
            derivedRefs: string[];
            excludedCandidateSummaries: {
                reason: "binary_file" | "duplicate_content" | "excluded_directory" | "file_count_budget" | "file_too_large" | "invalid_path" | "invalid_utf8" | "inventory_budget" | "low_relevance" | "non_regular_file" | "path_escape" | "secret_content" | "secret_like_file" | "symlink_escape" | "total_bytes_budget" | "unreadable_file";
                count: number;
            }[];
            inventorySource: "filesystem" | "git" | "ripgrep";
            warnings: string[];
            budget: {
                maximumFiles: number;
                maximumFileBytes: number;
                maximumTotalBytes: number;
                maximumInventoryFiles: number;
                candidateFiles: number;
                selectedFiles: number;
                estimatedTokens: number;
                selectedBytes: number;
            };
        };
    }>;
    submitArtifact(input: ArtifactSubmission): {
        run: RunRecord;
        nextAction: NextAction;
    } | {
        run: RunRecord;
        artifact: import("@telic/core").StoredArtifact;
        nextAction: NextAction;
    };
    answerClarification(runId: string, response: string): {
        run: RunRecord;
        nextAction: NextAction;
    };
    cancelRun(runId: string, actionId: string, expectedRunVersion: number): {
        run: RunRecord;
        nextAction: NextAction;
    };
    listRuns(limit?: number): RunSummary[];
    getRun(runId: string): {
        run: RunRecord;
        artifacts: import("@telic/core").StoredArtifact[];
        nextAction: NextAction;
    };
    getArtifact(runId: string, artifactId: string): import("@telic/core").HydratedArtifact;
    checkToolAction(input: {
        runId: string;
        actionId: string;
        expectedRunVersion: number;
        capability: string;
        target?: string;
    }): BrokerDecision;
    replayRun(runId: string): ReplayReport;
    getTrace(runId: string, afterSequence?: number, limit?: number): {
        schemaVersion: "1.0";
        id: string;
        runId: string;
        sequence: number;
        timestamp: string;
        actor: "controller" | "executor" | "host" | "quality_controller" | "release_auditor" | "scenario_author" | "task_compiler" | "tool" | "user";
        phase: "agent_1_frame" | "agent_1_review" | "agent_2_compile" | "agent_2_revision" | "agent_3_evidence_reverify" | "agent_3_plan" | "agent_3_quality_review" | "agent_4_execute" | "agent_4_remediation" | "agent_5_release_audit" | "awaiting_clarification" | "blocked" | "cancelled" | "completed" | "context_discovery" | "contract_validation" | "diagnosis_review" | "partial" | "plan_validation" | "received" | "remediation_plan" | "user_report";
        eventType: "artifact_recorded" | "broker_decision" | "budget_consumed" | "clarification_requested" | "context_selected" | "digest_verified" | "lineage_linked" | "permission_checked" | "phase_started" | "phase_submitted" | "redaction_applied" | "run_started" | "run_terminated" | "tool_finished" | "tool_started" | "topology_classified" | "topology_escalated" | "transition_allowed" | "transition_denied";
        inputRefs: string[];
        outputRefs: string[];
        tool: {
            name: string;
            argumentsRef: string | null;
            resultRef: string | null;
            exitStatus: number | null;
        } | null;
        permissionDecision: {
            decision: "allow" | "deny";
            capability: string;
            scope: string;
            policyRefs: string[];
            rationaleSummary: string;
        } | null;
        budgetSnapshot: {
            promptRevisions: number;
            postExecutionRemediations: number;
            transportRetries: number;
        };
        rationaleSummary: string;
        redactions: {
            id: string;
            targetRef: string;
            category: "credential" | "personal_data" | "secret" | "sensitive_output";
        }[];
    }[];
}
//# sourceMappingURL=service.d.ts.map