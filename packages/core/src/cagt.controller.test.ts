import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { RunController } from "./controller.js";
import { SqliteLedger } from "./ledger.js";

const ledgers: SqliteLedger[] = [];

function setup() {
  const repository = mkdtempSync(join(tmpdir(), "telic-cagt-repo-"));
  const ledger = new SqliteLedger(join(repository, ".telic"));
  ledgers.push(ledger);
  return { controller: new RunController(ledger), ledger, repository };
}

afterEach(() => {
  for (const ledger of ledgers.splice(0)) ledger.close();
});

describe("CAGT controller integration", () => {
  it("startRun persists micro topology for short report_only requests", () => {
    const { controller, repository } = setup();
    const started = controller.startRun({
      repositoryRoot: repository,
      originalRequest: "What exports from src/index.ts?",
      requestedMode: "report_only",
      host: {
        name: "test",
        nativeSubagents: "unavailable",
        capabilities: ["repository.read"],
      },
      authorization: { granted: ["repository.read"], denied: [] },
    });
    expect(started.run.topology).toBe("micro");
  });

  it("getNextAction uses spot instruction ref during micro review", () => {
    const { controller, repository } = setup();
    const started = controller.startRun({
      repositoryRoot: repository,
      originalRequest: "What exports from src/index.ts?",
      requestedMode: "report_only",
      host: {
        name: "test",
        nativeSubagents: "unavailable",
        capabilities: ["repository.read"],
      },
      authorization: { granted: ["repository.read"], denied: [] },
    });
    const reviewRun = {
      ...started.run,
      phase: "agent_3_review" as const,
      version: started.run.version + 1,
    };
    const ledger = controller["ledger"];
    ledger.transitionWithoutArtifact(started.run.version, reviewRun, {
      actor: "test",
      eventType: "phase_submitted",
      phase: "agent_3_review",
      decisionSummary: "test setup",
    });
    const action = controller.getNextAction(started.run.runId);
    if (action.kind !== "phase") throw new Error("phase expected");
    expect(action.instructionRef).toBe(
      "artifact://system/roles/quality_controller-spot-v1",
    );
  });
});
