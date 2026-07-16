import { randomUUID } from "node:crypto";
import { realpathSync } from "node:fs";
import { canonicalJson } from "./canonical-json.js";

import { SqliteLedger } from "./ledger.js";
import {
  authorizeAction,
  normalizeNetworkReadDomain,
  permissionSetIsSubset,
  policyForMode,
  policyFromPermissionSet,
  projectPermissions,
  shellCommandIsSafe,
  shellInspectionTargetIsSafe,
  type ActionKind,
} from "./permissions.js";
import {
  advanceRun,
  requiredArtifactTypes,
  resumeAfterClarification,
} from "./state-machine.js";
import type {
  ArtifactSubmission,
  ArtifactSchemaProvider,
  ArtifactValidator,
  IntentMode,
  NextAction,
  PhaseNextAction,
  RunRecord,
  StructuredPermissionSet,
  TracePermissionDecision,
} from "./types.js";

const artifactInputsByPhase: Record<RunRecord["phase"], Set<string>> = {
  context_grounding: new Set([
    "RunEnvelope",
    "UserMessage",
    "ClarificationRequest",
  ]),
  agent_1_frame: new Set([
    "RunEnvelope",
    "UserMessage",
    "ContextManifest",
    "ClarificationRequest",
  ]),
  agent_2_compile: new Set([
    "RunEnvelope",
    "UserMessage",
    "ContextManifest",
    "ProblemFrame",
    "ClarificationRequest",
  ]),
  agent_1_review: new Set([
    "UserMessage",
    "ProblemFrame",
    "TaskContract",
    "ClarificationRequest",
  ]),
  agent_2_revise: new Set([
    "UserMessage",
    "ProblemFrame",
    "TaskContract",
    "PromptReview",
    "ClarificationRequest",
  ]),
  agent_3_plan: new Set([
    "TaskContract",
    "PromptReview",
    "ContextManifest",
    "QualityReview",
    "ReleaseAudit",
    "UserMessage",
    "ClarificationRequest",
  ]),
  agent_4_execute: new Set([
    "TaskContract",
    "WorkPlan",
    "ContextManifest",
    "QualityReview",
    "ReleaseAudit",
    "UserMessage",
    "ClarificationRequest",
  ]),
  agent_3_review: new Set([
    "TaskContract",
    "WorkPlan",
    "WorkResult",
    "Evidence",
    "QualityReview",
    "ReleaseAudit",
    "UserMessage",
    "ClarificationRequest",
  ]),
  agent_5_audit: new Set([
    "UserMessage",
    "TaskContract",
    "WorkPlan",
    "WorkResult",
    "Evidence",
    "QualityReview",
    "ClarificationRequest",
  ]),
  agent_5_report: new Set([
    "UserMessage",
    "ProblemFrame",
    "TaskContract",
    "PromptReview",
    "WorkPlan",
    "WorkResult",
    "Evidence",
    "QualityReview",
    "ReleaseAudit",
    "ClarificationRequest",
  ]),
};

const protocolPhaseByInternal: Record<RunRecord["phase"], string> = {
  context_grounding: "context_discovery",
  agent_1_frame: "agent_1_frame",
  agent_2_compile: "agent_2_compile",
  agent_1_review: "agent_1_review",
  agent_2_revise: "agent_2_revision",
  agent_3_plan: "agent_3_plan",
  agent_4_execute: "agent_4_execute",
  agent_3_review: "agent_3_quality_review",
  agent_5_audit: "agent_5_release_audit",
  agent_5_report: "user_report",
};

const MAX_NEXT_ACTION_INPUT_REFS = 256;
const MAX_CLARIFICATIONS_PER_RUN = 1;
const MAX_TOOL_CALLS_PER_RUN = 4_000;
const REFERENCE_URI_PATTERN =
  /^(?:artifact|trace|repo):\/\/[A-Za-z0-9._~!$&'()*+,;=:@%/-]+$/u;

function emptyPermissionSet(): StructuredPermissionSet {
  return {
    repository: { read: [], write: [], delete: [] },
    shell: { inspect: false, executeAllowlist: [] },
    runtime: { inspect: [], restart: [] },
    browser: { inspect: false, mutateState: false },
    network: { readDomains: [], externalWrite: false },
    subagents: { spawn: false, maximumChildren: 0, maximumDepth: 0 },
  };
}

function capabilitiesToPermissionSet(
  capabilities: string[],
  shellExecuteAllowlist: string[] = [],
  denyAll = false,
  networkReadDomains: string[] = [],
): StructuredPermissionSet {
  const permissions = emptyPermissionSet();
  for (const capability of capabilities) {
    switch (capability) {
      case "repository.read":
        permissions.repository.read = ["**"];
        break;
      case "repository.write":
        permissions.repository.write = ["**"];
        break;
      case "repository.delete":
        permissions.repository.delete = ["**"];
        break;
      case "shell.inspect":
        permissions.shell.inspect = true;
        break;
      case "shell.execute":
        permissions.shell.executeAllowlist = denyAll
          ? ["**"]
          : [...new Set(shellExecuteAllowlist)];
        break;
      case "runtime.inspect":
        permissions.runtime.inspect = ["local"];
        break;
      case "runtime.restart":
        permissions.runtime.restart = ["local"];
        break;
      case "browser.inspect":
        permissions.browser.inspect = true;
        break;
      case "browser.mutate":
        permissions.browser.mutateState = true;
        break;
      case "network.read":
        permissions.network.readDomains = denyAll
          ? ["**"]
          : [...new Set(networkReadDomains)];
        break;
      case "external.write":
        permissions.network.externalWrite = true;
        break;
      case "subagent.spawn":
        permissions.subagents = {
          spawn: true,
          maximumChildren: 3,
          maximumDepth: 1,
        };
        break;
    }
  }
  return permissions;
}

function intersectStructuredPermissions(
  projection: ReturnType<typeof projectPermissions>,
  granted: StructuredPermissionSet,
  denied: StructuredPermissionSet,
): StructuredPermissionSet {
  const effective = emptyPermissionSet();
  if (projection.repository_read && denied.repository.read.length === 0) {
    effective.repository.read = [...granted.repository.read];
  }
  if (projection.repository_write && denied.repository.write.length === 0) {
    effective.repository.write = [...granted.repository.write];
  }
  if (projection.repository_delete && denied.repository.delete.length === 0) {
    effective.repository.delete = [...granted.repository.delete];
  }
  if (projection.shell_execute && denied.shell.executeAllowlist.length === 0) {
    effective.shell.executeAllowlist = [...granted.shell.executeAllowlist];
  }
  effective.shell.inspect =
    projection.shell_inspect && granted.shell.inspect && !denied.shell.inspect;
  if (projection.runtime_inspect && denied.runtime.inspect.length === 0) {
    effective.runtime.inspect = [...granted.runtime.inspect];
  }
  if (projection.runtime_mutate && denied.runtime.restart.length === 0) {
    effective.runtime.restart = [...granted.runtime.restart];
  }
  effective.browser.inspect =
    projection.browser_inspect &&
    granted.browser.inspect &&
    !denied.browser.inspect;
  effective.browser.mutateState =
    projection.browser_mutate &&
    granted.browser.mutateState &&
    !denied.browser.mutateState;
  if (projection.network_read && denied.network.readDomains.length === 0) {
    effective.network.readDomains = [...granted.network.readDomains];
  }
  effective.network.externalWrite =
    projection.external_write &&
    granted.network.externalWrite &&
    !denied.network.externalWrite;
  if (
    projection.subagent_spawn &&
    granted.subagents.spawn &&
    !denied.subagents.spawn
  ) {
    effective.subagents = { ...granted.subagents };
  }
  return effective;
}

function explicitPermissionProjection(
  mode: IntentMode,
  envelope: unknown,
): StructuredPermissionSet {
  const ceiling = projectPermissions(mode);
  if (
    typeof envelope !== "object" ||
    envelope === null ||
    !("authorization" in envelope)
  ) {
    return emptyPermissionSet();
  }
  const authorization = (envelope as { authorization: unknown }).authorization;
  if (
    typeof authorization !== "object" ||
    authorization === null ||
    !("granted" in authorization) ||
    !("denied" in authorization)
  ) {
    return emptyPermissionSet();
  }
  const effective = intersectStructuredPermissions(
    ceiling,
    authorization.granted as StructuredPermissionSet,
    authorization.denied as StructuredPermissionSet,
  );
  return effective;
}

const roleByPhase: Record<RunRecord["phase"], PhaseNextAction["logicalRole"]> =
  {
    context_grounding: "controller",
    agent_1_frame: "scenario_author",
    agent_2_compile: "task_compiler",
    agent_1_review: "scenario_author",
    agent_2_revise: "task_compiler",
    agent_3_plan: "quality_controller",
    agent_4_execute: "executor",
    agent_3_review: "quality_controller",
    agent_5_audit: "release_auditor",
    agent_5_report: "release_auditor",
  };

export interface StartRunInput {
  repositoryRoot: string;
  originalRequest: string;
  requestedMode: IntentMode;
  host: {
    name: string;
    nativeSubagents: "available" | "unavailable" | "unknown";
    capabilities: string[];
  };
  authorization: {
    granted: string[];
    denied: string[];
    shellExecuteAllowlist?: string[];
    networkReadDomains?: string[];
  };
  budgets?: {
    promptRevisions?: 0 | 1;
    postExecutionRemediations?: 0 | 1;
  };
}

function assertStartInput(input: StartRunInput): void {
  if (input.originalRequest.trim().length === 0)
    throw new Error("Original request is required");
  if (input.originalRequest.length > 32_768)
    throw new Error("Original request exceeds 32768 characters");
  if (input.host.name.trim().length === 0)
    throw new Error("Host name is required");
  const knownCapabilities = new Set([
    "repository.read",
    "repository.write",
    "repository.delete",
    "shell.inspect",
    "shell.execute",
    "runtime.inspect",
    "runtime.restart",
    "browser.inspect",
    "browser.mutate",
    "network.read",
    "external.write",
    "subagent.spawn",
  ]);
  if (
    input.host.capabilities.length > 256 ||
    input.authorization.granted.length > 256 ||
    input.authorization.denied.length > 256
  ) {
    throw new Error("Capability lists exceed the 256-item limit");
  }
  const shellExecuteAllowlist = input.authorization.shellExecuteAllowlist ?? [];
  const networkReadDomains = input.authorization.networkReadDomains ?? [];
  if (shellExecuteAllowlist.length > 256) {
    throw new Error("Shell execute allowlist exceeds the 256-item limit");
  }
  if (networkReadDomains.length > 256) {
    throw new Error("Network read domain allowlist exceeds the 256-item limit");
  }
  if (
    shellExecuteAllowlist.length > 0 &&
    (!input.host.capabilities.includes("shell.execute") ||
      !input.authorization.granted.includes("shell.execute"))
  ) {
    throw new Error(
      "Exact shell commands require granted shell.execute host capability",
    );
  }
  if (
    networkReadDomains.length > 0 &&
    (!input.host.capabilities.includes("network.read") ||
      !input.authorization.granted.includes("network.read"))
  ) {
    throw new Error(
      "Network read domains require granted network.read host capability",
    );
  }
  if (
    networkReadDomains.some(
      (domain) => normalizeNetworkReadDomain(domain) === null,
    )
  ) {
    throw new Error(
      "Network read domains must be exact DNS names or IP addresses without schemes, paths, ports, credentials, or wildcards",
    );
  }
  if (
    shellExecuteAllowlist.some(
      (command) =>
        command === "authorized" ||
        command === "**" ||
        /[*?\[\]]/u.test(command) ||
        !shellCommandIsSafe(command),
    )
  ) {
    throw new Error(
      "Shell execute authorization requires exact, non-compound commands",
    );
  }
  for (const capability of [
    ...input.host.capabilities,
    ...input.authorization.granted,
    ...input.authorization.denied,
  ]) {
    if (!knownCapabilities.has(capability)) {
      throw new Error(`Unknown host capability: ${capability}`);
    }
  }
  const available = new Set(input.host.capabilities);
  for (const grant of input.authorization.granted) {
    if (!available.has(grant)) {
      throw new Error(
        `Authorization grant is unavailable on this host: ${grant}`,
      );
    }
  }
}

interface LocatedReference {
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

function collectArtifactReferences(
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
  RunEnvelope: "controller",
  ScenarioSpec: "scenario_author",
  TaskContract: "task_compiler",
  TraceEvent: "controller",
  UserReport: "release_auditor",
  WorkPlan: "quality_controller",
  WorkResult: "executor",
};

function expectedProducer(run: RunRecord, type: string): string {
  if (type === "ClarificationRequest") return roleByPhase[run.phase];
  return fixedProducerByType[type] ?? roleByPhase[run.phase];
}

function requireObjectBody(body: unknown): Record<string, unknown> {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new Error("Artifact body must be an object");
  }
  return body as Record<string, unknown>;
}

interface WorkNodeProjection {
  id: string;
  dependsOn: string[];
  inputRefs?: string[];
  contextRefs?: string[];
  allowedTools?: string[];
  requiredCapabilities?: string[];
  acceptanceCriteria?: string[];
  permissions?: StructuredPermissionSet;
  budgets?: {
    maximumToolCalls?: number;
    maximumChildren?: number;
  };
}

interface WorkPlanProjection {
  id: string;
  nodes: WorkNodeProjection[];
}

interface ArtifactProjection {
  id?: string;
  runId?: string;
  schemaVersion?: string;
  [key: string]: unknown;
}

function artifactIdFromUri(uri: string): string | null {
  return /^artifact:\/\/[^/]+\/([^/]+)$/u.exec(uri)?.[1] ?? null;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function permissionSet(value: unknown, label: string): StructuredPermissionSet {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be a structured permission set`);
  }
  return value as StructuredPermissionSet;
}

function permissionAllowsCapability(
  permissions: StructuredPermissionSet,
  capability: string,
): boolean {
  switch (capability) {
    case "repository.read":
      return permissions.repository.read.length > 0;
    case "repository.write":
      return permissions.repository.write.length > 0;
    case "repository.delete":
      return permissions.repository.delete.length > 0;
    case "shell.inspect":
      return permissions.shell.inspect;
    case "shell.execute":
      return permissions.shell.executeAllowlist.length > 0;
    case "runtime.inspect":
      return permissions.runtime.inspect.length > 0;
    case "runtime.restart":
      return permissions.runtime.restart.length > 0;
    case "browser.inspect":
      return permissions.browser.inspect;
    case "browser.mutate":
      return permissions.browser.mutateState;
    case "network.read":
      return permissions.network.readDomains.length > 0;
    case "external.write":
      return permissions.network.externalWrite;
    case "subagent.spawn":
      return (
        permissions.subagents.spawn && permissions.subagents.maximumChildren > 0
      );
    default:
      return false;
  }
}

function actionKindForCapability(capability: string): ActionKind | null {
  if (capability === "runtime.restart") return "runtime.mutate";
  const known: ActionKind[] = [
    "repository.read",
    "repository.write",
    "repository.delete",
    "shell.inspect",
    "shell.execute",
    "runtime.inspect",
    "runtime.mutate",
    "browser.inspect",
    "browser.mutate",
    "network.read",
    "external.write",
    "subagent.spawn",
  ];
  return known.includes(capability as ActionKind)
    ? (capability as ActionKind)
    : null;
}

const alwaysMutatingCapabilities = new Set([
  "repository.write",
  "repository.delete",
  "runtime.restart",
  "runtime.mutate",
  "browser.mutate",
  "external.write",
]);

const alwaysReadOnlyCapabilities = new Set([
  "repository.read",
  "shell.inspect",
  "runtime.inspect",
  "browser.inspect",
  "network.read",
  "subagent.spawn",
]);

const potentiallyMutatingPlanCapabilities = new Set([
  ...alwaysMutatingCapabilities,
  "shell.execute",
  "subagent.spawn",
]);

function requiresDirectEvidence(
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

const directEvidenceArtifactTypes = new Set([
  "Evidence",
  "ContextDocument",
  "TraceEvent",
]);

const directEvidenceTraceEventTypes = new Set<string>();

function evidenceKindsForCapability(capability: string): ReadonlySet<string> {
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

class PermissionAuthorizationError extends Error {
  constructor(
    message: string,
    readonly permissionDecision: TracePermissionDecision,
    readonly inputRefs: string[],
  ) {
    super(message);
    this.name = "PermissionAuthorizationError";
  }
}

function expectedReferenceType(path: string): string | null {
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

const systemReferenceFields = new Set([
  "applicableRuleRefs",
  "instructionRef",
  "policyRefs",
  "promptReadinessRubricRef",
  "ruleRefs",
]);

const knownSystemReferencePatterns = [
  /^artifact:\/\/system\/roles\/(?:controller|scenario[_-]author|task[_-]compiler|quality[_-]controller|executor|release[_-]auditor)-v1$/u,
  /^artifact:\/\/system\/rubrics\/contract-readiness-v1$/u,
];

function isKnownSystemReference(reference: string): boolean {
  return knownSystemReferencePatterns.some((pattern) =>
    pattern.test(reference),
  );
}

function terminalField(path: string): string {
  return /\.([A-Za-z][A-Za-z0-9]*)(?:\[\d+\])?$/u.exec(path)?.[1] ?? "";
}

function isUserReportedEvidencePath(
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

function equalStringSets(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return (
    left.length === right.length &&
    new Set(left).size === left.length &&
    left.every((item) => right.includes(item))
  );
}

function tracePermissionDecision(
  action: Record<string, unknown>,
  allowed: boolean,
  policyRefs: string[],
  rationaleSummary: string,
): TracePermissionDecision {
  const capability =
    typeof action.capability === "string" ? action.capability : "unknown";
  const rawTarget =
    typeof action.target === "string" ? action.target : "unknown";
  let scope = rawTarget;
  if (
    (capability === "network.read" || capability === "external.write") &&
    rawTarget !== "unknown"
  ) {
    try {
      const parsed = new URL(
        rawTarget.includes("://") ? rawTarget : `http://${rawTarget}`,
      );
      scope =
        normalizeNetworkReadDomain(parsed.hostname) ?? "invalid_network_target";
    } catch {
      scope = "invalid_network_target";
    }
  }
  return {
    decision: allowed ? "allow" : "deny",
    capability,
    scope,
    policyRefs,
    rationaleSummary,
  };
}

