import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { RunController } from "./controller.js";
import { SqliteLedger } from "./ledger.js";

const ledgers: SqliteLedger[] = [];

function setup(): {
  controller: RunController;
  ledger: SqliteLedger;
  repository: string;
} {
  const repository = mkdtempSync(join(tmpdir(), "telic-repo-"));
  const ledger = new SqliteLedger(join(repository, ".telic"));
  ledgers.push(ledger);
  return { controller: new RunController(ledger), ledger, repository };
}

afterEach(() => {
  for (const ledger of ledgers.splice(0)) ledger.close();
});

describe("RunController", () => {
  it("stores the exact request and reveals only phase-relevant artifact refs", () => {
    const { controller, ledger, repository } = setup();
    const started = controller.startRun({
      repositoryRoot: repository,
      originalRequest: "Investigate why the project is not talking.",
      requestedMode: "analyze_only",
      host: {
        name: "codex",
        nativeSubagents: "unavailable",
        capabilities: ["repository.read", "runtime.inspect"],
      },
      authorization: {
        granted: ["repository.read", "runtime.inspect"],
        denied: [],
      },
    });
    if (started.nextAction.kind !== "phase") throw new Error("phase expected");
    expect(started.nextAction.phase).toBe("context_discovery");
    expect(started.nextAction.effectivePermissions).toMatchObject({
      repository: { read: ["**"], write: [] },
      runtime: { inspect: [] },
    });
    const request = ledger
      .listArtifacts(started.run.runId)
      .find((item) => item.type === "UserMessage");
    expect(request).toBeDefined();
    expect(
      ledger.getArtifact(started.run.runId, request!.id)?.body,
    ).toMatchObject({
      content: "Investigate why the project is not talking.",
    });

    const submitted = controller.submitArtifact({
      id: "11111111-1111-4111-8111-111111111111",
      runId: started.run.runId,
      type: "ContextManifest",
      schemaVersion: "1.0",
      producer: "controller",
      body: {
        schemaVersion: "1.0",
        id: "11111111-1111-4111-8111-111111111111",
        runId: started.run.runId,
        selected_sources: [],
      },
    });
    if (submitted.nextAction.kind !== "phase")
      throw new Error("phase expected");
    expect(submitted.nextAction?.phase).toBe("agent_1_frame");
    expect(submitted.nextAction?.inputRefs).toHaveLength(3);
  });

  it("uses clarification without granting a fresh retry budget", () => {
    const { controller, repository } = setup();
    const started = controller.startRun({
      repositoryRoot: repository,
      originalRequest: "Change the destination account.",
      requestedMode: "analyze_and_fix",
      host: {
        name: "codex",
        nativeSubagents: "available",
        capabilities: ["repository.read"],
      },
      authorization: {
        granted: ["repository.read"],
        denied: ["external.write"],
      },
      budgets: { promptRevisions: 0, postExecutionRemediations: 0 },
    });
    if (started.nextAction.kind !== "phase") throw new Error("phase expected");
    const inspectedRef = started.nextAction.inputRefs[0]!;
    const paused = controller.submitArtifact({
      id: "22222222-2222-4222-8222-222222222222",
      runId: started.run.runId,
      type: "ClarificationRequest",
      schemaVersion: "1.0",
      producer: "controller",
      body: {
        schemaVersion: "1.0",
        id: "22222222-2222-4222-8222-222222222222",
        runId: started.run.runId,
        question: "Which account?",
        reason: "user_owned_materially_divergent",
        divergence: "Different accounts change the external recipient.",
        evidenceInspected: [inspectedRef],
        blockedBoundary: "user_owned_recipient",
        responseConstraints: "Choose one typed account identifier.",
        responseChoices: [
          {
            id: "account-a",
            label: "Account A",
            consequence: "Continue with the existing Account A scope.",
            authorityEffect: "within_current_authority",
            runEffect: "resume",
          },
          {
            id: "cancel",
            label: "Cancel",
            consequence: "Stop without performing the external action.",
            authorityEffect: "within_current_authority",
            runEffect: "cancel",
          },
        ],
        permissionExpansionRequired: false,
        rationaleSummary: "The account choice is owned by the user.",
      },
    });
    expect(paused.run.status).toBe("awaiting_clarification");
    expect(paused.nextAction.kind).toBe("clarification");
    const resumed = controller.answerClarification(
      started.run.runId,
      "account-a",
    );
    expect(resumed.run.budgets).toEqual({
      promptRevisionsRemaining: 0,
      postExecutionRemediationsRemaining: 0,
    });
    expect(resumed.nextAction.phase).toBe("context_discovery");
  });

  it("rejects missing and cross-run artifact references", () => {
    const { controller, repository } = setup();
    const started = controller.startRun({
      repositoryRoot: repository,
      originalRequest: "Inspect this repository.",
      requestedMode: "analyze_only",
      host: {
        name: "codex",
        nativeSubagents: "unavailable",
        capabilities: ["repository.read"],
      },
      authorization: { granted: ["repository.read"], denied: [] },
    });
    controller.submitArtifact({
      id: "context-1",
      runId: started.run.runId,
      type: "ContextManifest",
      schemaVersion: "1.0",
      producer: "controller",
      body: {
        schemaVersion: "1.0",
        id: "context-1",
        runId: started.run.runId,
      },
    });
    expect(() =>
      controller.submitArtifact({
        id: "frame-1",
        runId: started.run.runId,
        type: "ProblemFrame",
        schemaVersion: "1.0",
        producer: "scenario_author",
        body: {
          schemaVersion: "1.0",
          id: "frame-1",
          runId: started.run.runId,
          intentMode: "analyze_only",
          originalRequestRef: `artifact://${started.run.runId}/missing`,
        },
      }),
    ).toThrow(/does not exist/);
    expect(() =>
      controller.submitArtifact({
        id: "frame-2",
        runId: started.run.runId,
        type: "ProblemFrame",
        schemaVersion: "1.0",
        producer: "scenario_author",
        body: {
          schemaVersion: "1.0",
          id: "frame-2",
          runId: started.run.runId,
          intentMode: "analyze_only",
          originalRequestRef: "artifact://another-run/request",
        },
      }),
    ).toThrow(/Cross-run/);
  });

  it("validates start input and cancellation lifecycle", () => {
    const { controller, repository } = setup();
    const base = {
      repositoryRoot: repository,
      originalRequest: "Inspect this repository.",
      requestedMode: "analyze_only" as const,
      host: {
        name: "codex",
        nativeSubagents: "unavailable" as const,
        capabilities: ["repository.read"],
      },
      authorization: { granted: ["repository.read"], denied: [] },
    };
    expect(() =>
      controller.startRun({ ...base, originalRequest: " " }),
    ).toThrow(/required/);
    expect(() =>
      controller.startRun({ ...base, originalRequest: "x".repeat(32_769) }),
    ).toThrow(/exceeds/);
    expect(() =>
      controller.startRun({ ...base, host: { ...base.host, name: " " } }),
    ).toThrow(/Host name/);

    const started = controller.startRun(base);
    const cancelled = controller.cancelRun(started.run.runId);
    expect(cancelled.status).toBe("cancelled");
    expect(controller.cancelRun(started.run.runId)).toEqual(cancelled);
    expect(controller.getNextAction(started.run.runId)).toMatchObject({
      kind: "terminal",
      status: "cancelled",
    });
  });

  it("persists explicit validated network-read domains", () => {
    const { controller, ledger, repository } = setup();
    const input = {
      repositoryRoot: repository,
      originalRequest: "Inspect the public API response.",
      requestedMode: "analyze_only" as const,
      host: {
        name: "codex",
        nativeSubagents: "unavailable" as const,
        capabilities: ["network.read"],
      },
      authorization: {
        granted: ["network.read"],
        denied: [],
        networkReadDomains: ["API.Example.com"],
      },
    };

    const started = controller.startRun(input);
    expect(
      ledger.getArtifact(started.run.runId, started.run.runId)?.body,
    ).toMatchObject({
      authorization: {
        granted: { network: { readDomains: ["api.example.com"] } },
      },
    });

    expect(() =>
      controller.startRun({
        ...input,
        authorization: {
          ...input.authorization,
          networkReadDomains: ["https://api.example.com/path"],
        },
      }),
    ).toThrow(/network read domains/i);
    expect(() =>
      controller.startRun({
        ...input,
        authorization: {
          granted: [],
          denied: [],
          networkReadDomains: ["api.example.com"],
        },
      }),
    ).toThrow(/require granted network\.read/i);
  });

  it("validates clarification response bounds", () => {
    const { controller, repository } = setup();
    const started = controller.startRun({
      repositoryRoot: repository,
      originalRequest: "Inspect this repository.",
      requestedMode: "analyze_only",
      host: {
        name: "codex",
        nativeSubagents: "unavailable",
        capabilities: ["repository.read"],
      },
      authorization: { granted: ["repository.read"], denied: [] },
    });
    expect(() =>
      controller.answerClarification(started.run.runId, " "),
    ).toThrow(/required/);
    expect(() =>
      controller.answerClarification(started.run.runId, "x".repeat(32_769)),
    ).toThrow(/exceeds/);
  });
});
