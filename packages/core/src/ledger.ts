import { randomUUID } from "node:crypto";
import {
  chmodSync,
  closeSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { constants as fsConstants } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { canonicalJson, sha256Json } from "./canonical-json.js";
import type {
  ArtifactSubmission,
  HydratedArtifact,
  Phase,
  RunRecord,
  StoredArtifact,
  TraceEventRecord,
  TracePermissionDecision,
} from "./types.js";

const MAX_ARTIFACT_BYTES = 2 * 1024 * 1024;
const MAX_TRACE_SUMMARY_CHARS = 800;
const MAX_ARTIFACTS_PER_RUN = 2_048;
const MAX_TRACE_EVENTS_PER_RUN = 10_000;

type RunRow = {
  run_id: string;
  schema_version: string;
  repository_root: string;
  requested_mode: RunRecord["requestedMode"];
  status: RunRecord["status"];
  phase: Phase;
  resume_phase: Phase | null;
  version: number;
  prompt_revisions_remaining: number;
  remediations_remaining: number;
  outcome_hint: RunRecord["outcomeHint"];
  created_at: string;
  updated_at: string;
};

type ArtifactRow = {
  artifact_id: string;
  run_id: string;
  type: string;
  schema_version: string;
  producer: string;
  sha256: string;
  source_refs_json: string;
  redaction: StoredArtifact["redaction"];
  created_at: string;
};

type EventRow = {
  event_id: string;
  run_id: string;
  sequence: number;
  timestamp: string;
  actor: string;
  phase: Phase;
  event_type: string;
  input_refs_json: string;
  output_refs_json: string;
  permission_decision_json: string | null;
  decision_summary: string;
  budget_snapshot_json: string;
};

function rowToRun(row: RunRow): RunRecord {
  if (row.schema_version !== "1.0")
    throw new Error(`Unsupported run schema ${row.schema_version}`);
  return {
    runId: row.run_id,
    schemaVersion: "1.0",
    repositoryRoot: row.repository_root,
    requestedMode: row.requested_mode,
    status: row.status,
    phase: row.phase,
    resumePhase: row.resume_phase,
    version: row.version,
    budgets: {
      promptRevisionsRemaining: row.prompt_revisions_remaining,
      postExecutionRemediationsRemaining: row.remediations_remaining,
    },
    outcomeHint: row.outcome_hint,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToArtifact(row: ArtifactRow): StoredArtifact {
  return {
    id: row.artifact_id,
    runId: row.run_id,
    type: row.type,
    schemaVersion: row.schema_version,
    producer: row.producer,
    sha256: row.sha256,
    sourceRefs: JSON.parse(row.source_refs_json) as string[],
    redaction: row.redaction,
    createdAt: row.created_at,
  };
}

export interface SubmissionEvent {
  actor: string;
  eventType: string;
  phase: Phase;
  inputRefs?: string[];
  permissionDecision?: TracePermissionDecision;
  decisionSummary: string;
}

export type SupportingArtifactQuota =
  | {
      scope: "after_latest";
      anchorType: string;
      maximum: number;
      errorMessage: string;
    }
  | {
      scope: "matching_body_field";
      field: string;
      value: string;
      maximum: number;
      errorMessage: string;
    };

export class SqliteLedger {
  readonly rootDirectory: string;
  readonly databasePath: string;
  readonly blobDirectory: string;
  private readonly database: DatabaseSync;

  constructor(rootDirectory: string) {
    this.rootDirectory = resolve(rootDirectory);
    this.databasePath = join(this.rootDirectory, "ledger.sqlite3");
    this.blobDirectory = join(this.rootDirectory, "blobs", "sha256");
    if (
      existsSync(this.rootDirectory) &&
      lstatSync(this.rootDirectory).isSymbolicLink()
    ) {
      throw new Error("Telic state directory must not be a symbolic link");
    }
    mkdirSync(this.rootDirectory, { recursive: true, mode: 0o700 });
    const rootInfo = lstatSync(this.rootDirectory);
    if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) {
      throw new Error("Telic state path must be a private directory");
    }
    chmodSync(this.rootDirectory, 0o700);
    if (existsSync(this.databasePath)) {
      const databaseInfo = lstatSync(this.databasePath);
      if (!databaseInfo.isFile() || databaseInfo.isSymbolicLink()) {
        throw new Error("Telic ledger path must be a regular file");
      }
    } else {
      const descriptor = openSync(
        this.databasePath,
        fsConstants.O_CREAT |
          fsConstants.O_EXCL |
          fsConstants.O_WRONLY |
          fsConstants.O_NOFOLLOW,
        0o600,
      );
      closeSync(descriptor);
    }
    for (const sidecarPath of [
      `${this.databasePath}-wal`,
      `${this.databasePath}-shm`,
    ]) {
      if (existsSync(sidecarPath)) {
        const sidecarInfo = lstatSync(sidecarPath);
        if (!sidecarInfo.isFile() || sidecarInfo.isSymbolicLink()) {
          throw new Error("Telic ledger sidecars must be regular files");
        }
      }
    }
    const blobRoot = join(this.rootDirectory, "blobs");
    this.ensurePrivateDirectory(blobRoot, "Telic blob root");
    this.ensurePrivateDirectory(this.blobDirectory, "Telic blob path");
    this.assertBlobBoundary();
    this.database = new DatabaseSync(this.databasePath);
    chmodSync(this.databasePath, 0o600);
    this.database.exec(
      "PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA synchronous = FULL; PRAGMA busy_timeout = 5000;",
    );
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS runs (
        run_id TEXT PRIMARY KEY,
        schema_version TEXT NOT NULL,
        repository_root TEXT NOT NULL,
        requested_mode TEXT NOT NULL,
        status TEXT NOT NULL,
        phase TEXT NOT NULL,
        resume_phase TEXT,
        version INTEGER NOT NULL,
        prompt_revisions_remaining INTEGER NOT NULL CHECK(prompt_revisions_remaining >= 0),
        remediations_remaining INTEGER NOT NULL CHECK(remediations_remaining >= 0),
        outcome_hint TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS artifacts (
        artifact_id TEXT NOT NULL,
        run_id TEXT NOT NULL REFERENCES runs(run_id),
        type TEXT NOT NULL,
        schema_version TEXT NOT NULL,
        producer TEXT NOT NULL,
        sha256 TEXT NOT NULL,
        source_refs_json TEXT NOT NULL,
        redaction TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY(run_id, artifact_id)
      ) STRICT;
      CREATE INDEX IF NOT EXISTS artifacts_run_idx ON artifacts(run_id, created_at);
      CREATE TABLE IF NOT EXISTS trace_events (
        event_id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL REFERENCES runs(run_id),
        sequence INTEGER NOT NULL,
        timestamp TEXT NOT NULL,
        actor TEXT NOT NULL,
        phase TEXT NOT NULL,
        event_type TEXT NOT NULL,
        input_refs_json TEXT NOT NULL,
        output_refs_json TEXT NOT NULL,
        permission_decision_json TEXT,
        decision_summary TEXT NOT NULL,
        budget_snapshot_json TEXT NOT NULL,
        UNIQUE(run_id, sequence)
      ) STRICT;
      CREATE INDEX IF NOT EXISTS events_run_idx ON trace_events(run_id, sequence);
    `);
    const traceColumns = this.database
      .prepare("PRAGMA table_info(trace_events)")
      .all() as unknown as Array<{ name: string }>;
    if (
      !traceColumns.some((column) => column.name === "permission_decision_json")
    ) {
      this.database.exec(
        "ALTER TABLE trace_events ADD COLUMN permission_decision_json TEXT",
      );
    }
    this.migrateGlobalArtifactIds();
  }

  private migrateGlobalArtifactIds(): void {
    const columns = this.database
      .prepare("PRAGMA table_info(artifacts)")
      .all() as unknown as Array<{
      name: string;
      pk: number;
    }>;
    const artifactId = columns.find((column) => column.name === "artifact_id");
    const runId = columns.find((column) => column.name === "run_id");
    if (artifactId?.pk !== 1 || runId?.pk === 2) return;

    this.database.exec("BEGIN IMMEDIATE");
    try {
      this.database.exec(`
        DROP INDEX IF EXISTS artifacts_run_idx;
        ALTER TABLE artifacts RENAME TO artifacts_global_ids;
        CREATE TABLE artifacts (
          artifact_id TEXT NOT NULL,
          run_id TEXT NOT NULL REFERENCES runs(run_id),
          type TEXT NOT NULL,
          schema_version TEXT NOT NULL,
          producer TEXT NOT NULL,
          sha256 TEXT NOT NULL,
          source_refs_json TEXT NOT NULL,
          redaction TEXT NOT NULL,
          created_at TEXT NOT NULL,
          PRIMARY KEY(run_id, artifact_id)
        ) STRICT;
        INSERT INTO artifacts SELECT * FROM artifacts_global_ids;
        DROP TABLE artifacts_global_ids;
        CREATE INDEX artifacts_run_idx ON artifacts(run_id, created_at);
      `);
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  close(): void {
    this.database.close();
  }

  createRun(run: RunRecord, initialArtifacts: ArtifactSubmission[]): void {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      this.insertRun(run);
      for (const artifact of initialArtifacts) this.insertArtifact(artifact);
      this.insertEvent(run, {
        actor: "controller",
        eventType: "run_started",
        phase: run.phase,
        decisionSummary:
          "Run received with immutable request and authorization envelope.",
      });
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  private insertRun(run: RunRecord): void {
    this.database
      .prepare(
        `INSERT INTO runs (
        run_id, schema_version, repository_root, requested_mode, status, phase,
        resume_phase, version, prompt_revisions_remaining, remediations_remaining,
        outcome_hint, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        run.runId,
        run.schemaVersion,
        run.repositoryRoot,
        run.requestedMode,
        run.status,
        run.phase,
        run.resumePhase,
        run.version,
        run.budgets.promptRevisionsRemaining,
        run.budgets.postExecutionRemediationsRemaining,
        run.outcomeHint,
        run.createdAt,
        run.updatedAt,
      );
  }

  getRun(runId: string): RunRecord | null {
    const row = this.database
      .prepare("SELECT * FROM runs WHERE run_id = ?")
      .get(runId) as RunRow | undefined;
    return row ? rowToRun(row) : null;
  }

  listRuns(limit: number): RunRecord[] {
    const rows = this.database
      .prepare(
        `SELECT * FROM runs
         ORDER BY updated_at DESC, run_id ASC
         LIMIT ?`,
      )
      .all(limit) as RunRow[];
    return rows.map(rowToRun);
  }

  requireRun(runId: string): RunRecord {
    const run = this.getRun(runId);
    if (!run) throw new Error(`Run not found: ${runId}`);
    return run;
  }

  applySubmission(
    expectedVersion: number,
    nextRun: RunRecord,
    artifact: ArtifactSubmission,
    event: SubmissionEvent,
    additionalEvents: SubmissionEvent[] = [],
  ): StoredArtifact {
    this.assertArtifactSlot(artifact.runId, artifact.id);
    const stored = this.prepareArtifact(artifact);
    this.database.exec("BEGIN IMMEDIATE");
    try {
      this.insertPreparedArtifact(stored);
      const updated = this.database
        .prepare(
          `UPDATE runs SET
          status = ?, phase = ?, resume_phase = ?, version = ?,
          prompt_revisions_remaining = ?, remediations_remaining = ?, outcome_hint = ?,
          updated_at = ? WHERE run_id = ? AND version = ?`,
        )
        .run(
          nextRun.status,
          nextRun.phase,
          nextRun.resumePhase,
          nextRun.version,
          nextRun.budgets.promptRevisionsRemaining,
          nextRun.budgets.postExecutionRemediationsRemaining,
          nextRun.outcomeHint,
          nextRun.updatedAt,
          nextRun.runId,
          expectedVersion,
        );
      if (Number(updated.changes) !== 1) {
        throw new Error(
          "Concurrent run update detected; reload and retry with the latest version",
        );
      }
      this.insertEvent(nextRun, {
        ...event,
        outputRefs: [`artifact://${artifact.runId}/${artifact.id}`],
      });
      for (const additionalEvent of additionalEvents) {
        this.insertEvent(nextRun, {
          ...additionalEvent,
          outputRefs: [`artifact://${artifact.runId}/${artifact.id}`],
        });
      }
      this.database.exec("COMMIT");
      return stored;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  appendSupportingArtifact(
    artifact: ArtifactSubmission,
    event: Omit<SubmissionEvent, "phase"> & { phase?: Phase },
    quota?: SupportingArtifactQuota,
  ): StoredArtifact {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const run = this.requireRun(artifact.runId);
      const existing = this.getArtifact(artifact.runId, artifact.id);
      if (existing) {
        const expectedSourceRefs = artifact.sourceRefs ?? [];
        const expectedRedaction = artifact.redaction ?? "none";
        if (
          existing.type !== artifact.type ||
          existing.schemaVersion !== artifact.schemaVersion ||
          existing.producer !== artifact.producer ||
          existing.sha256 !== sha256Json(artifact.body) ||
          canonicalJson(existing.sourceRefs) !==
            canonicalJson(expectedSourceRefs) ||
          existing.redaction !== expectedRedaction
        ) {
          throw new Error(
            `Supporting artifact replay conflicts with immutable artifact: ${artifact.id}`,
          );
        }
        const { body: _body, ...stored } = existing;
        this.database.exec("COMMIT");
        return stored;
      }
      this.assertArtifactSlot(artifact.runId, artifact.id);
      if (quota) this.assertSupportingArtifactQuota(artifact, quota);
      const stored = this.prepareArtifact(artifact);
      this.insertPreparedArtifact(stored);
      this.insertEvent(run, {
        ...event,
        phase: event.phase ?? run.phase,
        outputRefs: [`artifact://${artifact.runId}/${artifact.id}`],
      });
      this.database.exec("COMMIT");
      return stored;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  private assertSupportingArtifactQuota(
    artifact: ArtifactSubmission,
    quota: SupportingArtifactQuota,
  ): void {
    if (
      !Number.isSafeInteger(quota.maximum) ||
      quota.maximum < 1 ||
      quota.maximum > MAX_ARTIFACTS_PER_RUN
    ) {
      throw new Error("Supporting artifact quota is invalid");
    }
    let count: number;
    if (quota.scope === "after_latest") {
      const anchor = this.database
        .prepare(
          "SELECT MAX(rowid) AS rowid FROM artifacts WHERE run_id = ? AND type = ?",
        )
        .get(artifact.runId, quota.anchorType) as {
        rowid: number | null;
      };
      if (anchor.rowid === null) throw new Error(quota.errorMessage);
      const result = this.database
        .prepare(
          "SELECT COUNT(*) AS count FROM artifacts WHERE run_id = ? AND type = ? AND rowid > ?",
        )
        .get(artifact.runId, artifact.type, anchor.rowid) as { count: number };
      count = result.count;
    } else {
      count = this.listArtifacts(artifact.runId)
        .filter((candidate) => candidate.type === artifact.type)
        .filter((candidate) => {
          const body = this.getArtifact(artifact.runId, candidate.id)?.body;
          return (
            typeof body === "object" &&
            body !== null &&
            Object.hasOwn(body, quota.field) &&
            (body as Record<string, unknown>)[quota.field] === quota.value
          );
        }).length;
    }
    if (count >= quota.maximum) throw new Error(quota.errorMessage);
  }

  transitionWithoutArtifact(
    expectedVersion: number,
    nextRun: RunRecord,
    event: SubmissionEvent,
  ): void {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const updated = this.database
        .prepare(
          `UPDATE runs SET
          status = ?, phase = ?, resume_phase = ?, version = ?,
          prompt_revisions_remaining = ?, remediations_remaining = ?, outcome_hint = ?,
          updated_at = ? WHERE run_id = ? AND version = ?`,
        )
        .run(
          nextRun.status,
          nextRun.phase,
          nextRun.resumePhase,
          nextRun.version,
          nextRun.budgets.promptRevisionsRemaining,
          nextRun.budgets.postExecutionRemediationsRemaining,
          nextRun.outcomeHint,
          nextRun.updatedAt,
          nextRun.runId,
          expectedVersion,
        );
      if (Number(updated.changes) !== 1)
        throw new Error("Concurrent run update detected");
      this.insertEvent(nextRun, event);
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  appendTraceEvent(runId: string, event: SubmissionEvent): void {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const run = this.requireRun(runId);
      this.insertEvent(run, event);
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  appendTraceEventOnce(
    runId: string,
    event: SubmissionEvent & { outputRefs?: string[] },
  ): void {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const run = this.requireRun(runId);
      const duplicate = this.database
        .prepare(
          `SELECT 1 AS present FROM trace_events
           WHERE run_id = ? AND actor = ? AND phase = ? AND event_type = ?
             AND input_refs_json = ? AND output_refs_json = ?
             AND COALESCE(permission_decision_json, '') = ?
             AND decision_summary = ?
           LIMIT 1`,
        )
        .get(
          runId,
          event.actor,
          event.phase,
          event.eventType,
          canonicalJson(event.inputRefs ?? []),
          canonicalJson(event.outputRefs ?? []),
          event.permissionDecision
            ? canonicalJson(event.permissionDecision)
            : "",
          event.decisionSummary,
        );
      if (!duplicate) this.insertEvent(run, event);
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  private insertArtifact(artifact: ArtifactSubmission): StoredArtifact {
    const stored = this.prepareArtifact(artifact);
    this.insertPreparedArtifact(stored);
    return stored;
  }

  private assertArtifactSlot(runId: string, artifactId: string): void {
    const duplicate = this.database
      .prepare(
        "SELECT 1 AS present FROM artifacts WHERE run_id = ? AND artifact_id = ?",
      )
      .get(runId, artifactId);
    if (duplicate) {
      throw new Error(`Artifact already exists in this run: ${artifactId}`);
    }
    const count = this.database
      .prepare("SELECT COUNT(*) AS count FROM artifacts WHERE run_id = ?")
      .get(runId) as { count: number };
    if (count.count >= MAX_ARTIFACTS_PER_RUN) {
      throw new Error(
        `Run artifact limit of ${String(MAX_ARTIFACTS_PER_RUN)} reached`,
      );
    }
  }

  private prepareArtifact(artifact: ArtifactSubmission): StoredArtifact {
    const json = canonicalJson(artifact.body);
    if (Buffer.byteLength(json) > MAX_ARTIFACT_BYTES) {
      throw new Error(`Artifact exceeds ${MAX_ARTIFACT_BYTES} byte limit`);
    }
    const sha256 = sha256Json(artifact.body);
    const path = this.blobPath(sha256);
    this.assertBlobBoundary();
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    const prefixInfo = lstatSync(dirname(path));
    if (!prefixInfo.isDirectory() || prefixInfo.isSymbolicLink()) {
      throw new Error("Artifact blob prefix must be a private directory");
    }
    if (existsSync(path)) {
      const existingInfo = lstatSync(path);
      if (!existingInfo.isFile() || existingInfo.isSymbolicLink()) {
        throw new Error("Artifact blob path must be a regular file");
      }
    } else {
      const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
      writeFileSync(temporary, json, {
        encoding: "utf8",
        mode: 0o600,
        flag: "wx",
      });
      try {
        renameSync(temporary, path);
      } catch (error) {
        rmSync(temporary, { force: true });
        if (!existsSync(path)) throw error;
      }
      chmodSync(path, 0o600);
    }
    const finalInfo = lstatSync(path);
    if (!finalInfo.isFile() || finalInfo.isSymbolicLink()) {
      throw new Error("Artifact blob path must be a regular file");
    }
    return {
      id: artifact.id,
      runId: artifact.runId,
      type: artifact.type,
      schemaVersion: artifact.schemaVersion,
      producer: artifact.producer,
      sha256,
      sourceRefs: artifact.sourceRefs ?? [],
      redaction: artifact.redaction ?? "none",
      createdAt: new Date().toISOString(),
    };
  }

  private insertPreparedArtifact(artifact: StoredArtifact): void {
    this.database
      .prepare(
        `INSERT INTO artifacts (
        artifact_id, run_id, type, schema_version, producer, sha256,
        source_refs_json, redaction, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        artifact.id,
        artifact.runId,
        artifact.type,
        artifact.schemaVersion,
        artifact.producer,
        artifact.sha256,
        canonicalJson(artifact.sourceRefs),
        artifact.redaction,
        artifact.createdAt,
      );
  }

  getArtifact(runId: string, artifactId: string): HydratedArtifact | null {
    const row = this.database
      .prepare("SELECT * FROM artifacts WHERE run_id = ? AND artifact_id = ?")
      .get(runId, artifactId) as ArtifactRow | undefined;
    if (!row) return null;
    const artifact = rowToArtifact(row);
    this.assertBlobBoundary();
    const path = this.blobPath(artifact.sha256);
    const blobInfo = lstatSync(path);
    if (!blobInfo.isFile() || blobInfo.isSymbolicLink()) {
      throw new Error("Stored artifact blob must be a regular file");
    }
    const bodyText = readFileSync(path, "utf8");
    const body = JSON.parse(bodyText) as unknown;
    const computed = sha256Json(body);
    if (
      computed !== artifact.sha256 &&
      computed.slice("sha256:".length) !== artifact.sha256
    )
      throw new Error("Artifact integrity check failed");
    return { ...artifact, body };
  }

  listArtifacts(runId: string): StoredArtifact[] {
    const rows = this.database
      .prepare("SELECT * FROM artifacts WHERE run_id = ? ORDER BY rowid")
      .all(runId) as unknown as ArtifactRow[];
    return rows.map(rowToArtifact);
  }

  findLatestArtifact(runId: string, type: string): StoredArtifact | null {
    const row = this.database
      .prepare(
        "SELECT * FROM artifacts WHERE run_id = ? AND type = ? ORDER BY rowid DESC LIMIT 1",
      )
      .get(runId, type) as ArtifactRow | undefined;
    return row ? rowToArtifact(row) : null;
  }

  private insertEvent(
    run: RunRecord,
    event: SubmissionEvent & { outputRefs?: string[] },
  ): void {
    if (event.decisionSummary.length > MAX_TRACE_SUMMARY_CHARS) {
      throw new Error(
        `Trace decision summary exceeds ${MAX_TRACE_SUMMARY_CHARS} characters`,
      );
    }
    const eventCount = this.database
      .prepare("SELECT COUNT(*) AS count FROM trace_events WHERE run_id = ?")
      .get(run.runId) as { count: number };
    if (eventCount.count >= MAX_TRACE_EVENTS_PER_RUN) {
      throw new Error(
        `Run trace limit of ${String(MAX_TRACE_EVENTS_PER_RUN)} reached`,
      );
    }
    const next = this.database
      .prepare(
        "SELECT COALESCE(MAX(sequence), 0) + 1 AS sequence FROM trace_events WHERE run_id = ?",
      )
      .get(run.runId) as { sequence: number };
    this.database
      .prepare(
        `INSERT INTO trace_events (
        event_id, run_id, sequence, timestamp, actor, phase, event_type,
        input_refs_json, output_refs_json, permission_decision_json,
        decision_summary, budget_snapshot_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        randomUUID(),
        run.runId,
        next.sequence,
        new Date().toISOString(),
        event.actor,
        event.phase,
        event.eventType,
        canonicalJson(event.inputRefs ?? []),
        canonicalJson(event.outputRefs ?? []),
        event.permissionDecision
          ? canonicalJson(event.permissionDecision)
          : null,
        event.decisionSummary,
        canonicalJson(run.budgets),
      );
  }

  listTrace(
    runId: string,
    afterSequence = 0,
    limit = MAX_TRACE_EVENTS_PER_RUN,
  ): TraceEventRecord[] {
    if (!Number.isInteger(afterSequence) || afterSequence < 0) {
      throw new Error("Trace cursor must be a non-negative integer");
    }
    if (
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > MAX_TRACE_EVENTS_PER_RUN
    ) {
      throw new Error(
        `Trace limit must be between 1 and ${String(MAX_TRACE_EVENTS_PER_RUN)}`,
      );
    }
    const rows = this.database
      .prepare(
        "SELECT * FROM trace_events WHERE run_id = ? AND sequence > ? ORDER BY sequence LIMIT ?",
      )
      .all(runId, afterSequence, limit) as unknown as EventRow[];
    return rows.map((row) => ({
      id: row.event_id,
      runId: row.run_id,
      sequence: row.sequence,
      timestamp: row.timestamp,
      actor: row.actor,
      phase: row.phase,
      eventType: row.event_type,
      inputRefs: JSON.parse(row.input_refs_json) as string[],
      outputRefs: JSON.parse(row.output_refs_json) as string[],
      permissionDecision: row.permission_decision_json
        ? (JSON.parse(row.permission_decision_json) as TracePermissionDecision)
        : null,
      decisionSummary: row.decision_summary,
      budgetSnapshot: JSON.parse(
        row.budget_snapshot_json,
      ) as TraceEventRecord["budgetSnapshot"],
    }));
  }

  private blobPath(sha256: string): string {
    const digest = sha256.startsWith("sha256:")
      ? sha256.slice("sha256:".length)
      : sha256;
    if (!/^[a-f0-9]{64}$/u.test(digest)) {
      throw new Error("Stored artifact digest is malformed");
    }
    return join(this.blobDirectory, digest.slice(0, 2), digest.slice(2));
  }

  private ensurePrivateDirectory(path: string, label: string): void {
    if (existsSync(path)) {
      const info = lstatSync(path);
      if (!info.isDirectory() || info.isSymbolicLink()) {
        throw new Error(`${label} must not be a symbolic link`);
      }
    } else {
      mkdirSync(path, { mode: 0o700 });
    }
    const info = lstatSync(path);
    if (!info.isDirectory() || info.isSymbolicLink()) {
      throw new Error(`${label} must be a private directory`);
    }
    chmodSync(path, 0o700);
  }

  private assertBlobBoundary(): void {
    const blobRoot = join(this.rootDirectory, "blobs");
    for (const [path, label] of [
      [blobRoot, "Telic blob root"],
      [this.blobDirectory, "Telic blob path"],
    ] as const) {
      const info = lstatSync(path);
      if (!info.isDirectory() || info.isSymbolicLink()) {
        throw new Error(`${label} must not be a symbolic link`);
      }
    }
    const relativeBlobPath = relative(
      realpathSync(this.rootDirectory),
      realpathSync(this.blobDirectory),
    );
    if (
      relativeBlobPath === ".." ||
      relativeBlobPath.startsWith(`..${sep}`) ||
      isAbsolute(relativeBlobPath)
    ) {
      throw new Error("Telic blob path escapes the state directory");
    }
  }
}