export class RunController {
  constructor(
    private readonly ledger: SqliteLedger,
    private readonly validateArtifact: ArtifactValidator = (_type, body) =>
      body,
    private readonly artifactSchema: ArtifactSchemaProvider = () => ({
      type: "object",
    }),
  ) {}

  startRun(input: StartRunInput): { run: RunRecord; nextAction: NextAction } {
    assertStartInput(input);
    const now = new Date().toISOString();
    const runId = randomUUID();
    const repositoryRoot = realpathSync(input.repositoryRoot);
    const requestId = randomUUID();
    const networkReadDomains = [
      ...new Set(
        (input.authorization.networkReadDomains ?? []).map((domain) =>
          normalizeNetworkReadDomain(domain),
        ),
      ),
    ]
      .filter((domain): domain is string => domain !== null)
      .sort();
    const envelopeId = runId;
    const run: RunRecord = {
      runId,
      schemaVersion: "1.0",
      repositoryRoot,
      requestedMode: input.requestedMode,
      status: "running",
      phase: "context_grounding",
      resumePhase: null,
      version: 1,
      budgets: {
        promptRevisionsRemaining: input.budgets?.promptRevisions ?? 1,
        postExecutionRemediationsRemaining:
          input.budgets?.postExecutionRemediations ?? 1,
      },
      outcomeHint: null,
      createdAt: now,
      updatedAt: now,
    };
    const requestRef = `artifact://${runId}/${requestId}`;
    const envelopeBody = this.validateArtifact("RunEnvelope", {
      schemaVersion: "1.0",
      runId,
      createdAt: now,
      originalRequestRef: requestRef,
      followupRequestRefs: [],
      requestedMode: input.requestedMode,
      status: "active",
      workingContext: {
        repositoryRoot,
        activeFiles: [],
        applicableRuleRefs: [],
      },
      host: {
        name: input.host.name,
        version: null,
        nativeSubagents: input.host.nativeSubagents,
        capabilities: input.host.capabilities,
      },
      authorization: {
        granted: capabilitiesToPermissionSet(
          input.authorization.granted,
          input.authorization.shellExecuteAllowlist,
          false,
          networkReadDomains,
        ),
        denied: capabilitiesToPermissionSet(
          input.authorization.denied,
          [],
          true,
        ),
      },
      budgets: {
        promptRevisions: run.budgets.promptRevisionsRemaining,
        postExecutionRemediations:
          run.budgets.postExecutionRemediationsRemaining,
        maximumParallelWorkers:
          input.host.nativeSubagents === "available" ? 3 : 1,
        maximumSubagentDepth:
          input.host.nativeSubagents === "available" ? 1 : 0,
      },
      policyRefs: [],
    });
    const artifacts: ArtifactSubmission[] = [
      {
        id: requestId,
        runId,
        type: "UserMessage",
        schemaVersion: "1.0",
        producer: "user",
        body: {
          schemaVersion: "1.0",
          id: requestId,
          runId,
          content: input.originalRequest,
        },
      },
      {
        id: envelopeId,
        runId,
        type: "RunEnvelope",
        schemaVersion: "1.0",
        producer: "controller",
        sourceRefs: [requestRef],
        body: envelopeBody,
      },
    ];
    this.ledger.createRun(run, artifacts);
    return { run, nextAction: this.getNextAction(runId) };
  }

  getNextAction(runId: string): NextAction {
    const run = this.ledger.requireRun(runId);
    const artifacts = this.ledger.listArtifacts(runId);
    const reservedPlanToolCalls = artifacts
      .filter((artifact) => artifact.type === "WorkPlan")
      .reduce((sum, artifact) => {
        const plan = this.ledger.getArtifact(runId, artifact.id)?.body;
        const nodes =
          typeof plan === "object" &&
          plan !== null &&
          "nodes" in plan &&
          Array.isArray(plan.nodes)
            ? (plan.nodes as Array<Record<string, unknown>>)
            : [];
        return (
          sum +
          nodes.reduce((nodeSum, node) => {
            const budgets = node.budgets;
            return (
              nodeSum +
              (typeof budgets === "object" &&
              budgets !== null &&
              "maximumToolCalls" in budgets &&
              typeof budgets.maximumToolCalls === "number"
                ? budgets.maximumToolCalls
                : 0)
            );
          }, 0)
        );
      }, 0);
    if (
      run.status === "completed" ||
      run.status === "partial" ||
      run.status === "blocked" ||
      run.status === "cancelled"
    ) {
      const report = [...artifacts]
        .reverse()
        .find((artifact) => artifact.type === "UserReport");
      const reportBody = report
        ? this.ledger.getArtifact(runId, report.id)?.body
        : null;
      const reportedStatus =
        typeof reportBody === "object" &&
        reportBody !== null &&
        "terminalStatus" in reportBody &&
        reportBody.terminalStatus === "failed_verification"
          ? "failed_verification"
          : run.status;
      return this.validateArtifact("NextAction", {
        schemaVersion: "1.0",
        id: `action:${runId}:${run.version}`,
        runId,
        createdAt: run.updatedAt,
        rationaleSummary: `Controller recorded terminal run status ${reportedStatus}.`,
        kind: "terminal",
        phase: run.status,
        status: reportedStatus,
        reportRef: report ? `artifact://${runId}/${report.id}` : null,
      }) as NextAction;
    }
    if (run.status === "awaiting_clarification") {
      const clarification = [...artifacts]
        .reverse()
        .find((artifact) => artifact.type === "ClarificationRequest");
      if (!clarification) {
        throw new Error("Awaiting-clarification run has no request artifact");
      }
      return this.validateArtifact("NextAction", {
        schemaVersion: "1.0",
        id: `action:${runId}:${run.version}`,
        runId,
        createdAt: run.updatedAt,
        rationaleSummary:
          "A materially divergent or permission-expanding choice requires the user.",
        kind: "clarification",
        phase: "awaiting_clarification",
        clarificationRequestRef: `artifact://${runId}/${clarification.id}`,
        effectivePermissions: emptyPermissionSet(),
        remainingBudgets: {
          promptRevisions: run.budgets.promptRevisionsRemaining,
          postExecutionRemediations:
            run.budgets.postExecutionRemediationsRemaining,
          remainingPlanToolCalls: Math.max(
            0,
            MAX_TOOL_CALLS_PER_RUN - reservedPlanToolCalls,
          ),
          maximumParallelWorkers: 1,
          maximumSubagentDepth: 0,
        },
      }) as NextAction;
    }
    const context = [...artifacts]
      .reverse()
      .find((artifact) => artifact.type === "ContextManifest");
    const envelopeRecord = artifacts.find(
      (artifact) => artifact.type === "RunEnvelope",
    );
    const envelope = envelopeRecord
      ? this.ledger.getArtifact(runId, envelopeRecord.id)?.body
      : undefined;
    const runPermissions = explicitPermissionProjection(
      run.requestedMode,
      envelope,
    );
    const allowedInputs = artifactInputsByPhase[run.phase];
    const latestByType = new Map<string, (typeof artifacts)[number]>();
    for (const artifact of artifacts) latestByType.set(artifact.type, artifact);
    const eligibleInputs = artifacts.filter((artifact) =>
      allowedInputs.has(artifact.type),
    );
    const eligibleById = new Map(
      eligibleInputs.map((artifact) => [artifact.id, artifact]),
    );
    const selectedInputIds = new Set<string>();
    for (const [type, artifact] of latestByType) {
      if (allowedInputs.has(type) && type !== "Evidence") {
        selectedInputIds.add(artifact.id);
      }
    }
    const originalRequestRef =
      typeof envelope === "object" &&
      envelope !== null &&
      "originalRequestRef" in envelope &&
      typeof envelope.originalRequestRef === "string"
        ? artifactIdFromUri(envelope.originalRequestRef)
        : null;
    if (originalRequestRef) selectedInputIds.add(originalRequestRef);
    for (const artifact of eligibleInputs) {
      if (artifact.type === "WorkPlan" || artifact.type === "WorkResult") {
        selectedInputIds.add(artifact.id);
      }
    }
    const closureQueue = [...selectedInputIds];
    for (let index = 0; index < closureQueue.length; index += 1) {
      if (selectedInputIds.size > MAX_NEXT_ACTION_INPUT_REFS) {
        throw new Error(
          "NextAction input reference closure exceeds 256; use a smaller plan/evidence manifest",
        );
      }
      const artifactId = closureQueue[index]!;
      const record = eligibleById.get(artifactId);
      if (!record) continue;
      const hydrated = this.ledger.getArtifact(runId, artifactId);
      const references = [
        ...collectArtifactReferences(hydrated?.body),
        ...record.sourceRefs.map((ref, referenceIndex) => ({
          ref,
          path: `sourceRefs[${String(referenceIndex)}]`,
        })),
      ];
      for (const reference of references) {
        const match = /^artifact:\/\/([^/]+)\/([^/]+)$/u.exec(reference.ref);
        const referencedRecord = match ? eligibleById.get(match[2]!) : null;
        if (
          !match ||
          match[1] !== runId ||
          !referencedRecord ||
          referencedRecord.type === "Evidence"
        ) {
          continue;
        }
        if (!selectedInputIds.has(match[2]!)) {
          selectedInputIds.add(match[2]!);
          closureQueue.push(match[2]!);
        }
      }
    }
    if (selectedInputIds.size > MAX_NEXT_ACTION_INPUT_REFS) {
      throw new Error(
        "NextAction input reference closure exceeds 256; use a smaller plan/evidence manifest",
      );
    }
    for (const artifact of [...eligibleInputs].reverse()) {
      if (selectedInputIds.size >= MAX_NEXT_ACTION_INPUT_REFS) break;
      if (artifact.type === "Evidence") selectedInputIds.add(artifact.id);
    }
    const inputArtifacts = eligibleInputs.filter((artifact) =>
      selectedInputIds.has(artifact.id),
    );
    const pendingNode =
      run.phase === "agent_4_execute"
        ? this.executionProgress(run.runId).pendingNode
        : null;
    let phasePermissions = emptyPermissionSet();
    if (run.phase === "context_grounding") {
      phasePermissions.repository.read = [...runPermissions.repository.read];
    } else if (run.phase === "agent_4_execute" && pendingNode?.permissions) {
      if (!permissionSetIsSubset(pendingNode.permissions, runPermissions)) {
        throw new Error(
          `Work node ${pendingNode.id} exceeds the immutable run authorization`,
        );
      }
      phasePermissions = structuredClone(pendingNode.permissions);
    }
    const hostBudgets =
      typeof envelope === "object" && envelope !== null && "budgets" in envelope
        ? (
            envelope as {
              budgets: {
                maximumParallelWorkers?: number;
                maximumSubagentDepth?: number;
              };
            }
          ).budgets
        : {};
    const action: NextAction = {
      schemaVersion: "1.0",
      id: `action:${runId}:${run.version}`,
      runId,
      createdAt: run.updatedAt,
      rationaleSummary: `Controller selected ${protocolPhaseByInternal[run.phase]} from immutable run state.`,
      kind: "phase",
      phase: protocolPhaseByInternal[run.phase],
      logicalRole: roleByPhase[run.phase],
      instructionRef: `artifact://system/roles/${roleByPhase[run.phase]}-v1`,
      inputRefs: inputArtifacts.map(
        (artifact) => `artifact://${runId}/${artifact.id}`,
      ),
      contextManifestRef: context ? `artifact://${runId}/${context.id}` : null,
      requiredOutputType: requiredArtifactTypes(run)[0]!,
      requiredOutputSchema: this.artifactSchema(requiredArtifactTypes(run)[0]!),
      additionalOutputSchemas: Object.fromEntries(
        [
          ...requiredArtifactTypes(run).slice(1),
          ...(run.phase === "agent_4_execute" ? ["Evidence"] : []),
        ].map((type) => [type, this.artifactSchema(type)]),
      ),
      workNodeId: pendingNode?.id ?? null,
      effectivePermissions: phasePermissions,
      remainingBudgets: {
        promptRevisions: run.budgets.promptRevisionsRemaining,
        postExecutionRemediations:
          run.budgets.postExecutionRemediationsRemaining,
        remainingPlanToolCalls: Math.max(
          0,
          MAX_TOOL_CALLS_PER_RUN - reservedPlanToolCalls,
        ),
        maximumParallelWorkers:
          run.phase === "agent_4_execute"
            ? Math.min(
                hostBudgets.maximumParallelWorkers ?? 1,
                (() => {
                  const planRecord = latestByType.get("WorkPlan");
                  const planBody = planRecord
                    ? this.ledger.getArtifact(runId, planRecord.id)?.body
                    : null;
                  return typeof planBody === "object" &&
                    planBody !== null &&
                    typeof (
                      planBody as {
                        globalBudgets?: { maximumParallelWorkers?: unknown };
                      }
                    ).globalBudgets?.maximumParallelWorkers === "number"
                    ? (
                        planBody as {
                          globalBudgets: { maximumParallelWorkers: number };
                        }
                      ).globalBudgets.maximumParallelWorkers
                    : 1;
                })(),
              )
            : (hostBudgets.maximumParallelWorkers ?? 1),
        maximumSubagentDepth:
          run.phase === "agent_4_execute"
            ? Math.min(
                hostBudgets.maximumSubagentDepth ?? 0,
                pendingNode?.permissions?.subagents.maximumDepth ?? 0,
              )
            : (hostBudgets.maximumSubagentDepth ?? 0),
      },
      stopConditions: [
        "Do not broaden the user-selected intent mode or permissions.",
        "Stop at a materially divergent user-owned decision.",
        "Submit concise rationale summaries and evidence references, never hidden chain-of-thought.",
      ],
    };
    return this.validateArtifact("NextAction", action) as NextAction;
  }

