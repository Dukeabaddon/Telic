import { createHash } from "node:crypto";
import { existsSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";

import {
  containsLikelySecret,
  groundRepository,
  isInstructionPath,
  type GroundingBudgetInput,
} from "@telic/context";
import {
  RunController,
  SqliteLedger,
  type ArtifactSubmission,
  type IntentMode,
  type RunRecord,
} from "@telic/core";
import {
  isArtifactType,
  getArtifactJsonSchema,
  normalizeContextManifestWire,
  parseArtifactBody,
  parseContextManifest,
  type ContextManifest,
  type TraceEvent,
} from "@telic/protocol";

export interface ServiceOptions {
  repositoryRoot: string;
  stateDirectory?: string;
}

export function defaultStateDirectory(repositoryRoot: string): string {
  const canonicalRoot = realpathSync(resolve(repositoryRoot));
  const repositoryKey = createHash("sha256")
    .update(canonicalRoot)
    .digest("hex")
    .slice(0, 24);
  const stateHome = process.env.XDG_STATE_HOME
    ? resolve(process.env.XDG_STATE_HOME)
    : join(homedir(), ".local", "state");
  return join(stateHome, "telic", "repositories", repositoryKey);
}

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
}

export interface GroundContextRequest {
  runId: string;
  activePaths?: string[];
  budget?: GroundingBudgetInput;
}

export type RunSummary = Pick<
  RunRecord,
  | "runId"
  | "schemaVersion"
  | "requestedMode"
  | "status"
  | "phase"
  | "resumePhase"
  | "version"
  | "outcomeHint"
  | "createdAt"
  | "updatedAt"
>;

function protocolValidator(type: string, body: unknown): unknown {
  if (!isArtifactType(type))
    throw new Error(`Unsupported artifact type: ${type}`);
  return parseArtifactBody(type, body);
}

function defaultCapabilities(mode: IntentMode): string[] {
  switch (mode) {
    case "report_only":
      return [];
    case "plan_only":
      return ["repository.read"];
    case "analyze_only":
      return [
        "repository.read",
        "shell.inspect",
        "runtime.inspect",
        "browser.inspect",
      ];
    case "fix_only":
    case "analyze_and_fix":
      return [
        "repository.read",
        "repository.write",
        "shell.inspect",
        "runtime.inspect",
      ];
  }
}

function intersectCapabilities(
  granted: string[],
  available: string[],
): string[] {
  const availableSet = new Set(available);
  return [...new Set(granted)]
    .filter((capability) => availableSet.has(capability))
    .sort();
}

