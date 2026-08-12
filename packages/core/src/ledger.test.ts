import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { afterEach, describe, expect, it } from "vitest";

import { runBlockedWorkers } from "../../../test/helpers/blocked-sqlite-workers.js";
import { SqliteLedger } from "./ledger.js";
import type { ArtifactSubmission, RunRecord } from "./types.js";

const ledgers: SqliteLedger[] = [];

const supportingWorkerUrl = new URL(
  "../../../test/helpers/supporting-artifact-worker.ts",
  import.meta.url,
);

function createRun(): RunRecord {
  return {
    runId: "00000000-0000-4000-8000-000000000001",
    schemaVersion: "1.0",
    repositoryRoot: "/repo",
    requestedMode: "analyze_only",
    topology: "standard",
    escalationCount: 0,
    priorRunId: null,
    status: "running",
    phase: "context_grounding",
    resumePhase: null,
    version: 1,
    budgets: {
      promptRevisionsRemaining: 1,
      postExecutionRemediationsRemaining: 1,
    },
    outcomeHint: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function createLedger(): SqliteLedger {
  const ledger = new SqliteLedger(mkdtempSync(join(tmpdir(), "telic-ledger-")));
  ledgers.push(ledger);
  return ledger;
}

afterEach(() => {
  for (const ledger of ledgers.splice(0)) ledger.close();
});

it("persists topology across applySubmission", () => {
  const ledger = createLedger();
  const run = {
    ...createRun(),
    topology: "micro" as const,
    phase: "agent_3_review" as const,
  };
  const request: ArtifactSubmission = {
    id: "request-1",
    runId: run.runId,
    type: "UserMessage",
    schemaVersion: "1.0",
    producer: "user",
    body: { content: "micro request" },
  };
  ledger.createRun(run, [request]);
  const nextRun = {
    ...run,
    topology: "standard" as const,
    phase: "agent_1_review" as const,
    version: 2,
    updatedAt: "2026-01-02T00:00:00.000Z",
  };
  ledger.applySubmission(
    1,
    nextRun,
    {
      id: "quality-review-01",
      runId: run.runId,
      type: "QualityReview",
      schemaVersion: "1.0",
      producer: "quality_controller",
      body: { decision: "remediate" },
    },
    {
      actor: "quality_controller",
      eventType: "phase_submitted",
      phase: "agent_3_review",
      decisionSummary: "MICRO_SPOT_REMEDIATE",
    },
  );
  expect(ledger.requireRun(run.runId).topology).toBe("standard");
});

describe("SQLite ledger and content-addressed artifacts", () => {
  it("round-trips an immutable artifact and verifies its digest", () => {
    const ledger = createLedger();
    const run = createRun();
    const request: ArtifactSubmission = {
      id: "request-1",
      runId: run.runId,
      type: "UserMessage",
      schemaVersion: "1.0",
      producer: "user",
      body: { content: "unchanged request" },
    };
    ledger.createRun(run, [request]);
    expect(ledger.getArtifact(run.runId, request.id)?.body).toEqual(
      request.body,
    );
    expect(ledger.listTrace(run.runId)).toHaveLength(1);
    if (process.platform !== "win32") {
      expect(statSync(ledger.databasePath).mode & 0o777).toBe(0o600);
    } else {
      expect(statSync(ledger.databasePath).isFile()).toBe(true);
    }
  });

  it("detects content-addressed blob tampering", () => {
    const ledger = createLedger();
    const run = createRun();
    const request: ArtifactSubmission = {
      id: "request-1",
      runId: run.runId,
      type: "UserMessage",
      schemaVersion: "1.0",
      producer: "user",
      body: { content: "trusted" },
    };
    ledger.createRun(run, [request]);
    const stored = ledger.listArtifacts(run.runId)[0];
    expect(stored).toBeDefined();
    const path = join(
      ledger.blobDirectory,
      stored!.sha256.slice("sha256:".length, "sha256:".length + 2),
      stored!.sha256.slice("sha256:".length + 2),
    );
    chmodSync(path, 0o600);
    writeFileSync(path, '{"content":"tampered"}');
    expect(() => ledger.getArtifact(run.runId, request.id)).toThrow(
      /integrity/,
    );
    expect(readFileSync(path, "utf8")).toContain("tampered");
  });

  it("rejects stale optimistic transitions", () => {
    const ledger = createLedger();
    const run = createRun();
    ledger.createRun(run, []);
    const artifact: ArtifactSubmission = {
      id: "context-1",
      runId: run.runId,
      type: "ContextManifest",
      schemaVersion: "1.0",
      producer: "controller",
      body: {},
    };
    expect(() =>
      ledger.applySubmission(0, { ...run, version: 2 }, artifact, {
        actor: "controller",
        eventType: "phase_submitted",
        phase: run.phase,
        decisionSummary: "test",
      }),
    ).toThrow(/Concurrent/);
    expect(ledger.listArtifacts(run.runId)).toEqual([]);
  });

  it("scopes ordinary artifact identifiers to their run", () => {
    const ledger = createLedger();
    const first = createRun();
    const second = {
      ...createRun(),
      runId: "00000000-0000-4000-8000-000000000002",
    };
    const body = { content: "same identifier, separate run" };
    ledger.createRun(first, [
      {
        id: "frame-01",
        runId: first.runId,
        type: "ProblemFrame",
        schemaVersion: "1.0",
        producer: "scenario_author",
        body,
      },
    ]);
    ledger.createRun(second, [
      {
        id: "frame-01",
        runId: second.runId,
        type: "ProblemFrame",
        schemaVersion: "1.0",
        producer: "scenario_author",
        body,
      },
    ]);
    expect(ledger.getArtifact(first.runId, "frame-01")).not.toBeNull();
    expect(ledger.getArtifact(second.runId, "frame-01")).not.toBeNull();
  });

  it("rejects a symlinked state directory", () => {
    const parent = mkdtempSync(join(tmpdir(), "telic-ledger-link-"));
    const outside = mkdtempSync(join(tmpdir(), "telic-ledger-outside-"));
    const link = join(parent, "state");
    symlinkSync(outside, link, "dir");
    expect(() => new SqliteLedger(link)).toThrow(/symbolic link/);
  });

  it("rejects a symlinked intermediate blob directory", () => {
    const parent = mkdtempSync(join(tmpdir(), "telic-ledger-blob-link-"));
    const state = join(parent, "state");
    const outside = mkdtempSync(join(tmpdir(), "telic-ledger-blob-outside-"));
    mkdirSync(state, { mode: 0o700 });
    symlinkSync(outside, join(state, "blobs"), "dir");

    expect(() => new SqliteLedger(state)).toThrow(/blob root|symbolic link/i);
  });

  it("makes identical supporting-artifact retries idempotent", () => {
    const ledger = createLedger();
    const run = createRun();
    ledger.createRun(run, []);
    const evidence: ArtifactSubmission = {
      id: "evidence-01",
      runId: run.runId,
      type: "Evidence",
      schemaVersion: "1.0",
      producer: "executor",
      sourceRefs: [],
      body: { content: "bounded result" },
    };
    const event = {
      actor: "executor",
      eventType: "evidence_captured",
      decisionSummary: "Stored bounded evidence.",
    };
    const first = ledger.appendSupportingArtifact(evidence, event);
    const replay = ledger.appendSupportingArtifact(evidence, event);
    expect(replay).toEqual(first);
    expect(ledger.listArtifacts(run.runId)).toHaveLength(1);
    expect(ledger.listTrace(run.runId)).toHaveLength(2);

    expect(() =>
      ledger.appendSupportingArtifact(
        { ...evidence, body: { content: "conflicting result" } },
        event,
      ),
    ).toThrow(/conflicts with immutable artifact/);
  });

  it("makes simultaneous identical supporting retries idempotent across connections", async () => {
    const ledger = createLedger();
    const run = createRun();
    ledger.createRun(run, []);
    const artifact: ArtifactSubmission = {
      id: "concurrent-evidence",
      runId: run.runId,
      type: "Evidence",
      schemaVersion: "1.0",
      producer: "executor",
      sourceRefs: [],
      body: { content: "same bounded result" },
    };
    const event = {
      actor: "executor",
      eventType: "evidence_captured",
      decisionSummary: "Stored bounded evidence.",
    };
    const results = await runBlockedWorkers(
      supportingWorkerUrl,
      ledger.databasePath,
      Array.from({ length: 2 }, () => ({
        kind: "ledger",
        stateDirectory: ledger.rootDirectory,
        artifact,
        event,
      })),
    );

    expect(results.every((result) => result.ok)).toBe(true);
    expect(ledger.listArtifacts(run.runId)).toHaveLength(1);
    expect(ledger.listTrace(run.runId)).toHaveLength(2);
  });

  it("reports a deterministic conflict for simultaneous divergent retries", async () => {
    const ledger = createLedger();
    const run = createRun();
    ledger.createRun(run, []);
    const base: ArtifactSubmission = {
      id: "concurrent-conflict",
      runId: run.runId,
      type: "Evidence",
      schemaVersion: "1.0",
      producer: "executor",
      sourceRefs: [],
      body: { content: "first bounded result" },
    };
    const event = {
      actor: "executor",
      eventType: "evidence_captured",
      decisionSummary: "Stored bounded evidence.",
    };
    const results = await runBlockedWorkers(
      supportingWorkerUrl,
      ledger.databasePath,
      [
        {
          kind: "ledger",
          stateDirectory: ledger.rootDirectory,
          artifact: base,
          event,
        },
        {
          kind: "ledger",
          stateDirectory: ledger.rootDirectory,
          artifact: { ...base, body: { content: "second bounded result" } },
          event,
        },
      ],
    );

    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(
      results.find((result) => !result.ok && /conflicts/.test(result.error)),
    ).toBeDefined();
    expect(ledger.listArtifacts(run.runId)).toHaveLength(1);
    expect(ledger.listTrace(run.runId)).toHaveLength(2);
  });

  it("migrates legacy runs tables missing escalation_count", () => {
    const root = mkdtempSync(join(tmpdir(), "telic-ledger-migrate-"));
    const databasePath = join(root, "ledger.sqlite3");
    const database = new DatabaseSync(databasePath);
    database.exec(`
      CREATE TABLE runs (
        run_id TEXT PRIMARY KEY,
        schema_version TEXT NOT NULL,
        repository_root TEXT NOT NULL,
        requested_mode TEXT NOT NULL,
        topology TEXT NOT NULL DEFAULT 'standard',
        status TEXT NOT NULL,
        phase TEXT NOT NULL,
        resume_phase TEXT,
        version INTEGER NOT NULL,
        prompt_revisions_remaining INTEGER NOT NULL,
        remediations_remaining INTEGER NOT NULL,
        outcome_hint TEXT,
        prior_run_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE artifacts (
        artifact_id TEXT NOT NULL,
        run_id TEXT NOT NULL,
        type TEXT NOT NULL,
        schema_version TEXT NOT NULL,
        producer TEXT NOT NULL,
        sha256 TEXT NOT NULL,
        source_refs_json TEXT NOT NULL,
        redaction TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY(run_id, artifact_id)
      );
      CREATE TABLE trace_events (
        event_id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
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
      );
      INSERT INTO runs (
        run_id, schema_version, repository_root, requested_mode, topology, status, phase,
        resume_phase, version, prompt_revisions_remaining, remediations_remaining,
        outcome_hint, prior_run_id, created_at, updated_at
      ) VALUES (
        'legacy-run', '1.0', '/repo', 'report_only', 'standard', 'running', 'context_grounding',
        NULL, 1, 1, 1, NULL, NULL, '2026-07-15T10:00:00Z', '2026-07-15T10:00:00Z'
      );
    `);
    database.close();

    const ledger = new SqliteLedger(root);
    ledgers.push(ledger);
    const migrated = ledger.requireRun("legacy-run");
    expect(migrated.escalationCount).toBe(0);

    const now = "2026-07-15T10:01:00Z";
    ledger.transitionWithoutArtifact(
      migrated.version,
      {
        ...migrated,
        phase: "agent_1_frame",
        version: migrated.version + 1,
        updatedAt: now,
      },
      {
        actor: "controller",
        eventType: "transition_allowed",
        phase: "context_grounding",
        decisionSummary:
          "Migrated legacy row accepts escalation_count updates.",
      },
    );
    expect(ledger.requireRun("legacy-run").phase).toBe("agent_1_frame");
  });
});