  submitArtifact(submission: ArtifactSubmission): {
    run: RunRecord;
    nextAction: NextAction;
  } {
    const current = this.ledger.requireRun(submission.runId);
    const validatedBody = this.validateArtifact(
      submission.type,
      submission.body,
    );
    const body = requireObjectBody(validatedBody);
    if (body.id !== submission.id) {
      throw new Error("Artifact body id must match submission id");
    }
    if (body.runId !== submission.runId) {
      throw new Error("Artifact body runId must match submission runId");
    }
    if (
      submission.schemaVersion !== "1.0" ||
      body.schemaVersion !== submission.schemaVersion
    ) {
      throw new Error(
        "Artifact body schemaVersion must match supported submission schemaVersion",
      );
    }
    const producer = expectedProducer(current, submission.type);
    if (submission.producer !== producer) {
      throw new Error(
        `Artifact producer for ${submission.type} must be ${producer}`,
      );
    }
    const normalized = { ...submission, producer, body };
    const clarificationBudgetExhausted =
      submission.type === "ClarificationRequest" &&
      this.ledger
        .listArtifacts(submission.runId)
        .filter((artifact) => artifact.type === "ClarificationRequest")
        .length >= MAX_CLARIFICATIONS_PER_RUN;
    if (clarificationBudgetExhausted && current.status !== "running") {
      throw new Error(
        "Clarification budget exhaustion can only be recorded for a running phase",
      );
    }
    if (
      clarificationBudgetExhausted &&
      !requiredArtifactTypes(current).includes("ClarificationRequest")
    ) {
      throw new Error(
        `Phase ${current.phase} cannot record another clarification boundary`,
      );
    }
    const clarificationLineage = this.pendingClarificationLineage(
      submission.runId,
    );
    if (
      clarificationLineage &&
      submission.type !== "ClarificationRequest" &&
      requiredArtifactTypes(current).includes(submission.type) &&
      !clarificationLineage.every((reference) =>
        (submission.sourceRefs ?? []).includes(reference),
      )
    ) {
      throw new Error(
        "The resumed phase artifact must cite the exact clarification request and answer",
      );
    }
    this.assertArtifactReferences(normalized);
    try {
      this.assertCrossArtifactInvariants(current, normalized);
    } catch (error) {
      if (error instanceof PermissionAuthorizationError) {
        this.ledger.appendTraceEventOnce(submission.runId, {
          actor: "controller",
          eventType: "permission_checked",
          phase: current.phase,
          inputRefs: error.inputRefs,
          permissionDecision: error.permissionDecision,
          decisionSummary: error.message,
        });
      }
      throw error;
    }
    const permissionEvents =
      submission.type === "WorkResult"
        ? this.workResultPermissionEvents(current, body)
        : [];
    const execution =
      submission.type === "WorkResult"
        ? this.executionProgress(submission.runId, body)
        : null;
    const transition = clarificationBudgetExhausted
      ? {
          run: {
            ...current,
            phase: "agent_5_report" as const,
            status: "running" as const,
            resumePhase: null,
            outcomeHint: "blocked" as const,
          },
          summary:
            "Clarification budget was exhausted; an honest blocked report is required without asking the user again.",
        }
      : advanceRun(current, normalized, {
          ...(execution
            ? { executionComplete: execution.remainingAfterSubmission === 0 }
            : {}),
        });
    const now = new Date().toISOString();
    const nextRun: RunRecord = {
      ...transition.run,
      version: current.version + 1,
      updatedAt: now,
    };
    const event = {
      actor: submission.producer,
      eventType: clarificationBudgetExhausted
        ? "budget_consumed"
        : submission.type === "ClarificationRequest"
          ? "clarification_requested"
          : "phase_submitted",
      phase: current.phase,
      decisionSummary: transition.summary,
      ...(submission.sourceRefs ? { inputRefs: submission.sourceRefs } : {}),
    };
    const primaryEvent = permissionEvents[0] ?? event;
    const additionalEvents =
      permissionEvents.length > 0 ? [...permissionEvents.slice(1), event] : [];
    this.ledger.applySubmission(
      current.version,
      nextRun,
      normalized,
      primaryEvent,
      additionalEvents,
    );
    return {
      run: nextRun,
      nextAction: this.getNextAction(nextRun.runId),
    };
  }

  private latestBody(
    runId: string,
    type: string,
    required = true,
  ): ArtifactProjection | null {
    const record = this.ledger.findLatestArtifact(runId, type);
    if (!record) {
      if (required) throw new Error(`Run is missing required ${type} artifact`);
      return null;
    }
    const hydrated = this.ledger.getArtifact(runId, record.id);
    if (
      !hydrated ||
      typeof hydrated.body !== "object" ||
      hydrated.body === null ||
      Array.isArray(hydrated.body)
    ) {
      throw new Error(`Stored ${type} artifact has an invalid body`);
    }
    return hydrated.body as ArtifactProjection;
  }

  private latestRef(runId: string, type: string): string {
    const record = this.ledger.findLatestArtifact(runId, type);
    if (!record) throw new Error(`Run is missing required ${type} artifact`);
    return `artifact://${runId}/${record.id}`;
  }

  private workResultRefsForPlan(runId: string, planRef: string): string[] {
    const refs: string[] = [];
    for (const record of this.ledger
      .listArtifacts(runId)
      .filter((artifact) => artifact.type === "WorkResult")) {
      const body = this.ledger.getArtifact(runId, record.id)?.body;
      if (
        typeof body === "object" &&
        body !== null &&
        (body as { workPlanRef?: unknown }).workPlanRef === planRef
      ) {
        refs.push(`artifact://${runId}/${record.id}`);
      }
    }
    return refs;
  }

  private allArtifactRefs(runId: string, type: string): string[] {
    return this.ledger
      .listArtifacts(runId)
      .filter((artifact) => artifact.type === type)
      .map((artifact) => `artifact://${runId}/${artifact.id}`);
  }

  private analysisFixUnlocked(runId: string): boolean {
    const authorizedReviewRefs = new Set<string>();
    for (const artifact of this.ledger
      .listArtifacts(runId)
      .filter((candidate) => candidate.type === "QualityReview")) {
      const body = this.ledger.getArtifact(runId, artifact.id)?.body;
      if (
        typeof body === "object" &&
        body !== null &&
        (body as { decision?: unknown }).decision === "proceed_to_fix" &&
        typeof (body as { diagnosisGate?: unknown }).diagnosisGate ===
          "object" &&
        (body as { diagnosisGate?: unknown }).diagnosisGate !== null &&
        typeof (
          body as {
            diagnosisGate: { correctionWorkOrder?: unknown };
          }
        ).diagnosisGate.correctionWorkOrder === "object"
      ) {
        authorizedReviewRefs.add(`artifact://${runId}/${artifact.id}`);
      }
    }
    if (authorizedReviewRefs.size === 0) return false;
    return this.ledger
      .listArtifacts(runId)
      .filter((artifact) => artifact.type === "WorkPlan")
      .some((artifact) => {
        const body = this.ledger.getArtifact(runId, artifact.id)?.body;
        const nodes =
          typeof body === "object" && body !== null && "nodes" in body
            ? (body as { nodes?: unknown }).nodes
            : null;
        return (
          Array.isArray(nodes) &&
          nodes.length > 0 &&
          nodes.every(
            (node) =>
              typeof node === "object" &&
              node !== null &&
              stringArray((node as { inputRefs?: unknown }).inputRefs).some(
                (reference) => authorizedReviewRefs.has(reference),
              ),
          )
        );
      });
  }

  private assertScopedWorkOrder(
    orderValue: unknown,
    options: {
      label: string;
      criterionField: "targetCriterionIds" | "failedCriterionIds";
      allowedCriteria: readonly string[];
      contractPermissions: StructuredPermissionSet;
      authorizedPermissions: StructuredPermissionSet;
      eligibleSourceRefs: ReadonlySet<string>;
      requireAllCriteria?: boolean;
      requireExecutableCapability?: boolean;
    },
  ): void {
    if (
      typeof orderValue !== "object" ||
      orderValue === null ||
      Array.isArray(orderValue)
    ) {
      throw new Error(`${options.label} must be a typed scoped work order`);
    }
    const order = orderValue as Record<string, unknown>;
    const criterionIds = stringArray(order[options.criterionField]);
    if (
      criterionIds.length === 0 ||
      new Set(criterionIds).size !== criterionIds.length ||
      criterionIds.some(
        (criterion) => !options.allowedCriteria.includes(criterion),
      )
    ) {
      throw new Error(`${options.label} contains invalid contract criteria`);
    }
    if (
      options.requireAllCriteria === true &&
      !equalStringSets(criterionIds, options.allowedCriteria)
    ) {
      throw new Error(
        `${options.label} must cover every authorized criterion exactly once`,
      );
    }
    const permissions = permissionSet(
      order.permissions,
      `${options.label} permissions`,
    );
    if (
      !permissionSetIsSubset(permissions, options.contractPermissions) ||
      !permissionSetIsSubset(permissions, options.authorizedPermissions)
    ) {
      throw new Error(`${options.label} permissions exceed authorization`);
    }
    const capabilities = stringArray(order.allowedCapabilities);
    if (
      options.requireExecutableCapability === true &&
      capabilities.length === 0
    ) {
      throw new Error(
        `${options.label} requires at least one executable capability`,
      );
    }
    if (
      capabilities.some(
        (capability) => !permissionAllowsCapability(permissions, capability),
      )
    ) {
      throw new Error(
        `${options.label} capabilities are not permission-backed`,
      );
    }
    if (
      !stringArray(order.sourceRefs).some((reference) =>
        options.eligibleSourceRefs.has(reference),
      )
    ) {
      throw new Error(`${options.label} lacks current supporting evidence`);
    }
  }

  private workResultPermissionEvents(
    run: RunRecord,
    body: Record<string, unknown>,
  ) {
    const node = this.executionProgress(run.runId).pendingNode;
    if (!node) return [];
    const nodePermissions = permissionSet(
      node.permissions,
      `Work node ${node.id} permissions`,
    );
    const policies = [
      policyForMode(run.requestedMode),
      policyFromPermissionSet(`work_node:${node.id}`, nodePermissions),
    ];
    const policyRefs = [
      this.latestRef(run.runId, "TaskContract"),
      this.latestRef(run.runId, "WorkPlan"),
    ];
    const actions = Array.isArray(body.actions)
      ? (body.actions as Array<Record<string, unknown>>)
      : [];
    return actions
      .filter(
        (action) =>
          action.status === "completed" ||
          action.status === "failed" ||
          action.status === "denied",
      )
      .map((action) => {
        const kind =
          typeof action.capability === "string"
            ? actionKindForCapability(action.capability)
            : null;
        const allowedTool =
          typeof action.capability === "string" &&
          (node.allowedTools ?? []).includes(action.capability);
        const decision =
          kind && allowedTool
            ? authorizeAction(
                {
                  kind,
                  ...(typeof action.target === "string"
                    ? { target: action.target }
                    : {}),
                },
                policies,
                run.repositoryRoot,
              )
            : {
                allowed: false,
                summary: `Denied: capability is outside work node ${node.id}.`,
              };
        const permissionDecision = tracePermissionDecision(
          action,
          decision.allowed,
          policyRefs,
          decision.summary,
        );
        return {
          actor: "controller",
          eventType: "permission_checked",
          phase: run.phase,
          inputRefs: policyRefs,
          permissionDecision,
          decisionSummary: `${permissionDecision.decision === "allow" ? "Allowed" : "Denied"} ${permissionDecision.capability} for ${permissionDecision.scope}.`,
        };
      });
  }

