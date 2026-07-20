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
import { Worker } from "node:worker_threads";

import { afterEach, describe, expect, it } from "vitest";

import { SqliteLedger } from "./ledger.js";
import type { ArtifactSubmission, RunRecord } from "./types.js";

const ledgers: SqliteLedger[] = [];

type WorkerResult =
  | { kind: "result"; ok: true; artifact: unknown }
  | { kind: "result"; ok: false; error: string };

function workerMessage<T>(worker: Worker, kind: string): Promise<T> {
  return new Promise<T>((resolvePromise, rejectPromise) => {
    const onMessage = (message: { kind?: unknown }): void => {
      if (message.kind !== kind) return;
      cleanup();
      resolvePromise(message as T);
    };
    const onError = (error: Error): void => {
      cleanup();
      rejectPromise(error);
    };
    const onExit = (code: number): void => {
      cleanup();
      rejectPromise(
        new Error(
          `Supporting worker exited with code ${String(code)} before ${kind}`,
        ),
      );
    };
    const cleanup = (): void => {
      worker.off("message", onMessage);
      worker.off("error", onError);
      worker.off("exit", onExit);
    };
    worker.on("message", onMessage);
    worker.on("error", onError);
    worker.on("exit", onExit);
  });
}

async function runBlockedWorkers(
  databasePath: string,
  workerData: readonly Record<string, unknown>[],
): Promise<WorkerResult[]> {
  const workerUrl = new URL(
    "../../../test/helpers/supporting-artifact-worker.ts",
    import.meta.url,
  );
  const workers = workerData.map(
    (data) =>
      new Worker(workerUrl, {
        workerData: data,
        execArgv: ["--import", "tsx"],
      }),
  );
  await Promise.all(
    workers.map(async (worker) => workerMessage(worker, "ready")),
  );
  const blocker = new DatabaseSync(databasePath);
  blocker.exec("PRAGMA busy_timeout = 5000; BEGIN IMMEDIATE;");
  let locked = true;
  try {
    const starting = workers.map(async (worker) =>
      workerMessage(worker, "starting"),
    );
    const results = workers.map(async (worker) =>
      workerMessage<WorkerResult>(worker, "result"),
    );
    for (const worker of workers) worker.postMessage("go");
    await Promise.all(starting);
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
    blocker.exec("COMMIT");
    locked = false;
    return await Promise.all(results);
  } finally {
    if (locked) blocker.exec("ROLLBACK");
    blocker.close();
  }
}

function createRun(): RunRecord {
  return {
    runId: "00000000-0000-4000-8000-000000000001",
    schemaVersion: "1.0",
    repositoryRoot: "/repo",
    requestedMode: "analyze_only",
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
    const results = await runBlockedWorkers(ledger.databasePath, [
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
    ]);

    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(
      results.find((result) => !result.ok && /conflicts/.test(result.error)),
    ).toBeDefined();
    expect(ledger.listArtifacts(run.runId)).toHaveLength(1);
    expect(ledger.listTrace(run.runId)).toHaveLength(2);
  });
});