const MAX_TRACE_INPUT_REFS = 256;
const MAX_DECODED_EVIDENCE_BYTES = 2 * 1024 * 1024;
const MAX_EVIDENCE_PER_WORK_PLAN = 128;
const MAX_SCENARIO_SPECS_PER_FRAME = 1;
const REFERENCE_URI_PATTERN =
  /^(?:artifact|repo|trace):\/\/[A-Za-z0-9._~!$&'()*+,;=:@%/-]+$/u;
const CANONICAL_BASE64_PATTERN =
  /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u;

function isPathContained(root: string, target: string): boolean {
  const fromRoot = relative(root, target);
  return (
    fromRoot === "" ||
    (fromRoot !== ".." &&
      !fromRoot.startsWith(`..${sep}`) &&
      !isAbsolute(fromRoot))
  );
}

function canonicalProspectivePath(path: string): string {
  let existingAncestor = resolve(path);
  const missingSegments: string[] = [];
  while (!existsSync(existingAncestor)) {
    const parent = dirname(existingAncestor);
    if (parent === existingAncestor) return resolve(path);
    missingSegments.unshift(basename(existingAncestor));
    existingAncestor = parent;
  }
  return resolve(realpathSync(existingAncestor), ...missingSegments);
}

function assertStateOutsideRepository(
  repositoryRoot: string,
  stateDirectory: string,
): void {
  const lexicalState = resolve(stateDirectory);
  const canonicalState = canonicalProspectivePath(lexicalState);
  if (
    isPathContained(repositoryRoot, lexicalState) ||
    isPathContained(lexicalState, repositoryRoot) ||
    isPathContained(repositoryRoot, canonicalState) ||
    isPathContained(canonicalState, repositoryRoot)
  ) {
    throw new Error(
      "Telic state directory must be outside the repository being grounded and must not contain it",
    );
  }
}

function containsLikelySecretInValue(
  value: unknown,
  seen = new WeakSet<object>(),
): boolean {
  if (typeof value === "string") return containsLikelySecret(value);
  if (typeof value !== "object" || value === null) return false;
  if (seen.has(value)) return false;
  seen.add(value);
  const values = Array.isArray(value) ? value : Object.values(value);
  const containsSecret = values.some((child) =>
    containsLikelySecretInValue(child, seen),
  );
  seen.delete(value);
  return containsSecret;
}

function evidenceContentForSecretScan(
  encoding: "utf8" | "base64",
  content: string,
): string {
  if (encoding === "utf8") return content;
  if (!CANONICAL_BASE64_PATTERN.test(content)) {
    throw new Error("Evidence content is not canonical base64");
  }
  const decoded = Buffer.from(content, "base64");
  if (decoded.byteLength > MAX_DECODED_EVIDENCE_BYTES) {
    throw new Error(
      `Decoded evidence exceeds ${String(MAX_DECODED_EVIDENCE_BYTES)} bytes`,
    );
  }
  if (decoded.toString("base64") !== content) {
    throw new Error("Evidence content is not canonical base64");
  }
  return decoded.toString("utf8");
}

function collectBodyReferenceUris(
  value: unknown,
  references: Set<string>,
  key = "",
  depth = 0,
  seen = new WeakSet<object>(),
): void {
  if (depth > 64) return;
  if (typeof value === "string") {
    if (
      (key === "ref" ||
        key === "evidenceInspected" ||
        key.endsWith("Ref") ||
        key.endsWith("Refs")) &&
      REFERENCE_URI_PATTERN.test(value)
    ) {
      references.add(value);
    }
    return;
  }
  if (typeof value !== "object" || value === null) return;
  if (seen.has(value)) return;
  seen.add(value);
  if (Array.isArray(value)) {
    for (const item of value) {
      collectBodyReferenceUris(item, references, key, depth + 1, seen);
    }
  } else {
    for (const [childKey, child] of Object.entries(value)) {
      collectBodyReferenceUris(child, references, childKey, depth + 1, seen);
    }
  }
  seen.delete(value);
}

function traceInputRefs(
  ledger: SqliteLedger,
  runId: string,
  body: unknown,
  supplied: readonly string[] = [],
): string[] {
  if (new Set(supplied).size !== supplied.length) {
    throw new Error("Artifact sourceRefs must be unique");
  }
  const result = new Set(supplied);
  if (result.size > MAX_TRACE_INPUT_REFS) {
    throw new Error(
      `Artifact sourceRefs exceed the ${String(MAX_TRACE_INPUT_REFS)} item limit`,
    );
  }
  const bodyReferences = new Set<string>();
  collectBodyReferenceUris(body, bodyReferences);
  const existingArtifacts = new Set(
    ledger
      .listArtifacts(runId)
      .map((artifact) => `artifact://${runId}/${artifact.id}`),
  );
  for (const reference of bodyReferences) {
    if (reference.startsWith("artifact://system/")) continue;
    if (
      reference.startsWith("artifact://") &&
      !existingArtifacts.has(reference)
    ) {
      continue;
    }
    result.add(reference);
    if (result.size > MAX_TRACE_INPUT_REFS) {
      throw new Error(
        `Artifact sourceRefs exceed the ${String(MAX_TRACE_INPUT_REFS)} item limit`,
      );
    }
  }
  return [...result];
}

function internalDocumentId(
  contextId: string,
  hash: string,
  index: number,
): string {
  return `${contextId}-source-${String(index + 1).padStart(3, "0")}-${hash.slice("sha256:".length, 20)}`;
}

function emptyReportOnlyManifest(run: RunRecord): ContextManifest {
  const digest = createHash("sha256").update("").digest("hex");
  return parseContextManifest({
    schemaVersion: "1.0",
    id: `context-report-only-${run.runId.slice(0, 12)}`,
    runId: run.runId,
    repositoryFingerprint: {
      headCommit: null,
      dirtyWorktreeHash: `sha256:${digest}`,
    },
    pinnedRefs: [],
    candidates: [],
    derivedRefs: [],
    excludedCandidateSummaries: [],
    inventorySource: "filesystem",
    warnings: [
      "report_only mode intentionally skipped new repository discovery.",
    ],
    budget: {
      maximumFiles: 1,
      maximumFileBytes: 1,
      maximumTotalBytes: 1,
      maximumInventoryFiles: 1,
      candidateFiles: 0,
      selectedFiles: 0,
      selectedBytes: 0,
      estimatedTokens: 0,
    },
  });
}

const tracePhase: Record<RunRecord["phase"], TraceEvent["phase"]> = {
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

const canonicalTraceEventType: Record<string, TraceEvent["eventType"]> = {
  run_started: "run_started",
  context_source_stored: "artifact_recorded",
  evidence_captured: "artifact_recorded",
  scenario_presentation_stored: "artifact_recorded",
  phase_submitted: "phase_submitted",
  clarification_requested: "clarification_requested",
  permission_checked: "permission_checked",
  clarification_answered: "transition_allowed",
  run_cancelled: "run_terminated",
};

const traceActors = new Set<TraceEvent["actor"]>([
  "controller",
  "scenario_author",
  "task_compiler",
  "quality_controller",
  "executor",
  "release_auditor",
  "host",
  "tool",
  "user",
]);

export class TelicService {
  readonly repositoryRoot: string;
  readonly stateDirectory: string;
  readonly ledger: SqliteLedger;
  readonly controller: RunController;

  constructor(options: ServiceOptions) {
    this.repositoryRoot = realpathSync(resolve(options.repositoryRoot));
    const stateDirectory = resolve(
      options.stateDirectory ?? defaultStateDirectory(this.repositoryRoot),
    );
    assertStateOutsideRepository(this.repositoryRoot, stateDirectory);
    this.stateDirectory = stateDirectory;
    this.ledger = new SqliteLedger(this.stateDirectory);
    this.controller = new RunController(
      this.ledger,
      protocolValidator,
      (type) => {
        if (!isArtifactType(type)) {
          throw new Error(`Unsupported artifact type: ${type}`);
        }
        return getArtifactJsonSchema(type);
      },
    );
  }

  close(): void {
    this.ledger.close();
  }

  assertActionToken(
    runId: string,
    actionId: string,
    expectedRunVersion: number,
  ): void {
    const run = this.ledger.requireRun(runId);
    if (run.version !== expectedRunVersion) {
      throw new Error(
        `Stale run version ${String(expectedRunVersion)}; current version is ${String(run.version)}`,
      );
    }
    const action = this.controller.getNextAction(runId);
    if (action.id !== actionId) {
      throw new Error("Stale or foreign action_id; reload the next action");
    }
  }

  startRun(input: StartRunRequest) {
    const hostCapabilities = [
      ...new Set(input.hostCapabilities ?? ["repository.read"]),
    ].sort();
    const desired =
      input.authorizationGranted ?? defaultCapabilities(input.mode);
    const granted = intersectCapabilities(desired, hostCapabilities);
    const denied = [...new Set(input.authorizationDenied ?? [])].sort();
    return this.controller.startRun({
      repositoryRoot: this.repositoryRoot,
      originalRequest: input.originalRequest,
      requestedMode: input.mode,
      host: {
        name: input.hostName ?? "mcp-host",
        nativeSubagents: input.nativeSubagents ?? "unknown",
        capabilities: hostCapabilities,
      },
      authorization: {
        granted,
        denied,
        ...(input.shellExecuteAllowlist
          ? { shellExecuteAllowlist: input.shellExecuteAllowlist }
          : {}),
        ...(input.networkReadDomains
          ? { networkReadDomains: input.networkReadDomains }
          : {}),
      },
    });
  }

  async groundContext(input: GroundContextRequest) {
    const run = this.ledger.requireRun(input.runId);
    if (run.phase !== "context_grounding" || run.status !== "running") {
      throw new Error(`Run ${run.runId} is not awaiting context grounding`);
    }

    let manifest: ContextManifest;
    let sourceRefs: string[] = [];
    if (run.requestedMode === "report_only") {
      manifest = emptyReportOnlyManifest(run);
    } else {
      const requestRecord = this.ledger
        .listArtifacts(run.runId)
        .find((artifact) => artifact.type === "UserMessage");
      if (!requestRecord)
        throw new Error("Run is missing its immutable original request");
      const requestArtifact = this.ledger.getArtifact(
        run.runId,
        requestRecord.id,
      );
      const requestBody = requestArtifact?.body;
      if (
        typeof requestBody !== "object" ||
        requestBody === null ||
        !("content" in requestBody) ||
        typeof requestBody.content !== "string"
      ) {
        throw new Error("Original request artifact is invalid");
      }

      const grounded = await groundRepository({
        run_id: run.runId,
        repository_root: run.repositoryRoot,
        request: requestBody.content,
        excluded_roots: [this.stateDirectory],
        ...(input.activePaths ? { active_paths: input.activePaths } : {}),
        ...(input.budget ? { budget: input.budget } : {}),
      });

      for (const [index, document] of grounded.documents.entries()) {
        const id = internalDocumentId(
          grounded.manifest.id,
          document.content_hash,
          index,
        );
        const uri = `artifact://${run.runId}/${id}`;
        sourceRefs.push(uri);
        this.ledger.appendSupportingArtifact(
          {
            id,
            runId: run.runId,
            type: "ContextDocument",
            schemaVersion: "1.0",
            producer: "controller",
            sourceRefs: [document.ref],
            body: {
              schemaVersion: "1.0",
              id,
              runId: run.runId,
              repositoryRef: document.ref,
              contentHash: document.content_hash,
              sizeBytes: document.size_bytes,
              trustKind: isInstructionPath(document.path)
                ? "applicable_instruction"
                : "untrusted_repository_content",
              instructionScope: isInstructionPath(document.path)
                ? document.path.includes("/")
                  ? document.path.slice(0, document.path.lastIndexOf("/"))
                  : "."
                : null,
              content: document.content,
            },
          },
          {
            actor: "controller",
            eventType: "context_source_stored",
            inputRefs: [document.ref],
            decisionSummary: `Stored selected source ${document.ref} once in the content-addressed artifact store.`,
          },
        );
      }

      manifest = normalizeContextManifestWire({
        ...grounded.manifest,
        derived_refs: sourceRefs,
      });
    }

    const groundingAction = this.controller.getNextAction(run.runId);
    if (groundingAction.kind === "phase") {
      sourceRefs = [
        ...new Set([...groundingAction.inputRefs, ...sourceRefs]),
      ].slice(0, MAX_TRACE_INPUT_REFS);
    }
    const result = this.controller.submitArtifact({
      id: manifest.id,
      runId: run.runId,
      type: "ContextManifest",
      schemaVersion: "1.0",
      producer: "controller",
      sourceRefs,
      body: manifest,
    });
    return { ...result, manifest };
  }

  submitArtifact(input: ArtifactSubmission) {
    if (
      input.type === "RunEnvelope" ||
      input.type === "ContextManifest" ||
      input.type === "NextAction" ||
      input.type === "TraceEvent"
    ) {
      throw new Error(
        `${input.type} is controller-owned and cannot be submitted by a host role`,
      );
    }
    if (input.type === "Evidence") {
      const run = this.ledger.requireRun(input.runId);
      if (run.status !== "running" || run.phase !== "agent_4_execute") {
        throw new Error(
          "Evidence may be captured only during the bounded executor phase",
        );
      }
      const body = parseArtifactBody("Evidence", input.body);
      if (
        input.producer !== "executor" ||
        input.id !== body.id ||
        input.runId !== body.runId ||
        input.schemaVersion !== body.schemaVersion
      ) {
        throw new Error(
          "Evidence metadata or producer does not match its body",
        );
      }
      const sourceRefs = traceInputRefs(
        this.ledger,
        input.runId,
        body,
        input.sourceRefs,
      );
      const decodedContent = evidenceContentForSecretScan(
        body.encoding,
        body.content,
      );
      if (
        containsLikelySecretInValue(body) ||
        containsLikelySecret(decodedContent) ||
        containsLikelySecretInValue(sourceRefs)
      ) {
        throw new Error(
          "Evidence contains a likely credential; redact the value before submission",
        );
      }
      this.controller.assertArtifactReferences({ ...input, body, sourceRefs });
      for (const sourceRef of body.sourceRefs) {
        if (!sourceRef.startsWith("artifact://")) continue;
        const match = /^artifact:\/\/([^/]+)\/([^/]+)$/.exec(sourceRef);
        if (
          !match ||
          match[1] !== input.runId ||
          !this.ledger.getArtifact(input.runId, match[2]!)
        ) {
          throw new Error(
            `Evidence source reference is missing or belongs to another run: ${sourceRef}`,
          );
        }
      }
      const stored = this.ledger.appendSupportingArtifact(
        { ...input, body, sourceRefs },
        {
          actor: "executor",
          eventType: "evidence_captured",
          inputRefs: sourceRefs,
          decisionSummary: `Captured a redacted ${body.kind} evidence artifact.`,
        },
        {
          scope: "after_latest",
          anchorType: "WorkPlan",
          maximum: MAX_EVIDENCE_PER_WORK_PLAN,
          errorMessage: `Evidence quota of ${String(MAX_EVIDENCE_PER_WORK_PLAN)} per WorkPlan reached`,
        },
      );
      return {
        run,
        artifact: stored,
        nextAction: this.controller.getNextAction(input.runId),
      };
    }
    if (input.type === "ScenarioSpec") {
      const run = this.ledger.requireRun(input.runId);
      if (run.status !== "running" || run.phase !== "agent_2_compile") {
        throw new Error(
          "Optional ScenarioSpec must immediately follow its accepted ProblemFrame",
        );
      }
      const body = parseArtifactBody("ScenarioSpec", input.body);
      if (
        input.producer !== "scenario_author" ||
        input.id !== body.id ||
        input.runId !== body.runId ||
        input.schemaVersion !== body.schemaVersion
      ) {
        throw new Error(
          "ScenarioSpec metadata or producer does not match its body",
        );
      }
      const sourceRefs = traceInputRefs(
        this.ledger,
        input.runId,
        body,
        input.sourceRefs,
      );
      this.controller.assertArtifactReferences({ ...input, body, sourceRefs });
      const match = /^artifact:\/\/([^/]+)\/([^/]+)$/.exec(
        body.problemFrameRef,
      );
      if (
        !match ||
        match[1] !== input.runId ||
        !this.ledger.getArtifact(input.runId, match[2]!)
      ) {
        throw new Error(
          "ScenarioSpec must reference an existing ProblemFrame in the same run",
        );
      }
      const stored = this.ledger.appendSupportingArtifact(
        { ...input, body, sourceRefs },
        {
          actor: input.producer,
          eventType: "scenario_presentation_stored",
          inputRefs: sourceRefs,
          decisionSummary:
            "Stored an optional sourced scenario presentation; the ProblemFrame remains authoritative.",
        },
        {
          scope: "matching_body_field",
          field: "problemFrameRef",
          value: body.problemFrameRef,
          maximum: MAX_SCENARIO_SPECS_PER_FRAME,
          errorMessage:
            "Only one ScenarioSpec may be stored for the current ProblemFrame",
        },
      );
      return {
        run,
        artifact: stored,
        nextAction: this.controller.getNextAction(input.runId),
      };
    }
    if (!isArtifactType(input.type)) {
      throw new Error(`Unsupported artifact type: ${input.type}`);
    }
    const body = parseArtifactBody(input.type, input.body);
    return this.controller.submitArtifact({
      ...input,
      body,
      sourceRefs: traceInputRefs(
        this.ledger,
        input.runId,
        body,
        input.sourceRefs,
      ),
    });
  }

  answerClarification(runId: string, response: string) {
    return this.controller.answerClarification(runId, response);
  }

  cancelRun(runId: string, actionId: string, expectedRunVersion: number) {
    this.assertActionToken(runId, actionId, expectedRunVersion);
    const run = this.controller.cancelRun(runId);
    return { run, nextAction: this.controller.getNextAction(runId) };
  }

  listRuns(limit = 20): RunSummary[] {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new Error("Run list limit must be an integer from 1 to 100");
    }
    return this.ledger
      .listRuns(limit)
      .map(
        ({
          runId,
          schemaVersion,
          requestedMode,
          status,
          phase,
          resumePhase,
          version,
          outcomeHint,
          createdAt,
          updatedAt,
        }) => ({
          runId,
          schemaVersion,
          requestedMode,
          status,
          phase,
          resumePhase,
          version,
          outcomeHint,
          createdAt,
          updatedAt,
        }),
      );
  }

  getRun(runId: string) {
    const run = this.ledger.requireRun(runId);
    return {
      run,
      artifacts: this.ledger.listArtifacts(runId),
      nextAction: this.controller.getNextAction(runId),
    };
  }

  getArtifact(runId: string, artifactId: string) {
    const artifact = this.ledger.getArtifact(runId, artifactId);
    if (!artifact) throw new Error(`Artifact not found: ${artifactId}`);
    return artifact;
  }

  getTrace(runId: string, afterSequence = 0, limit = 10_000) {
    this.ledger.requireRun(runId);
    return this.ledger.listTrace(runId, afterSequence, limit).map((event) =>
      parseArtifactBody("TraceEvent", {
        schemaVersion: "1.0",
        id: event.id,
        runId: event.runId,
        sequence: event.sequence,
        timestamp: event.timestamp,
        actor: traceActors.has(event.actor as TraceEvent["actor"])
          ? event.actor
          : "host",
        phase: tracePhase[event.phase],
        eventType:
          canonicalTraceEventType[event.eventType] ?? "artifact_recorded",
        inputRefs: event.inputRefs,
        outputRefs: event.outputRefs,
        tool: null,
        permissionDecision: event.permissionDecision,
        budgetSnapshot: {
          promptRevisions: event.budgetSnapshot.promptRevisionsRemaining,
          postExecutionRemediations:
            event.budgetSnapshot.postExecutionRemediationsRemaining,
          transportRetries: 0,
        },
        rationaleSummary: event.decisionSummary,
        redactions: [],
      }),
    );
  }
}