  private assertCrossArtifactInvariants(
    run: RunRecord,
    submission: ArtifactSubmission & { body: Record<string, unknown> },
  ): void {
    const body = submission.body;
    const envelope = this.latestBody(run.runId, "RunEnvelope")!;
    if (typeof envelope.originalRequestRef !== "string") {
      throw new Error("RunEnvelope is missing its original request reference");
    }
    const originalRequestRef = envelope.originalRequestRef;
    const authorized = explicitPermissionProjection(
      run.requestedMode,
      envelope,
    );

    if (submission.type === "ClarificationRequest") {
      return;
    }

    if (submission.type === "ProblemFrame") {
      if (body.intentMode !== run.requestedMode) {
        throw new Error(
          "ProblemFrame intentMode must match the immutable run mode",
        );
      }
      if (body.originalRequestRef !== originalRequestRef) {
        throw new Error(
          "ProblemFrame must reference the current original request",
        );
      }
      const knownFacts = Array.isArray(body.knownFacts)
        ? (body.knownFacts as Array<Record<string, unknown>>)
        : [];
      const userMessageRefs = new Set(
        this.ledger
          .listArtifacts(run.runId)
          .filter(
            (artifact) =>
              artifact.type === "UserMessage" && artifact.producer === "user",
          )
          .map((artifact) => `artifact://${run.runId}/${artifact.id}`),
      );
      for (const fact of knownFacts) {
        if (typeof fact.sourceRef !== "string") {
          throw new Error("ProblemFrame fact source is invalid");
        }
        if (
          fact.provenance === "user" &&
          !userMessageRefs.has(fact.sourceRef)
        ) {
          throw new Error(
            "User-provenance facts must cite a same-run user message",
          );
        }
        if (
          fact.provenance === "repository" &&
          !fact.sourceRef.startsWith("repo://")
        ) {
          throw new Error(
            "Repository-provenance facts must cite selected repository context",
          );
        }
        if (["runtime", "browser", "tool"].includes(String(fact.provenance))) {
          const sourceId = artifactIdFromUri(fact.sourceRef);
          const evidence = sourceId
            ? this.ledger.getArtifact(run.runId, sourceId)
            : null;
          const kind =
            typeof evidence?.body === "object" &&
            evidence.body !== null &&
            "kind" in evidence.body
              ? (evidence.body as { kind?: unknown }).kind
              : null;
          const allowedKinds =
            fact.provenance === "runtime"
              ? new Set(["runtime", "log"])
              : fact.provenance === "browser"
                ? new Set(["browser"])
                : new Set(["tool_output", "test", "diff"]);
          if (
            evidence?.type !== "Evidence" ||
            !allowedKinds.has(String(kind))
          ) {
            throw new Error(
              `${String(fact.provenance)}-provenance facts require matching Evidence`,
            );
          }
        }
      }
      if (
        typeof body.clarification === "object" &&
        body.clarification !== null &&
        (body.clarification as { required?: unknown }).required === true
      ) {
        throw new Error(
          "Required clarification must be submitted as ClarificationRequest before ProblemFrame",
        );
      }
      return;
    }

    if (submission.type === "TaskContract") {
      if (body.intentMode !== run.requestedMode) {
        throw new Error(
          "TaskContract intentMode must match the immutable run mode",
        );
      }
      if (
        body.originalRequestRef !== originalRequestRef ||
        body.problemFrameRef !== this.latestRef(run.runId, "ProblemFrame")
      ) {
        throw new Error("TaskContract lineage is stale or incomplete");
      }
      const problemFrame = this.latestBody(run.runId, "ProblemFrame")!;
      const requiredContextRefs = new Set<string>();
      if (Array.isArray(problemFrame.knownFacts)) {
        for (const fact of problemFrame.knownFacts) {
          if (
            typeof fact === "object" &&
            fact !== null &&
            (fact as { provenance?: unknown }).provenance !== "user" &&
            typeof (fact as { sourceRef?: unknown }).sourceRef === "string"
          ) {
            requiredContextRefs.add((fact as { sourceRef: string }).sourceRef);
          }
        }
      }
      if (Array.isArray(problemFrame.inferences)) {
        for (const inference of problemFrame.inferences) {
          if (typeof inference === "object" && inference !== null) {
            for (const reference of stringArray(
              (inference as { sourceRefs?: unknown }).sourceRefs,
            )) {
              requiredContextRefs.add(reference);
            }
          }
        }
      }
      if (
        [...requiredContextRefs].some(
          (reference) => !stringArray(body.contextRefs).includes(reference),
        )
      ) {
        throw new Error(
          "TaskContract contextRefs must retain every non-user ProblemFrame fact and inference source",
        );
      }
      if (run.phase === "agent_2_compile") {
        for (const field of ["scope", "constraints", "nonGoals"] as const) {
          if (
            canonicalJson(body[field]) !== canonicalJson(problemFrame[field])
          ) {
            throw new Error(
              `TaskContract must preserve ProblemFrame ${field} exactly`,
            );
          }
        }
        if (
          canonicalJson(body.acceptanceCriteria) !==
          canonicalJson(problemFrame.draftAcceptanceCriteria)
        ) {
          throw new Error(
            "TaskContract acceptance criteria must preserve the reviewed ProblemFrame draft exactly",
          );
        }
      }
      if (
        !equalStringSets(
          stringArray(body.ruleRefs),
          stringArray(problemFrame.applicableRuleRefs),
        )
      ) {
        throw new Error(
          "TaskContract must retain every applicable ProblemFrame rule exactly once",
        );
      }
      const priorContracts = this.ledger
        .listArtifacts(run.runId)
        .filter((artifact) => artifact.type === "TaskContract");
      if (run.phase === "agent_2_compile") {
        if (priorContracts.length !== 0 || body.version !== 1) {
          throw new Error("The initial TaskContract must be version 1");
        }
      } else if (run.phase === "agent_2_revise") {
        const previousRecord = priorContracts.at(-1);
        const reviewRecord = this.ledger.findLatestArtifact(
          run.runId,
          "PromptReview",
        );
        if (!previousRecord || !reviewRecord) {
          throw new Error("TaskContract revision is missing its prior lineage");
        }
        const previous = this.ledger.getArtifact(
          run.runId,
          previousRecord.id,
        )?.body;
        const review = this.ledger.getArtifact(
          run.runId,
          reviewRecord.id,
        )?.body;
        const requiredRefs = [
          `artifact://${run.runId}/${previousRecord.id}`,
          `artifact://${run.runId}/${reviewRecord.id}`,
        ];
        if (
          typeof previous !== "object" ||
          previous === null ||
          typeof review !== "object" ||
          review === null ||
          (review as { decision?: unknown }).decision !== "revise" ||
          (review as { revisionNumber?: unknown }).revisionNumber !== 0 ||
          body.version !== 2 ||
          !requiredRefs.every((reference) =>
            (submission.sourceRefs ?? []).includes(reference),
          )
        ) {
          throw new Error(
            "Revised TaskContract must be version 2 and cite its contract review lineage",
          );
        }
        const preservedFields = Array.isArray(
          (review as { findings?: unknown }).findings,
        )
          ? (
              review as { findings: Array<Record<string, unknown>> }
            ).findings.flatMap((finding) => stringArray(finding.preserveFields))
          : [];
        const correctionFields = new Set(
          Array.isArray((review as { findings?: unknown }).findings)
            ? (review as { findings: Array<Record<string, unknown>> }).findings
                .filter(
                  (finding) =>
                    finding.severity === "blocking" &&
                    typeof finding.requiredCorrection === "string",
                )
                .flatMap((finding) => stringArray(finding.correctionFields))
            : [],
        );
        const previousPermissions = permissionSet(
          (previous as Record<string, unknown>).permissions,
          "Previous TaskContract permissions",
        );
        const revisedPermissions = permissionSet(
          body.permissions,
          "Revised TaskContract permissions",
        );
        if (!permissionSetIsSubset(revisedPermissions, previousPermissions)) {
          throw new Error(
            "TaskContract revision permissions cannot broaden the prior contract",
          );
        }
        const changedFields = new Set(
          [...new Set([...Object.keys(previous), ...Object.keys(body)])].filter(
            (field) =>
              field !== "id" &&
              field !== "version" &&
              canonicalJson((previous as Record<string, unknown>)[field]) !==
                canonicalJson(body[field]),
          ),
        );
        const preserved = new Set(preservedFields);
        for (const field of correctionFields) {
          if (preserved.has(field)) {
            throw new Error(
              `TaskContract revision field ${field} cannot be both preserved and corrected`,
            );
          }
        }
        for (const field of changedFields) {
          if (!correctionFields.has(field)) {
            throw new Error(
              `TaskContract revision field ${field} is outside the typed correction scope`,
            );
          }
        }
        for (const field of correctionFields) {
          if (!changedFields.has(field)) {
            throw new Error(
              `TaskContract revision did not apply declared correction field ${field}`,
            );
          }
        }
        for (const field of new Set(preservedFields)) {
          if (
            !(field in previous) ||
            !(field in body) ||
            canonicalJson((previous as Record<string, unknown>)[field]) !==
              canonicalJson(body[field])
          ) {
            throw new Error(
              `Revised TaskContract changed preserved field ${field}`,
            );
          }
        }
      }
      const requested = permissionSet(
        body.permissions,
        "TaskContract permissions",
      );
      const verificationRequirements = Array.isArray(
        body.verificationRequirements,
      )
        ? (body.verificationRequirements as Array<Record<string, unknown>>)
        : [];
      for (const requirement of verificationRequirements) {
        if (
          requirement.required === true &&
          (typeof requirement.capability !== "string" ||
            !permissionAllowsCapability(requested, requirement.capability))
        ) {
          throw new Error(
            `Required verification ${String(requirement.id)} is not backed by TaskContract permissions`,
          );
        }
      }
      if (
        requested.shell.executeAllowlist.some(
          (command) =>
            command === "authorized" ||
            command === "**" ||
            /[*?\[\]]/u.test(command) ||
            !shellCommandIsSafe(command),
        )
      ) {
        throw new Error(
          "TaskContract shell execute permissions require exact, non-compound commands",
        );
      }
      if (!permissionSetIsSubset(requested, authorized)) {
        throw new Error(
          "TaskContract permissions exceed immutable authorization",
        );
      }
      return;
    }

    if (submission.type === "PromptReview") {
      if (body.targetRef !== this.latestRef(run.runId, "TaskContract")) {
        throw new Error("PromptReview must review the current TaskContract");
      }
      const contract = this.latestBody(run.runId, "TaskContract")!;
      const coverage = Array.isArray(body.coverage)
        ? (body.coverage as Array<Record<string, unknown>>)
        : [];
      const expectedCoverage = new Map<string, string[]>([
        [originalRequestRef, ["objective", "intentMode"]],
        [
          String(contract.problemFrameRef),
          [
            "scope",
            "constraints",
            "nonGoals",
            "acceptanceCriteria",
            "ruleRefs",
          ],
        ],
        [
          this.latestRef(run.runId, "TaskContract"),
          [
            "permissions",
            "contextRefs",
            "requiredOutputs",
            "verificationRequirements",
            "stopConditions",
            "assumptions",
            "unresolvedQuestions",
          ],
        ],
      ]);
      if (coverage.length !== expectedCoverage.size) {
        throw new Error(
          "PromptReview coverage must include every authoritative contract source",
        );
      }
      for (const [sourceRef, expectedFields] of expectedCoverage) {
        const matches = coverage.filter(
          (entry) => entry.sourceRef === sourceRef,
        );
        if (
          matches.length !== 1 ||
          !equalStringSets(
            stringArray(matches[0]!.contractFields),
            expectedFields,
          )
        ) {
          throw new Error(
            `PromptReview coverage for ${sourceRef} is incomplete or duplicated`,
          );
        }
      }
      if (
        typeof contract.version !== "number" ||
        body.revisionNumber !== contract.version - 1
      ) {
        throw new Error(
          "PromptReview revisionNumber must match the current TaskContract version",
        );
      }
      return;
    }

    if (submission.type === "WorkPlan") {
      const contractRef = this.latestRef(run.runId, "TaskContract");
      if (body.taskContractRef !== contractRef) {
        throw new Error("WorkPlan must target the current TaskContract");
      }
      if (body.planValidation !== "valid") {
        throw new Error(
          "Only a validated WorkPlan may enter execution or review",
        );
      }
      if (body.executionMode !== "serial") {
        throw new Error(
          "The current controller supports deterministic serial WorkPlans only",
        );
      }
      const contract = this.latestBody(run.runId, "TaskContract")!;
      const contractPermissions = permissionSet(
        contract.permissions,
        "TaskContract permissions",
      );
      const criterionRecords = Array.isArray(contract.acceptanceCriteria)
        ? contract.acceptanceCriteria.filter(
            (criterion): criterion is Record<string, unknown> =>
              typeof criterion === "object" && criterion !== null,
          )
        : [];
      const criteria = new Set(
        criterionRecords
          .map((criterion) => criterion.id)
          .filter((id): id is string => typeof id === "string"),
      );
      const criterionStages = new Map(
        criterionRecords
          .filter(
            (criterion) =>
              typeof criterion.id === "string" &&
              typeof criterion.stage === "string",
          )
          .map((criterion) => [
            criterion.id as string,
            criterion.stage as string,
          ]),
      );
      const nodes = Array.isArray(body.nodes)
        ? (body.nodes as unknown as WorkNodeProjection[])
        : [];
      const globalBudgets =
        typeof body.globalBudgets === "object" && body.globalBudgets !== null
          ? (body.globalBudgets as Record<string, unknown>)
          : {};
      const requestedToolCalls = nodes.reduce((sum, node) => {
        const budgets = (
          node as unknown as { budgets?: { maximumToolCalls?: unknown } }
        ).budgets;
        return (
          sum +
          (typeof budgets?.maximumToolCalls === "number"
            ? budgets.maximumToolCalls
            : 0)
        );
      }, 0);
      if (
        typeof globalBudgets.maximumToolCalls !== "number" ||
        requestedToolCalls > globalBudgets.maximumToolCalls
      ) {
        throw new Error("WorkPlan node tool budgets exceed the global budget");
      }
      const priorPlanToolCalls = this.ledger
        .listArtifacts(run.runId)
        .filter(
          (artifact) =>
            artifact.type === "WorkPlan" && artifact.id !== submission.id,
        )
        .reduce((sum, artifact) => {
          const prior = this.ledger.getArtifact(run.runId, artifact.id)?.body;
          const nodes =
            typeof prior === "object" &&
            prior !== null &&
            "nodes" in prior &&
            Array.isArray(prior.nodes)
              ? (prior.nodes as Array<Record<string, unknown>>)
              : [];
          return (
            sum +
            nodes.reduce((nodeSum, node) => {
              const budgets = node.budgets;
              return (
                nodeSum +
                (typeof budgets === "object" &&
                budgets !== null &&
                "maximumToolCalls" in budgets &&
                typeof budgets.maximumToolCalls === "number"
                  ? budgets.maximumToolCalls
                  : 0)
              );
            }, 0)
          );
        }, 0);
      if (priorPlanToolCalls + requestedToolCalls > MAX_TOOL_CALLS_PER_RUN) {
        throw new Error(
          `WorkPlan exceeds the cumulative run tool-call budget of ${String(MAX_TOOL_CALLS_PER_RUN)}`,
        );
      }
      const envelopeBudgets =
        typeof envelope.budgets === "object" && envelope.budgets !== null
          ? (envelope.budgets as Record<string, unknown>)
          : {};
      if (
        typeof globalBudgets.maximumParallelWorkers !== "number" ||
        typeof globalBudgets.maximumSubagentDepth !== "number" ||
        globalBudgets.maximumParallelWorkers >
          (typeof envelopeBudgets.maximumParallelWorkers === "number"
            ? envelopeBudgets.maximumParallelWorkers
            : 1) ||
        globalBudgets.maximumSubagentDepth >
          (typeof envelopeBudgets.maximumSubagentDepth === "number"
            ? envelopeBudgets.maximumSubagentDepth
            : 0)
      ) {
        throw new Error("WorkPlan concurrency exceeds immutable host budgets");
      }
      const latestControlRecord = [...this.ledger.listArtifacts(run.runId)]
        .reverse()
        .find(
          (artifact) =>
            artifact.type === "QualityReview" ||
            artifact.type === "ReleaseAudit",
        );
      const latestControl = latestControlRecord
        ? this.ledger.getArtifact(run.runId, latestControlRecord.id)?.body
        : null;
      const remediationControl =
        typeof latestControl === "object" &&
        latestControl !== null &&
        (latestControl as { decision?: unknown }).decision === "remediate"
          ? (latestControl as Record<string, unknown>)
          : null;
      const correctionControl =
        latestControlRecord?.type === "QualityReview" &&
        typeof latestControl === "object" &&
        latestControl !== null &&
        (latestControl as { decision?: unknown }).decision === "proceed_to_fix"
          ? (latestControl as Record<string, unknown>)
          : null;
      const planCeiling =
        run.requestedMode === "analyze_and_fix" &&
        !this.analysisFixUnlocked(run.runId) &&
        correctionControl === null
          ? explicitPermissionProjection("analyze_only", envelope)
          : contractPermissions;
      let scopedCriteria: string[] | null = null;
      if ((remediationControl || correctionControl) && latestControlRecord) {
        const workOrder = correctionControl
          ? typeof correctionControl.diagnosisGate === "object" &&
            correctionControl.diagnosisGate !== null
            ? (correctionControl.diagnosisGate as Record<string, unknown>)
                .correctionWorkOrder
            : null
          : latestControlRecord.type === "QualityReview"
            ? remediationControl!.remediationWorkOrder
            : remediationControl!.remediationDefect;
        if (typeof workOrder !== "object" || workOrder === null) {
          throw new Error("Scoped replanning is missing its typed work order");
        }
        const projectedOrder = workOrder as Record<string, unknown>;
        scopedCriteria = correctionControl
          ? stringArray(projectedOrder.targetCriterionIds)
          : stringArray(projectedOrder.failedCriterionIds);
        const controllingRef = `artifact://${run.runId}/${latestControlRecord.id}`;
        if (
          nodes.some(
            (node) => !stringArray(node.inputRefs).includes(controllingRef),
          )
        ) {
          throw new Error(
            "Every scoped node must reference its controlling review or audit",
          );
        }
        if (
          typeof projectedOrder.maximumToolCalls !== "number" ||
          typeof globalBudgets.maximumToolCalls !== "number" ||
          globalBudgets.maximumToolCalls > projectedOrder.maximumToolCalls
        ) {
          throw new Error("Scoped WorkPlan exceeds its work-order tool budget");
        }
        const allowedCapabilities = new Set(
          stringArray(projectedOrder.allowedCapabilities),
        );
        if (
          nodes.some((node) =>
            (node.allowedTools ?? []).some(
              (capability) => !allowedCapabilities.has(capability),
            ),
          )
        ) {
          throw new Error(
            "Scoped WorkPlan uses capabilities outside its work order",
          );
        }
        const scopedPermissions = permissionSet(
          projectedOrder.permissions,
          "Scoped work-order permissions",
        );
        for (const node of nodes) {
          if (
            !permissionSetIsSubset(
              permissionSet(
                node.permissions,
                `Work node ${node.id} permissions`,
              ),
              scopedPermissions,
            )
          ) {
            throw new Error(`Work node ${node.id} exceeds scoped permissions`);
          }
        }
      }
      const coveredCriteria = new Set<string>();
      for (const node of nodes) {
        const nodePermissions = permissionSet(
          node.permissions,
          `Work node ${node.id} permissions`,
        );
        if (!permissionSetIsSubset(nodePermissions, contractPermissions)) {
          throw new Error(
            `Work node ${node.id} permissions exceed the TaskContract`,
          );
        }
        if (!permissionSetIsSubset(nodePermissions, planCeiling)) {
          throw new Error(
            `Work node ${node.id} attempts mutation before the diagnosis review gate`,
          );
        }
        if (
          (node.budgets?.maximumChildren ?? 0) >
          nodePermissions.subagents.maximumChildren
        ) {
          throw new Error(
            `Work node ${node.id} child budget exceeds its subagent permission`,
          );
        }
        if (
          nodePermissions.subagents.maximumDepth >
            (globalBudgets.maximumSubagentDepth as number) ||
          (nodePermissions.subagents.spawn &&
            (globalBudgets.maximumSubagentDepth as number) === 0)
        ) {
          throw new Error(
            `Work node ${node.id} subagent depth exceeds the WorkPlan or host budget`,
          );
        }
        for (const capability of node.allowedTools ?? []) {
          if (!permissionAllowsCapability(nodePermissions, capability)) {
            throw new Error(
              `Work node ${node.id} tool ${capability} is not permission-backed`,
            );
          }
        }
        const requiredCapabilities = node.requiredCapabilities ?? [];
        const uniqueRequiredCapabilities = new Set(requiredCapabilities);
        if (uniqueRequiredCapabilities.size !== requiredCapabilities.length) {
          throw new Error(
            `Work node ${node.id} required capabilities must be unique`,
          );
        }
        if (
          run.requestedMode !== "report_only" &&
          run.requestedMode !== "plan_only" &&
          requiredCapabilities.length === 0
        ) {
          throw new Error(
            `Executable work node ${node.id} requires at least one completion capability`,
          );
        }
        if (
          requiredCapabilities.some(
            (capability) => !(node.allowedTools ?? []).includes(capability),
          )
        ) {
          throw new Error(
            `Work node ${node.id} requires a capability outside its allowed tools`,
          );
        }
        if (
          (node.budgets?.maximumToolCalls ?? 0) <
          uniqueRequiredCapabilities.size
        ) {
          throw new Error(
            `Work node ${node.id} tool budget cannot satisfy its required capabilities`,
          );
        }
        if (
          uniqueRequiredCapabilities.has("subagent.spawn") &&
          (node.budgets?.maximumChildren ?? 0) < 1
        ) {
          throw new Error(
            `Work node ${node.id} requires a child budget for subagent.spawn`,
          );
        }
        for (const criterion of node.acceptanceCriteria ?? []) {
          if (!criteria.has(criterion)) {
            throw new Error(
              `Work node ${node.id} invents acceptance criterion ${criterion}`,
            );
          }
          if (scopedCriteria && !scopedCriteria.includes(criterion)) {
            throw new Error(
              `Scoped node ${node.id} exceeds its authorized criteria`,
            );
          }
          if (
            run.requestedMode === "analyze_and_fix" &&
            !this.analysisFixUnlocked(run.runId) &&
            correctionControl === null &&
            criterionStages.get(criterion) !== "diagnosis"
          ) {
            throw new Error(
              `Initial diagnosis node ${node.id} cannot claim completion criterion ${criterion}`,
            );
          }
          coveredCriteria.add(criterion);
        }
      }
      const initialDiagnosisCriteria = criterionRecords
        .filter((criterion) => criterion.stage === "diagnosis")
        .map((criterion) => criterion.id)
        .filter((id): id is string => typeof id === "string");
      const requiredPlanCriteria =
        scopedCriteria ??
        (run.requestedMode === "analyze_and_fix" &&
        !this.analysisFixUnlocked(run.runId)
          ? initialDiagnosisCriteria
          : [...criteria]);
      if (
        requiredPlanCriteria.length > 0 &&
        !requiredPlanCriteria.every((criterion) =>
          coveredCriteria.has(criterion),
        )
      ) {
        throw new Error(
          scopedCriteria
            ? "Scoped WorkPlan must cover every authorized criterion"
            : "WorkPlan must cover every TaskContract acceptance criterion",
        );
      }
      const requiredVerificationStage =
        run.requestedMode === "analyze_and_fix"
          ? correctionControl !== null || this.analysisFixUnlocked(run.runId)
            ? "completion"
            : "diagnosis"
          : null;
      const requiredVerifications = Array.isArray(
        contract.verificationRequirements,
      )
        ? (contract.verificationRequirements as Array<Record<string, unknown>>)
            .filter((requirement) => requirement.required === true)
            .filter(
              (requirement) =>
                requiredVerificationStage === null ||
                requirement.stage === requiredVerificationStage,
            )
        : [];
      const nodesById = new Map(nodes.map((node) => [node.id, node]));
      const ancestorIdsByNode = new Map<string, Set<string>>();
      for (const node of nodes) {
        const pending = [...node.dependsOn];
        const ancestors = new Set<string>();
        while (pending.length > 0) {
          const current = pending.pop()!;
          if (ancestors.has(current)) continue;
          ancestors.add(current);
          pending.push(...(nodesById.get(current)?.dependsOn ?? []));
        }
        ancestorIdsByNode.set(node.id, ancestors);
      }
      const mutatingNodes = nodes.filter((node) =>
        (node.allowedTools ?? []).some((capability) =>
          potentiallyMutatingPlanCapabilities.has(capability),
        ),
      );
      for (const requirement of requiredVerifications) {
        const capability = requirement.capability;
        const stage = requirement.stage;
        const verificationNodes =
          typeof capability === "string" &&
          typeof stage === "string" &&
          nodes.filter(
            (node) =>
              (node.requiredCapabilities ?? []).includes(capability) &&
              (node.acceptanceCriteria ?? []).some(
                (criterion) => criterionStages.get(criterion) === stage,
              ),
          );
        if (!verificationNodes || verificationNodes.length === 0) {
          throw new Error(
            `Required verification ${String(requirement.id)} using ${String(capability)} is not scheduled by a same-stage WorkPlan node`,
          );
        }
        if (stage === "completion") {
          for (const verificationNode of verificationNodes) {
            for (const mutatingNode of mutatingNodes) {
              if (
                verificationNode.id !== mutatingNode.id &&
                !ancestorIdsByNode
                  .get(verificationNode.id)
                  ?.has(mutatingNode.id)
              ) {
                throw new Error(
                  `Completion verification ${String(requirement.id)} must run after mutating node ${mutatingNode.id}`,
                );
              }
            }
          }
        }
      }
      return;
    }

    if (submission.type === "WorkResult") {
      const progress = this.executionProgress(run.runId);
      const node = progress.pendingNode;
      if (!node) throw new Error("No dependency-ready work node remains");
      const nodePermissions = permissionSet(
        node.permissions,
        `Work node ${node.id} permissions`,
      );
      const actions = Array.isArray(body.actions)
        ? (body.actions as Array<Record<string, unknown>>)
        : [];
      const filesChanged = Array.isArray(body.filesChanged)
        ? (body.filesChanged as Array<Record<string, unknown>>)
        : [];
      const toolEventRefs = stringArray(body.toolEventRefs);
      const maximumToolCalls = node.budgets?.maximumToolCalls ?? 0;
      if (
        actions.length > maximumToolCalls ||
        toolEventRefs.length > maximumToolCalls
      ) {
        throw new Error(
          `WorkResult exceeds node ${node.id} maximumToolCalls budget`,
        );
      }
      const nonMutatingMode =
        ["report_only", "plan_only", "analyze_only"].includes(
          run.requestedMode,
        ) ||
        (run.requestedMode === "analyze_and_fix" &&
          !this.analysisFixUnlocked(run.runId));
      const policies = [
        policyForMode(run.requestedMode),
        policyFromPermissionSet(`work_node:${node.id}`, nodePermissions),
      ];
      const permissionPolicyRefs = [
        this.latestRef(run.runId, "TaskContract"),
        this.latestRef(run.runId, "WorkPlan"),
      ];
      if (
        nonMutatingMode &&
        (filesChanged.length > 0 ||
          actions.some(
            (action) =>
              action.mutating === true &&
              (action.status === "completed" || action.status === "failed"),
          ))
      ) {
        const attemptedMutation = actions.find(
          (action) =>
            action.mutating === true &&
            (action.status === "completed" || action.status === "failed"),
        );
        const changedFile = filesChanged[0];
        const deniedAction =
          attemptedMutation ??
          (changedFile
            ? {
                capability:
                  changedFile.changeType === "deleted"
                    ? "repository.delete"
                    : "repository.write",
                target: changedFile.path,
              }
            : { capability: "repository.write", target: "unspecified" });
        const summary = `Denied: ${run.requestedMode} is non-mutating at the current workflow stage.`;
        throw new PermissionAuthorizationError(
          `${run.requestedMode} cannot accept mutating work`,
          tracePermissionDecision(
            deniedAction,
            false,
            permissionPolicyRefs,
            summary,
          ),
          permissionPolicyRefs,
        );
      }
      for (const action of actions) {
        if (typeof action.capability !== "string") {
          throw new Error("WorkResult action capability is invalid");
        }
        const kind = actionKindForCapability(action.capability);
        if (!kind) {
          throw new Error(
            `WorkResult action uses unknown capability ${action.capability}`,
          );
        }
        const attempted =
          action.status === "completed" || action.status === "failed";
        const permissionChecked = attempted || action.status === "denied";
        if (
          permissionChecked &&
          action.capability === "shell.inspect" &&
          (typeof action.target !== "string" ||
            !shellInspectionTargetIsSafe(action.target))
        ) {
          const summary =
            "Denied: shell.inspect accepts only typed read-only inspection targets.";
          if (action.status === "denied") continue;
          throw new PermissionAuthorizationError(
            "WorkResult shell inspection target is not a typed read-only inspection",
            tracePermissionDecision(
              action,
              false,
              permissionPolicyRefs,
              summary,
            ),
            permissionPolicyRefs,
          );
        }
        if (
          permissionChecked &&
          !(node.allowedTools ?? []).includes(action.capability)
        ) {
          const summary = `Denied: capability is outside work node ${node.id}.`;
          if (action.status === "denied") continue;
          throw new PermissionAuthorizationError(
            `WorkResult action uses a capability outside node ${node.id}`,
            tracePermissionDecision(
              action,
              false,
              permissionPolicyRefs,
              summary,
            ),
            permissionPolicyRefs,
          );
        }
        if (permissionChecked) {
          const decision = authorizeAction(
            {
              kind,
              ...(typeof action.target === "string"
                ? { target: action.target }
                : {}),
            },
            policies,
            run.repositoryRoot,
          );
          if (action.status === "denied") {
            if (decision.allowed) {
              throw new Error(
                "WorkResult cannot claim a permission denial for an authorized action",
              );
            }
            continue;
          }
          if (!decision.allowed) {
            throw new PermissionAuthorizationError(
              `WorkResult action target is outside node ${node.id} permissions: ${decision.summary}`,
              tracePermissionDecision(
                action,
                false,
                permissionPolicyRefs,
                decision.summary,
              ),
              permissionPolicyRefs,
            );
          }
          if (
            alwaysMutatingCapabilities.has(action.capability) &&
            action.mutating !== true
          ) {
            throw new Error(
              `WorkResult action ${action.capability} must be marked mutating`,
            );
          }
          if (
            alwaysReadOnlyCapabilities.has(action.capability) &&
            action.mutating !== false
          ) {
            throw new Error(
              `WorkResult action ${action.capability} must be marked non-mutating`,
            );
          }
        }
      }
      const completedChildren = actions.filter(
        (action) =>
          action.capability === "subagent.spawn" &&
          action.status === "completed",
      ).length;
      const maximumChildren = Math.min(
        node.budgets?.maximumChildren ?? 0,
        nodePermissions.subagents.maximumChildren,
      );
      if (completedChildren > maximumChildren) {
        throw new Error(`WorkResult exceeds node ${node.id} child budget`);
      }
      for (const change of filesChanged) {
        if (typeof change.path !== "string") {
          throw new Error("WorkResult file change path is invalid");
        }
        const capability =
          change.changeType === "deleted"
            ? "repository.delete"
            : "repository.write";
        const kind = actionKindForCapability(capability)!;
        const decision = authorizeAction(
          { kind, target: change.path },
          policies,
          run.repositoryRoot,
        );
        if (!decision.allowed) {
          const syntheticAction = {
            capability,
            target: change.path,
          };
          throw new PermissionAuthorizationError(
            `WorkResult file change is outside node ${node.id} permissions: ${change.path}`,
            tracePermissionDecision(
              syntheticAction,
              false,
              permissionPolicyRefs,
              decision.summary,
            ),
            permissionPolicyRefs,
          );
        }
        const matchingAction = actions.some(
          (action) =>
            action.capability === capability &&
            action.target === change.path &&
            action.status === "completed" &&
            action.mutating === true,
        );
        if (!matchingAction) {
          throw new Error(
            `WorkResult file change lacks a matching completed ${capability} action: ${change.path}`,
          );
        }
      }
      const assigned = new Set(node.acceptanceCriteria ?? []);
      const coverage = Array.isArray(body.acceptanceCoverage)
        ? (body.acceptanceCoverage as Array<Record<string, unknown>>)
        : [];
      for (const item of coverage) {
        if (
          typeof item.criterionId !== "string" ||
          !assigned.has(item.criterionId)
        ) {
          throw new Error(
            "WorkResult acceptance coverage is outside its WorkPlan node",
          );
        }
      }
      const coverageIds = coverage
        .map((item) => item.criterionId)
        .filter(
          (criterion): criterion is string => typeof criterion === "string",
        );
      if (new Set(coverageIds).size !== coverageIds.length) {
        throw new Error(
          "WorkResult acceptance criteria must not be duplicated",
        );
      }
      for (const action of actions) {
        if (
          action.status === "completed" &&
          (action.capability === "repository.write" ||
            action.capability === "repository.delete") &&
          !filesChanged.some(
            (change) =>
              change.path === action.target &&
              (action.capability === "repository.delete"
                ? change.changeType === "deleted"
                : change.changeType !== "deleted"),
          )
        ) {
          throw new Error(
            `Completed ${String(action.capability)} action lacks an exact FileChange`,
          );
        }
      }
      if (body.status === "completed") {
        const finalMutatingActionIndex = actions.findLastIndex(
          (action) => action.status === "completed" && action.mutating === true,
        );
        if (finalMutatingActionIndex >= 0) {
          const contract = this.latestBody(run.runId, "TaskContract")!;
          const completionCriterionIds = new Set(
            Array.isArray(contract.acceptanceCriteria)
              ? contract.acceptanceCriteria
                  .filter(
                    (criterion): criterion is Record<string, unknown> =>
                      typeof criterion === "object" && criterion !== null,
                  )
                  .filter((criterion) => criterion.stage === "completion")
                  .map((criterion) => criterion.id)
                  .filter((id): id is string => typeof id === "string")
              : [],
          );
          const nodeOwnsCompletion = (node.acceptanceCriteria ?? []).some(
            (criterion) => completionCriterionIds.has(criterion),
          );
          const completionVerifications = Array.isArray(
            contract.verificationRequirements,
          )
            ? (
                contract.verificationRequirements as Array<
                  Record<string, unknown>
                >
              ).filter(
                (requirement) =>
                  requirement.required === true &&
                  requirement.stage === "completion" &&
                  typeof requirement.capability === "string" &&
                  nodeOwnsCompletion &&
                  (node.requiredCapabilities ?? []).includes(
                    requirement.capability,
                  ),
              )
            : [];
          for (const requirement of completionVerifications) {
            const verificationActionIndex = actions.findIndex(
              (action, index) =>
                index > finalMutatingActionIndex &&
                action.capability === requirement.capability &&
                action.status === "completed" &&
                action.mutating === false,
            );
            if (verificationActionIndex < 0) {
              throw new Error(
                `Completion verification ${String(requirement.id)} must run after the final mutating action`,
              );
            }
          }
        }
        for (const capability of node.requiredCapabilities ?? []) {
          if (
            !actions.some(
              (action) =>
                action.capability === capability &&
                action.status === "completed",
            )
          ) {
            throw new Error(
              `Completed WorkResult is missing required capability ${capability}`,
            );
          }
        }
        if (!equalStringSets(coverageIds, [...assigned])) {
          throw new Error(
            "Completed WorkResult must cover every assigned criterion exactly once",
          );
        }
        if (
          actions.some(
            (action) =>
              action.status === "failed" || action.status === "denied",
          )
        ) {
          throw new Error(
            "Completed WorkResult cannot include failed or denied actions",
          );
        }
        const testResults = Array.isArray(body.testResults)
          ? (body.testResults as Array<Record<string, unknown>>)
          : [];
        if (testResults.some((test) => test.status === "failed")) {
          throw new Error("Completed WorkResult cannot include failed tests");
        }
        if (coverage.some((item) => item.status !== "pass")) {
          throw new Error(
            "Completed WorkResult requires every assigned acceptance criterion to pass",
          );
        }
      }
      this.assertEvidenceSemantics(submission);
      return;
    }

    if (submission.type === "QualityReview") {
      if (
        body.remainingRemediations !==
        run.budgets.postExecutionRemediationsRemaining
      ) {
        throw new Error(
          "QualityReview remainingRemediations must match the controller budget",
        );
      }
      const contractRef = this.latestRef(run.runId, "TaskContract");
      const planRef = this.latestRef(run.runId, "WorkPlan");
      if (body.taskContractRef !== contractRef) {
        throw new Error("QualityReview must use the current TaskContract");
      }
      if (!stringArray(body.workPlanRefs).includes(planRef)) {
        throw new Error("QualityReview must include the current WorkPlan");
      }
      const expectedResults = this.workResultRefsForPlan(run.runId, planRef);
      if (!equalStringSets(stringArray(body.workResultRefs), expectedResults)) {
        throw new Error(
          "QualityReview WorkResult lineage is incomplete or stale",
        );
      }
      const currentPlan = this.latestBody(run.runId, "WorkPlan")!;
      const currentPlanAssignedCriteria = new Set(
        Array.isArray(currentPlan.nodes)
          ? currentPlan.nodes.flatMap((node) =>
              typeof node === "object" && node !== null
                ? stringArray(
                    (node as { acceptanceCriteria?: unknown })
                      .acceptanceCriteria,
                  )
                : [],
            )
          : [],
      );
      const currentWorkResults = expectedResults
        .map((reference) => artifactIdFromUri(reference))
        .map((artifactId) =>
          artifactId
            ? this.ledger.getArtifact(run.runId, artifactId)?.body
            : null,
        )
        .filter(
          (result): result is Record<string, unknown> =>
            typeof result === "object" && result !== null,
        );
      if (
        run.requestedMode !== "plan_only" &&
        run.requestedMode !== "report_only" &&
        (body.decision === "pass" || body.decision === "proceed_to_fix")
      ) {
        const plannedNodeIds = Array.isArray(currentPlan.nodes)
          ? currentPlan.nodes
              .map((node) =>
                typeof node === "object" && node !== null
                  ? (node as { id?: unknown }).id
                  : undefined,
              )
              .filter((id): id is string => typeof id === "string")
          : [];
        const completedNodeIds = expectedResults
          .map((reference) => artifactIdFromUri(reference))
          .map((artifactId) =>
            artifactId
              ? this.ledger.getArtifact(run.runId, artifactId)?.body
              : null,
          )
          .filter(
            (result): result is Record<string, unknown> =>
              typeof result === "object" && result !== null,
          )
          .filter((result) => result.status === "completed")
          .map((result) => result.nodeId)
          .filter((nodeId): nodeId is string => typeof nodeId === "string");
        if (!equalStringSets(completedNodeIds, plannedNodeIds)) {
          throw new Error(
            "Passing QualityReview requires every planned node to complete",
          );
        }
      }
      if (
        body.decision === "pass" &&
        (run.requestedMode === "fix_only" ||
          (run.requestedMode === "analyze_and_fix" &&
            this.analysisFixUnlocked(run.runId)))
      ) {
        const completedMutation = this.ledger
          .listArtifacts(run.runId)
          .filter((artifact) => artifact.type === "WorkResult")
          .map(
            (artifact) => this.ledger.getArtifact(run.runId, artifact.id)?.body,
          )
          .some(
            (result) =>
              typeof result === "object" &&
              result !== null &&
              Array.isArray((result as { actions?: unknown }).actions) &&
              (
                result as { actions: Array<Record<string, unknown>> }
              ).actions.some(
                (action) =>
                  action.status === "completed" && action.mutating === true,
              ),
          );
        if (!completedMutation) {
          throw new Error(
            "A passing fix review requires at least one completed mutating action",
          );
        }
      }
      const contract = this.latestBody(run.runId, "TaskContract")!;
      const fixUnlockedBeforeReview = this.analysisFixUnlocked(run.runId);
      const criterionRecords = Array.isArray(contract.acceptanceCriteria)
        ? contract.acceptanceCriteria.filter(
            (criterion): criterion is Record<string, unknown> =>
              typeof criterion === "object" && criterion !== null,
          )
        : [];
      const expectedCriteria = criterionRecords
        .map((criterion) => criterion.id)
        .filter((id): id is string => typeof id === "string");
      const expectedReviewCriteria =
        run.requestedMode === "analyze_and_fix" && !fixUnlockedBeforeReview
          ? criterionRecords
              .filter((criterion) => criterion.stage === "diagnosis")
              .map((criterion) => criterion.id)
              .filter((id): id is string => typeof id === "string")
          : expectedCriteria;
      const reviewedCriteria = Array.isArray(body.acceptanceResults)
        ? body.acceptanceResults
            .map((result) =>
              typeof result === "object" && result !== null
                ? (result as { criterionId?: unknown }).criterionId
                : undefined,
            )
            .filter((id): id is string => typeof id === "string")
        : [];
      if (!equalStringSets(reviewedCriteria, expectedReviewCriteria)) {
        throw new Error(
          "QualityReview must cover every criterion for the current workflow stage exactly once",
        );
      }
      if (
        run.requestedMode !== "plan_only" &&
        run.requestedMode !== "report_only"
      ) {
        const acceptanceResults = Array.isArray(body.acceptanceResults)
          ? (body.acceptanceResults as Array<Record<string, unknown>>)
          : [];
        const priorQualityReviews = this.ledger
          .listArtifacts(run.runId)
          .filter((artifact) => artifact.type === "QualityReview")
          .map(
            (artifact) => this.ledger.getArtifact(run.runId, artifact.id)?.body,
          )
          .filter(
            (review): review is Record<string, unknown> =>
              typeof review === "object" && review !== null,
          );
        for (const result of acceptanceResults.filter(
          (candidate) => candidate.status === "pass",
        )) {
          const criterionId = result.criterionId;
          const evidenceRefs = stringArray(result.evidenceRefs);
          const currentCoverage = currentWorkResults.some((workResult) =>
            Array.isArray(workResult.acceptanceCoverage)
              ? (
                  workResult.acceptanceCoverage as Array<
                    Record<string, unknown>
                  >
                ).some(
                  (coverage) =>
                    coverage.criterionId === criterionId &&
                    coverage.status === "pass" &&
                    equalStringSets(
                      stringArray(coverage.evidenceRefs),
                      evidenceRefs,
                    ),
                )
              : false,
          );
          const retainedPriorCoverage =
            typeof criterionId === "string" &&
            !currentPlanAssignedCriteria.has(criterionId) &&
            priorQualityReviews.some((review) =>
              Array.isArray(review.acceptanceResults)
                ? (
                    review.acceptanceResults as Array<Record<string, unknown>>
                  ).some(
                    (prior) =>
                      prior.criterionId === criterionId &&
                      prior.status === "pass" &&
                      equalStringSets(
                        stringArray(prior.evidenceRefs),
                        evidenceRefs,
                      ),
                  )
                : false,
            );
          if (!currentCoverage && !retainedPriorCoverage) {
            throw new Error(
              `Passed acceptance criterion ${String(criterionId)} lacks matching WorkResult coverage`,
            );
          }
        }
      }
      const ruleRefs = stringArray(contract.ruleRefs);
      const ruleResults = Array.isArray(body.ruleCompliance)
        ? (body.ruleCompliance as Array<Record<string, unknown>>)
        : [];
      const reviewedRuleRefs = ruleResults
        .map((result) => result.subjectRef)
        .filter(
          (reference): reference is string => typeof reference === "string",
        );
      if (!equalStringSets(reviewedRuleRefs, ruleRefs)) {
        throw new Error(
          "QualityReview must cover every TaskContract rule exactly once",
        );
      }
      const allVerificationRequirements = Array.isArray(
        contract.verificationRequirements,
      )
        ? (contract.verificationRequirements as Array<Record<string, unknown>>)
        : [];
      const verificationRequirements =
        run.requestedMode === "analyze_and_fix" && !fixUnlockedBeforeReview
          ? allVerificationRequirements.filter(
              (requirement) => requirement.stage === "diagnosis",
            )
          : allVerificationRequirements;
      const verificationResults = Array.isArray(body.verificationResults)
        ? (body.verificationResults as Array<Record<string, unknown>>)
        : [];
      const verificationIds = verificationResults
        .map((result) => result.requirementId)
        .filter((id): id is string => typeof id === "string");
      const expectedVerificationIds = verificationRequirements
        .map((requirement) => requirement.id)
        .filter((id): id is string => typeof id === "string");
      if (!equalStringSets(verificationIds, expectedVerificationIds)) {
        throw new Error(
          "QualityReview must cover every verification requirement exactly once",
        );
      }
      for (const requirement of verificationRequirements) {
        const result = verificationResults.find(
          (candidate) => candidate.requirementId === requirement.id,
        );
        if (!result || result.capability !== requirement.capability) {
          throw new Error(
            `Verification result ${String(requirement.id)} must use its contracted capability`,
          );
        }
        if (
          requirement.required === true &&
          (body.decision === "pass" || body.decision === "proceed_to_fix") &&
          result.status !== "pass"
        ) {
          throw new Error(
            `Required verification ${String(requirement.id)} must pass before progression`,
          );
        }
        if (
          result.status === "pass" &&
          run.requestedMode !== "plan_only" &&
          run.requestedMode !== "report_only"
        ) {
          const verificationEvidence = new Set(
            stringArray(result.evidenceRefs),
          );
          const retainedDiagnosis =
            requirement.stage === "diagnosis" &&
            fixUnlockedBeforeReview &&
            [...this.ledger.listArtifacts(run.runId)]
              .reverse()
              .filter((artifact) => artifact.type === "QualityReview")
              .map(
                (artifact) =>
                  this.ledger.getArtifact(run.runId, artifact.id)?.body,
              )
              .filter(
                (review): review is Record<string, unknown> =>
                  typeof review === "object" &&
                  review !== null &&
                  "decision" in review &&
                  review.decision === "proceed_to_fix",
              )
              .some((review) => {
                const priorResults = Array.isArray(review.verificationResults)
                  ? (review.verificationResults as Array<
                      Record<string, unknown>
                    >)
                  : [];
                return priorResults.some(
                  (prior) =>
                    prior.requirementId === requirement.id &&
                    prior.capability === requirement.capability &&
                    prior.status === "pass" &&
                    equalStringSets(
                      stringArray(prior.evidenceRefs),
                      stringArray(result.evidenceRefs),
                    ),
                );
              });
          const stageCriterionIds = new Set(
            criterionRecords
              .filter((criterion) => criterion.stage === requirement.stage)
              .map((criterion) => criterion.id)
              .filter((id): id is string => typeof id === "string"),
          );
          const eligibleNodeIds = new Set(
            Array.isArray(currentPlan.nodes)
              ? currentPlan.nodes
                  .filter(
                    (node): node is Record<string, unknown> =>
                      typeof node === "object" && node !== null,
                  )
                  .filter((node) =>
                    stringArray(node.requiredCapabilities).includes(
                      String(requirement.capability),
                    ),
                  )
                  .filter((node) =>
                    stringArray(node.acceptanceCriteria).some((criterion) =>
                      stageCriterionIds.has(criterion),
                    ),
                  )
                  .map((node) => node.id)
                  .filter((id): id is string => typeof id === "string")
              : [],
          );
          const capabilityObserved =
            retainedDiagnosis ||
            expectedResults
              .map((reference) => artifactIdFromUri(reference))
              .map((artifactId) =>
                artifactId
                  ? this.ledger.getArtifact(run.runId, artifactId)?.body
                  : null,
              )
              .some((workResult) => {
                if (
                  typeof workResult !== "object" ||
                  workResult === null ||
                  !Array.isArray((workResult as { actions?: unknown }).actions)
                ) {
                  return false;
                }
                const workResultRecord = workResult as Record<string, unknown>;
                if (
                  typeof workResultRecord.nodeId !== "string" ||
                  !eligibleNodeIds.has(workResultRecord.nodeId)
                ) {
                  return false;
                }
                const actions = (
                  workResultRecord as {
                    actions: Array<Record<string, unknown>>;
                  }
                ).actions;
                const finalMutatingActionIndex = actions.findLastIndex(
                  (action) =>
                    action.status === "completed" && action.mutating === true,
                );
                return actions.some(
                  (action, index) =>
                    action.capability === requirement.capability &&
                    action.status === "completed" &&
                    action.mutating === false &&
                    (requirement.stage !== "completion" ||
                      finalMutatingActionIndex < 0 ||
                      index > finalMutatingActionIndex) &&
                    stringArray(action.evidenceRefs).some((reference) =>
                      verificationEvidence.has(reference),
                    ),
                );
              });
          if (!capabilityObserved) {
            throw new Error(
              `Passed verification ${String(requirement.id)} lacks a completed capability action`,
            );
          }
        }
      }
      const contractPermissions = permissionSet(
        contract.permissions,
        "TaskContract permissions",
      );
      if (body.decision === "proceed_to_fix") {
        const gate =
          typeof body.diagnosisGate === "object" && body.diagnosisGate !== null
            ? (body.diagnosisGate as Record<string, unknown>)
            : null;
        this.assertScopedWorkOrder(gate?.correctionWorkOrder, {
          label: "Diagnosis correction work order",
          criterionField: "targetCriterionIds",
          allowedCriteria: criterionRecords
            .filter((criterion) => criterion.stage === "completion")
            .map((criterion) => criterion.id)
            .filter((id): id is string => typeof id === "string"),
          contractPermissions,
          authorizedPermissions: authorized,
          eligibleSourceRefs: new Set(stringArray(gate?.directEvidenceRefs)),
          requireAllCriteria: true,
          requireExecutableCapability: true,
        });
      }
      if (body.decision === "remediate") {
        const diagnosisCriteria = criterionRecords
          .filter((criterion) => criterion.stage === "diagnosis")
          .map((criterion) => criterion.id)
          .filter((id): id is string => typeof id === "string");
        this.assertScopedWorkOrder(body.remediationWorkOrder, {
          label: "Quality remediation work order",
          criterionField: "failedCriterionIds",
          allowedCriteria:
            run.requestedMode === "analyze_and_fix" && !fixUnlockedBeforeReview
              ? diagnosisCriteria
              : expectedCriteria,
          contractPermissions,
          authorizedPermissions:
            run.requestedMode === "analyze_and_fix" && !fixUnlockedBeforeReview
              ? explicitPermissionProjection("analyze_only", envelope)
              : authorized,
          eligibleSourceRefs: new Set([
            planRef,
            ...expectedResults,
            ...this.allArtifactRefs(run.runId, "Evidence"),
          ]),
          requireExecutableCapability:
            run.requestedMode !== "plan_only" &&
            run.requestedMode !== "report_only",
        });
      }
      const fixUnlocked = fixUnlockedBeforeReview;
      if (
        body.decision === "proceed_to_fix" &&
        (run.requestedMode !== "analyze_and_fix" || fixUnlocked)
      ) {
        throw new Error(
          "proceed_to_fix is legal only after the first analyze_and_fix diagnosis",
        );
      }
      if (
        run.requestedMode === "analyze_and_fix" &&
        !fixUnlocked &&
        body.decision === "pass"
      ) {
        throw new Error(
          "Analyze-and-fix diagnosis must pass through proceed_to_fix before release",
        );
      }
      this.assertEvidenceSemantics(submission);
      return;
    }

    if (submission.type === "ReleaseAudit") {
      if (
        body.remainingRemediations !==
        run.budgets.postExecutionRemediationsRemaining
      ) {
        throw new Error(
          "ReleaseAudit remainingRemediations must match the controller budget",
        );
      }
      const contractRef = this.latestRef(run.runId, "TaskContract");
      const planRef = this.latestRef(run.runId, "WorkPlan");
      const qualityRef = this.latestRef(run.runId, "QualityReview");
      const expectedResults = this.allArtifactRefs(run.runId, "WorkResult");
      const expectedPlans = this.allArtifactRefs(run.runId, "WorkPlan");
      if (
        body.originalRequestRef !== originalRequestRef ||
        body.taskContractRef !== contractRef ||
        body.qualityReviewRef !== qualityRef ||
        !equalStringSets(stringArray(body.workPlanRefs), expectedPlans) ||
        !equalStringSets(stringArray(body.workResultRefs), expectedResults)
      ) {
        throw new Error("ReleaseAudit lineage is incomplete or stale");
      }
      const fidelitySubjects = Array.isArray(body.userFidelity)
        ? (body.userFidelity as Array<Record<string, unknown>>)
            .map((check) => check.subjectRef)
            .filter(
              (reference): reference is string => typeof reference === "string",
            )
        : [];
      if (!equalStringSets(fidelitySubjects, [originalRequestRef])) {
        throw new Error(
          "ReleaseAudit user fidelity must cover the immutable original request exactly once",
        );
      }
      if (
        body.modeCompliance === "fail" &&
        body.decision !== "partial" &&
        body.decision !== "block"
      ) {
        throw new Error(
          "Failed mode compliance requires a partial or blocked release audit",
        );
      }
      const quality = this.latestBody(run.runId, "QualityReview")!;
      if (quality.decision === "block" && body.decision !== "block") {
        throw new Error(
          "A blocked QualityReview cannot be downgraded by the ReleaseAudit",
        );
      }
      if (body.decision === "release" && quality.decision !== "pass") {
        throw new Error("Release requires a passing current QualityReview");
      }
      if (
        body.decision === "release" &&
        (!Array.isArray(body.claimEvidenceMatrix) ||
          body.claimEvidenceMatrix.length === 0)
      ) {
        throw new Error("Release requires at least one audited claim");
      }
      const contract = this.latestBody(run.runId, "TaskContract")!;
      const expectedCriteria = Array.isArray(contract.acceptanceCriteria)
        ? contract.acceptanceCriteria
            .map((criterion) =>
              typeof criterion === "object" && criterion !== null
                ? (criterion as { id?: unknown }).id
                : undefined,
            )
            .filter((id): id is string => typeof id === "string")
        : [];
      const matrix = Array.isArray(body.claimEvidenceMatrix)
        ? (body.claimEvidenceMatrix as Array<Record<string, unknown>>)
        : [];
      const claimIds = matrix
        .map((entry) => entry.claimId)
        .filter((id): id is string => typeof id === "string");
      if (new Set(claimIds).size !== claimIds.length) {
        throw new Error("ReleaseAudit claim identifiers must be unique");
      }
      const coveredCriteria = matrix.flatMap((entry) =>
        stringArray(entry.criterionIds),
      );
      if (
        coveredCriteria.some(
          (criterion) => !expectedCriteria.includes(criterion),
        )
      ) {
        throw new Error("ReleaseAudit claim matrix invents contract criteria");
      }
      if (body.decision === "remediate") {
        this.assertScopedWorkOrder(body.remediationDefect, {
          label: "Release remediation defect",
          criterionField: "failedCriterionIds",
          allowedCriteria: expectedCriteria,
          contractPermissions: permissionSet(
            contract.permissions,
            "TaskContract permissions",
          ),
          authorizedPermissions: authorized,
          eligibleSourceRefs: new Set([
            qualityRef,
            ...expectedResults,
            ...this.allArtifactRefs(run.runId, "Evidence"),
          ]),
          requireExecutableCapability:
            run.requestedMode !== "plan_only" &&
            run.requestedMode !== "report_only",
        });
      }
      if (
        body.decision === "release" &&
        !expectedCriteria.every((criterion) =>
          matrix.some(
            (entry) =>
              entry.status === "supported" &&
              (run.requestedMode === "report_only" ||
                entry.basis === "direct") &&
              stringArray(entry.criterionIds).includes(criterion),
          ),
        )
      ) {
        throw new Error(
          "Released claim matrix must support every TaskContract criterion",
        );
      }
      this.assertEvidenceSemantics(submission);
      return;
    }

    if (submission.type === "UserReport") {
      if (body.traceRef !== `trace://${run.runId}`) {
        throw new Error(
          "UserReport traceRef must reference the aggregate trace for the current run",
        );
      }
      const expectedChangeRefs = [
        ...new Set(
          this.ledger
            .listArtifacts(run.runId)
            .filter((artifact) => artifact.type === "WorkResult")
            .flatMap((artifact) => {
              const result = this.ledger.getArtifact(
                run.runId,
                artifact.id,
              )?.body;
              return typeof result === "object" &&
                result !== null &&
                "filesChanged" in result &&
                Array.isArray(result.filesChanged)
                ? result.filesChanged
                    .map((change) =>
                      typeof change === "object" &&
                      change !== null &&
                      "diffRef" in change &&
                      typeof change.diffRef === "string"
                        ? change.diffRef
                        : null,
                    )
                    .filter(
                      (reference): reference is string => reference !== null,
                    )
                : [];
            }),
        ),
      ];
      if (!equalStringSets(stringArray(body.changeRefs), expectedChangeRefs)) {
        throw new Error(
          "UserReport changeRefs must retain every accepted WorkResult diff exactly once",
        );
      }
      const audit = this.latestBody(run.runId, "ReleaseAudit", false);
      if (!audit) {
        const promptReviewRecord = this.ledger.findLatestArtifact(
          run.runId,
          "PromptReview",
        );
        const clarificationRecord = this.ledger.findLatestArtifact(
          run.runId,
          "ClarificationRequest",
        );
        const controllingRef = promptReviewRecord
          ? `artifact://${run.runId}/${promptReviewRecord.id}`
          : clarificationRecord
            ? `artifact://${run.runId}/${clarificationRecord.id}`
            : null;
        if (
          run.phase !== "agent_5_report" ||
          run.outcomeHint !== "blocked" ||
          body.terminalStatus !== "blocked" ||
          body.permissionsHonored !== true ||
          controllingRef === null ||
          !stringArray(body.findingRefs).includes(controllingRef) ||
          (Array.isArray(body.completionClaims) &&
            body.completionClaims.length > 0)
        ) {
          throw new Error(
            "A pre-execution blocked run requires an honest blocked UserReport",
          );
        }
        return;
      }
      const expectedRef = `artifact://${run.runId}/${submission.id}`;
      if (audit.userReportRef !== expectedRef) {
        throw new Error(
          "UserReport does not match the ReleaseAudit forward reference",
        );
      }
      const expectedPermissionsHonored = audit.modeCompliance === "pass";
      if (body.permissionsHonored !== expectedPermissionsHonored) {
        throw new Error(
          "UserReport permissionsHonored must match the ReleaseAudit mode-compliance result",
        );
      }
      if (
        body.terminalStatus === "completed" &&
        (!Array.isArray(body.completionClaims) ||
          body.completionClaims.length === 0)
      ) {
        throw new Error(
          "Completed UserReport requires at least one completion claim",
        );
      }
      const contract = this.latestBody(run.runId, "TaskContract")!;
      const quality = this.latestBody(run.runId, "QualityReview")!;
      if (
        body.terminalStatus !== "completed" &&
        !stringArray(body.findingRefs).some((reference) =>
          [
            this.latestRef(run.runId, "QualityReview"),
            this.latestRef(run.runId, "ReleaseAudit"),
          ].includes(reference),
        )
      ) {
        throw new Error(
          "Non-completed UserReport must cite its controlling quality review or release audit",
        );
      }
      const requiredVerificationIds = Array.isArray(
        contract.verificationRequirements,
      )
        ? contract.verificationRequirements
            .filter(
              (requirement) =>
                typeof requirement === "object" &&
                requirement !== null &&
                (requirement as { required?: unknown }).required === true,
            )
            .map((requirement) => (requirement as { id?: unknown }).id)
            .filter((id): id is string => typeof id === "string")
        : [];
      const verificationResults = Array.isArray(quality.verificationResults)
        ? (quality.verificationResults as Array<Record<string, unknown>>)
        : [];
      const requiredVerificationResults = requiredVerificationIds.map((id) =>
        verificationResults.find((result) => result.requirementId === id),
      );
      if (
        body.terminalStatus === "completed" &&
        (requiredVerificationResults.some(
          (result) => !result || result.status !== "pass",
        ) ||
          !equalStringSets(stringArray(body.verificationRefs), [
            ...new Set(
              requiredVerificationResults.flatMap((result) =>
                result ? stringArray(result.evidenceRefs) : [],
              ),
            ),
          ]))
      ) {
        throw new Error(
          "Completed UserReport must retain every passed required verification",
        );
      }
      if (
        body.terminalStatus === "failed_verification" &&
        requiredVerificationResults.every((result) => result?.status === "pass")
      ) {
        throw new Error(
          "failed_verification requires an incomplete required verification",
        );
      }
      const requiredStatuses =
        audit.decision === "release"
          ? ["completed"]
          : audit.decision === "partial"
            ? ["partial", "failed_verification"]
            : audit.decision === "block"
              ? ["blocked"]
              : [];
      if (
        requiredStatuses.length > 0 &&
        !requiredStatuses.includes(String(body.terminalStatus))
      ) {
        throw new Error(
          `UserReport terminalStatus must be ${requiredStatuses.join(" or ")} after ${String(audit.decision)}`,
        );
      }
      const matrix = Array.isArray(audit.claimEvidenceMatrix)
        ? (audit.claimEvidenceMatrix as Array<Record<string, unknown>>)
        : [];
      const completionClaims = Array.isArray(body.completionClaims)
        ? (body.completionClaims as Array<Record<string, unknown>>)
        : [];
      for (const claim of completionClaims) {
        const reviewed = matrix.find(
          (entry) =>
            entry.claimId === claim.id &&
            entry.claim === claim.text &&
            entry.status === "supported" &&
            (entry.basis !== "user_reported" ||
              claim.status === "user_reported") &&
            (entry.basis !== "direct" || claim.status !== "user_reported"),
        );
        if (
          !reviewed ||
          !equalStringSets(
            stringArray(claim.evidenceRefs),
            stringArray(reviewed.evidenceRefs),
          )
        ) {
          throw new Error(
            "UserReport completion claim was not approved by the ReleaseAudit evidence matrix",
          );
        }
      }
      if (
        audit.decision === "release" &&
        !equalStringSets(
          completionClaims
            .map((claim) => claim.id)
            .filter((id): id is string => typeof id === "string"),
          matrix
            .filter((entry) => entry.status === "supported")
            .map((entry) => entry.claimId)
            .filter((id): id is string => typeof id === "string"),
        )
      ) {
        throw new Error(
          "Released UserReport must include every supported audited claim exactly once",
        );
      }
      this.assertEvidenceSemantics(submission);
    }
  }

  private executionProgress(
    runId: string,
    candidateResult?: Record<string, unknown>,
  ): {
    pendingNode: WorkNodeProjection | null;
    remainingAfterSubmission: number;
  } {
    const planRecord = this.ledger.findLatestArtifact(runId, "WorkPlan");
    if (!planRecord) throw new Error("Executor phase is missing its WorkPlan");
    const planArtifact = this.ledger.getArtifact(runId, planRecord.id);
    const plan = planArtifact?.body as WorkPlanProjection | undefined;
    if (!plan || !Array.isArray(plan.nodes) || plan.nodes.length === 0) {
      throw new Error("Latest WorkPlan has no executable nodes");
    }
    const planRef = `artifact://${runId}/${planRecord.id}`;
    const completed = new Set<string>();
    const unsuccessful = new Set<string>();
    for (const record of this.ledger
      .listArtifacts(runId)
      .filter((artifact) => artifact.type === "WorkResult")) {
      const result = this.ledger.getArtifact(runId, record.id)?.body;
      if (
        typeof result === "object" &&
        result !== null &&
        (result as { workPlanRef?: unknown }).workPlanRef === planRef &&
        typeof (result as { nodeId?: unknown }).nodeId === "string" &&
        typeof (result as { status?: unknown }).status === "string"
      ) {
        const projected = result as { nodeId: string; status: string };
        if (projected.status === "completed") completed.add(projected.nodeId);
        else unsuccessful.add(projected.nodeId);
      }
    }
    const pendingNode =
      plan.nodes.find(
        (node) =>
          !completed.has(node.id) &&
          !unsuccessful.has(node.id) &&
          node.dependsOn.every((dependency) => completed.has(dependency)),
      ) ?? null;

    if (candidateResult) {
      if (candidateResult.workPlanRef !== planRef) {
        throw new Error("WorkResult must reference the current WorkPlan");
      }
      if (!pendingNode) {
        throw new Error("No dependency-ready WorkPlan node remains");
      }
      if (candidateResult.nodeId !== pendingNode.id) {
        throw new Error(
          `WorkResult must complete dependency-ready node ${pendingNode.id}`,
        );
      }
      if (candidateResult.status === "completed") completed.add(pendingNode.id);
      else unsuccessful.add(pendingNode.id);
    }

    return {
      pendingNode,
      remainingAfterSubmission:
        candidateResult && candidateResult.status !== "completed"
          ? 0
          : plan.nodes.filter((node) => !completed.has(node.id)).length,
    };
  }

  private assertEvidenceSemantics(
    submission: ArtifactSubmission & { body: Record<string, unknown> },
  ): void {
    for (const reference of collectArtifactReferences(submission.body)) {
      if (
        !reference.ref.startsWith("artifact://") ||
        !requiresDirectEvidence(reference.path, submission.type)
      ) {
        continue;
      }
      const artifactId = artifactIdFromUri(reference.ref);
      if (!artifactId) continue;
      const artifact = this.ledger.getArtifact(submission.runId, artifactId);
      if (!artifact) continue;
      if (artifact.type === "ContextDocument") {
        const groundingClaim =
          submission.type === "WorkResult" &&
          (/^body\.observations\[\d+\]\.evidenceRefs\[\d+\]$/u.test(
            reference.path,
          ) ||
            /^body\.inferences\[\d+\]\.evidenceRefs\[\d+\]$/u.test(
              reference.path,
            ));
        if (!groundingClaim) {
          throw new Error(
            `ContextDocument cannot prove an executed outcome at ${reference.path}`,
          );
        }
        continue;
      }
      if (artifact.type !== "Evidence") continue;
      const evidenceBody = artifact.body;
      if (
        typeof evidenceBody !== "object" ||
        evidenceBody === null ||
        !("kind" in evidenceBody) ||
        typeof evidenceBody.kind !== "string"
      ) {
        throw new Error(`Evidence kind is missing at ${reference.path}`);
      }
      let allowedKinds: ReadonlySet<string> | null = null;
      if (/\.filesChanged\[\d+\]\.diffRef$/u.test(reference.path)) {
        allowedKinds = new Set(["diff"]);
      } else if (/\.testResults\[\d+\]\.outputRef$/u.test(reference.path)) {
        allowedKinds = new Set(["test", "tool_output", "log"]);
      } else if (/\.testResults\[\d+\]\.commandRef$/u.test(reference.path)) {
        allowedKinds = new Set(["tool_output", "log"]);
      } else {
        const actionMatch =
          /^body\.actions\[(\d+)\]\.evidenceRefs\[\d+\]$/u.exec(reference.path);
        const verificationMatch =
          /^body\.verificationResults\[(\d+)\]\.evidenceRefs\[\d+\]$/u.exec(
            reference.path,
          );
        if (actionMatch) {
          const actions = Array.isArray(submission.body.actions)
            ? (submission.body.actions as Array<Record<string, unknown>>)
            : [];
          allowedKinds = evidenceKindsForCapability(
            String(actions[Number(actionMatch[1])]?.capability ?? ""),
          );
        } else if (verificationMatch) {
          const results = Array.isArray(submission.body.verificationResults)
            ? (submission.body.verificationResults as Array<
                Record<string, unknown>
              >)
            : [];
          allowedKinds = evidenceKindsForCapability(
            String(results[Number(verificationMatch[1])]?.capability ?? ""),
          );
        }
      }
      if (allowedKinds && !allowedKinds.has(evidenceBody.kind)) {
        throw new Error(
          `Evidence kind ${evidenceBody.kind} is incompatible with ${reference.path}`,
        );
      }
    }
  }

  private pendingClarificationLineage(runId: string): string[] | null {
    const artifacts = this.ledger.listArtifacts(runId);
    const clarificationIds = new Set(
      artifacts
        .filter((artifact) => artifact.type === "ClarificationRequest")
        .map((artifact) => artifact.id),
    );
    const answer = [...artifacts].reverse().find(
      (artifact) =>
        artifact.type === "UserMessage" &&
        artifact.sourceRefs.some((reference) => {
          const id = artifactIdFromUri(reference);
          return id !== null && clarificationIds.has(id);
        }),
    );
    if (!answer) return null;
    const requestRef = answer.sourceRefs.find((reference) => {
      const id = artifactIdFromUri(reference);
      return id !== null && clarificationIds.has(id);
    });
    if (!requestRef) return null;
    const answerRef = `artifact://${runId}/${answer.id}`;
    const consumed = artifacts.some(
      (artifact) =>
        [
          "ContextManifest",
          "ProblemFrame",
          "TaskContract",
          "PromptReview",
          "WorkPlan",
          "WorkResult",
          "QualityReview",
        ].includes(artifact.type) &&
        artifact.id !== answer.id &&
        artifact.sourceRefs.includes(requestRef) &&
        artifact.sourceRefs.includes(answerRef),
    );
    return consumed ? null : [requestRef, answerRef];
  }

  assertArtifactReferences(submission: ArtifactSubmission): void {
    if (
      submission.redaction !== undefined &&
      !["none", "partial", "full"].includes(submission.redaction)
    ) {
      throw new Error("Artifact redaction must be none, partial, or full");
    }
    const sourceRefs = submission.sourceRefs ?? [];
    if (
      sourceRefs.length > MAX_NEXT_ACTION_INPUT_REFS ||
      new Set(sourceRefs).size !== sourceRefs.length ||
      sourceRefs.some(
        (reference) =>
          typeof reference !== "string" ||
          reference.length > 2_048 ||
          !REFERENCE_URI_PATTERN.test(reference),
      )
    ) {
      throw new Error(
        "Artifact sourceRefs must be unique valid reference URIs with at most 256 entries",
      );
    }
    const references = [
      ...collectArtifactReferences(submission.body),
      ...sourceRefs
        .filter((ref) => /^(?:artifact|repo|trace):\/\//u.test(ref))
        .map((ref, index) => ({ ref, path: `sourceRefs[${index}]` })),
    ];
    const selectedRepoRefs = this.selectedRepositoryRefs(submission.runId);
    const evidenceRun = this.ledger.requireRun(submission.runId);
    const traceEvents = this.ledger.listTrace(submission.runId);
    for (const reference of references) {
      const userReportedEvidence = isUserReportedEvidencePath(
        submission,
        reference.path,
      );
      if (reference.ref.startsWith("artifact://system/")) {
        if (
          !systemReferenceFields.has(terminalField(reference.path)) ||
          !isKnownSystemReference(reference.ref)
        ) {
          throw new Error(
            `Unknown or misplaced system artifact at ${reference.path}`,
          );
        }
        continue;
      }
      if (reference.ref.startsWith("repo://")) {
        if (userReportedEvidence) {
          throw new Error(
            `User-reported evidence must reference the originating UserMessage at ${reference.path}`,
          );
        }
        if (
          submission.type !== "ContextManifest" &&
          !selectedRepoRefs.has(reference.ref)
        ) {
          throw new Error(
            `Repository reference was not selected by the current ContextManifest at ${reference.path}`,
          );
        }
        if (
          requiresDirectEvidence(reference.path, submission.type) &&
          !userReportedEvidence
        ) {
          throw new Error(
            `Repository context cannot prove an executed outcome at ${reference.path}`,
          );
        }
        continue;
      }
      if (reference.ref.startsWith("trace://")) {
        if (userReportedEvidence) {
          throw new Error(
            `User-reported evidence must reference the originating UserMessage at ${reference.path}`,
          );
        }
        const traceMatch = /^trace:\/\/([^/]+)(?:\/([^/]+))?$/u.exec(
          reference.ref,
        );
        if (!traceMatch || traceMatch[1] !== submission.runId) {
          throw new Error(
            `Invalid or cross-run trace reference at ${reference.path}`,
          );
        }
        if (
          requiresDirectEvidence(reference.path, submission.type) &&
          !traceMatch[2]
        ) {
          throw new Error(
            `Direct evidence requires a specific trace event at ${reference.path}`,
          );
        }
        const traceEvent = traceMatch[2]
          ? traceEvents.find(
              (event) =>
                event.id === traceMatch[2] ||
                `event-${String(event.sequence).padStart(4, "0")}` ===
                  traceMatch[2],
            )
          : undefined;
        if (traceMatch[2] && !traceEvent) {
          throw new Error(`Trace event does not exist at ${reference.path}`);
        }
        if (
          requiresDirectEvidence(reference.path, submission.type) &&
          traceEvent &&
          !directEvidenceTraceEventTypes.has(traceEvent.eventType)
        ) {
          throw new Error(
            `Trace event is not direct evidence at ${reference.path}`,
          );
        }
        continue;
      }
      const match = /^artifact:\/\/([^/]+)\/([^/]+)$/u.exec(reference.ref);
      if (!match)
        throw new Error(`Invalid artifact reference at ${reference.path}`);
      const [, referencedRunId, artifactId] = match;
      if (referencedRunId !== submission.runId) {
        throw new Error(
          `Cross-run artifact reference denied at ${reference.path}`,
        );
      }
      const isAllowedUserReportForwardReference =
        submission.type === "ReleaseAudit" &&
        reference.path === "body.userReportRef" &&
        typeof (submission.body as { userReportRef?: unknown })
          .userReportRef === "string";
      const referencedArtifact = this.ledger.getArtifact(
        submission.runId,
        artifactId!,
      );
      if (isAllowedUserReportForwardReference && referencedArtifact) {
        throw new Error(
          `ReleaseAudit userReportRef collides with existing artifact ${artifactId}`,
        );
      }
      if (!isAllowedUserReportForwardReference && !referencedArtifact) {
        throw new Error(
          `Artifact reference does not exist at ${reference.path}: ${artifactId}`,
        );
      }
      const expectedType = expectedReferenceType(reference.path);
      if (
        expectedType &&
        !isAllowedUserReportForwardReference &&
        referencedArtifact?.type !== expectedType
      ) {
        throw new Error(
          `Artifact reference at ${reference.path} must target ${expectedType}`,
        );
      }
      if (
        userReportedEvidence &&
        !isAllowedUserReportForwardReference &&
        referencedArtifact?.type !== "UserMessage"
      ) {
        throw new Error(
          `User-reported evidence must target a UserMessage at ${reference.path}`,
        );
      }
      const deliverableEvidence =
        requiresDirectEvidence(reference.path, submission.type) &&
        (evidenceRun.requestedMode === "plan_only" ||
          evidenceRun.requestedMode === "report_only") &&
        referencedArtifact?.type === "WorkPlan" &&
        referencedArtifact.id ===
          this.ledger.findLatestArtifact(submission.runId, "WorkPlan")?.id;
      if (
        requiresDirectEvidence(reference.path, submission.type) &&
        !userReportedEvidence &&
        !deliverableEvidence &&
        !isAllowedUserReportForwardReference &&
        referencedArtifact &&
        !directEvidenceArtifactTypes.has(referencedArtifact.type)
      ) {
        throw new Error(
          `Artifact reference at ${reference.path} must target direct evidence`,
        );
      }
    }
  }

  private selectedRepositoryRefs(runId: string): Set<string> {
    const manifest = this.latestBody(runId, "ContextManifest", false);
    const selected = new Set<string>();
    if (!manifest) return selected;
    for (const ref of stringArray(manifest.pinnedRefs)) selected.add(ref);
    if (Array.isArray(manifest.candidates)) {
      for (const candidate of manifest.candidates) {
        if (
          typeof candidate === "object" &&
          candidate !== null &&
          (candidate as { decision?: unknown }).decision === "selected" &&
          typeof (candidate as { ref?: unknown }).ref === "string"
        ) {
          selected.add((candidate as { ref: string }).ref);
        }
      }
    }
    return selected;
  }

  answerClarification(
    runId: string,
    response: string,
  ): { run: RunRecord; nextAction: NextAction } {
    if (response.trim().length === 0)
      throw new Error("Clarification response is required");
    if (response.length > 32_768)
      throw new Error("Clarification response exceeds 32768 characters");
    const current = this.ledger.requireRun(runId);
    if (current.status !== "awaiting_clarification") {
      throw new Error(`Run ${runId} is not awaiting clarification`);
    }
    const request = [...this.ledger.listArtifacts(runId)]
      .reverse()
      .find((artifact) => artifact.type === "ClarificationRequest");
    if (!request) {
      throw new Error("Awaiting-clarification run has no request artifact");
    }
    const requestBody = this.ledger.getArtifact(runId, request.id)?.body;
    if (typeof requestBody !== "object" || requestBody === null) {
      throw new Error("Clarification request body is unavailable");
    }
    const responseChoices = Array.isArray(
      (requestBody as { responseChoices?: unknown }).responseChoices,
    )
      ? ((requestBody as { responseChoices: unknown[] })
          .responseChoices as Array<Record<string, unknown>>)
      : [];
    const selectedChoice = responseChoices.find(
      (choice) => choice.id === response.trim(),
    );
    if (!selectedChoice) {
      throw new Error(
        "Clarification response must equal one of the typed response choice identifiers",
      );
    }
    const requestRef = `artifact://${runId}/${request.id}`;
    const runEffect = selectedChoice.runEffect;
    if (!["resume", "cancel", "new_run"].includes(String(runEffect))) {
      throw new Error("Clarification choice has no valid typed run effect");
    }
    const resumed =
      runEffect === "resume"
        ? resumeAfterClarification(current)
        : {
            ...current,
            status: "cancelled" as const,
            resumePhase: null,
          };
    const now = new Date().toISOString();
    const id = randomUUID();
    const nextRun = {
      ...resumed,
      version: current.version + 1,
      updatedAt: now,
    };
    this.ledger.applySubmission(
      current.version,
      nextRun,
      {
        id,
        runId,
        type: "UserMessage",
        schemaVersion: "1.0",
        producer: "user",
        sourceRefs: [requestRef],
        body: { schemaVersion: "1.0", id, runId, content: response },
      },
      {
        actor: "user",
        eventType: "clarification_answered",
        phase: nextRun.phase,
        inputRefs: [requestRef],
        decisionSummary:
          runEffect === "resume"
            ? "User supplied a bounded decision; the paused phase resumed without broader authority."
            : runEffect === "new_run"
              ? "User selected a choice that requires a newly authorized run; the current run terminated without broader authority."
              : "User cancelled the paused run without broadening authority.",
      },
    );
    return { run: nextRun, nextAction: this.getNextAction(runId) };
  }

  cancelRun(runId: string): RunRecord {
    const current = this.ledger.requireRun(runId);
    if (
      current.status === "completed" ||
      current.status === "partial" ||
      current.status === "blocked" ||
      current.status === "cancelled"
    )
      return current;
    const nextRun: RunRecord = {
      ...current,
      status: "cancelled",
      version: current.version + 1,
      updatedAt: new Date().toISOString(),
    };
    this.ledger.transitionWithoutArtifact(current.version, nextRun, {
      actor: "user",
      eventType: "run_cancelled",
      phase: current.phase,
      decisionSummary: "Run cancelled by user or host.",
    });
    return nextRun;
  }
}
