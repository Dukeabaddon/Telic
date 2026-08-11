import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { RunController, SqliteLedger } from "../packages/core/src/index.js";
import {
  isArtifactType,
  parseArtifactBody,
} from "../packages/protocol/src/index.js";

const ledgers: SqliteLedger[] = [];

afterEach(() => {
  for (const ledger of ledgers.splice(0)) ledger.close();
});

function createTerminalPriorRun(repositoryRoot: string): {
  ledger: SqliteLedger;
  controller: RunController;
  priorRunId: string;
} {
  const ledger = new SqliteLedger(
    mkdtempSync(join(tmpdir(), "telic-loop4-ledger-")),
  );
  ledgers.push(ledger);
  const controller = new RunController(ledger, (type, body) => {
    if (!isArtifactType(type))
      throw new Error(`Unsupported artifact type: ${type}`);
    return parseArtifactBody(type, body);
  });
  const started = controller.startRun({
    repositoryRoot,
    originalRequest: "What does src/index.ts export?",
    requestedMode: "report_only",
    host: {
      name: "loop4",
      nativeSubagents: "unavailable",
      capabilities: ["repository.read"],
    },
    authorization: { granted: ["repository.read"], denied: [] },
  });
  const now = new Date().toISOString();
  ledger.transitionWithoutArtifact(
    started.run.version,
    {
      ...started.run,
      status: "completed",
      phase: "agent_5_report",
      version: started.run.version + 1,
      updatedAt: now,
    },
    {
      actor: "controller",
      eventType: "run_terminated",
      phase: "agent_5_report",
      decisionSummary: "Prior run marked terminal for lineage test.",
    },
  );
  return {
    ledger,
    controller,
    priorRunId: started.run.runId,
  };
}

describe("CAGT loop 4 conformance", () => {
  it("records lineage_linked when priorRunId is provided", () => {
    const repositoryRoot = mkdtempSync(join(tmpdir(), "telic-cagt-loop4-"));
    mkdirSync(join(repositoryRoot, "src"), { recursive: true });
    writeFileSync(
      join(repositoryRoot, "src", "index.ts"),
      "export const x = 1;\n",
    );
    const { controller, ledger, priorRunId } =
      createTerminalPriorRun(repositoryRoot);

    const linked = controller.startRun({
      repositoryRoot,
      originalRequest: "Fix typo in src/index.ts: x→y",
      requestedMode: "fix_only",
      priorRunId,
      host: {
        name: "loop4",
        nativeSubagents: "unavailable",
        capabilities: ["repository.read", "repository.write"],
      },
      authorization: {
        granted: ["repository.read", "repository.write"],
        denied: [],
      },
    });

    expect(linked.run.priorRunId).toBe(priorRunId);
    const events = ledger.listTrace(linked.run.runId);
    expect(events.some((event) => event.eventType === "lineage_linked")).toBe(
      true,
    );
  });

  it("rejects priorRunId from a different repository root", () => {
    const rootA = mkdtempSync(join(tmpdir(), "telic-cagt-loop4-a-"));
    const rootB = mkdtempSync(join(tmpdir(), "telic-cagt-loop4-b-"));
    const { controller, priorRunId } = createTerminalPriorRun(rootA);
    const ledgerB = new SqliteLedger(
      mkdtempSync(join(tmpdir(), "telic-cagt-loop4-ledger-b-")),
    );
    ledgers.push(ledgerB);
    const controllerB = new RunController(ledgerB, (type, body) => {
      if (!isArtifactType(type))
        throw new Error(`Unsupported artifact type: ${type}`);
      return parseArtifactBody(type, body);
    });

    expect(() =>
      controllerB.startRun({
        repositoryRoot: rootB,
        originalRequest: "Question B",
        requestedMode: "report_only",
        priorRunId,
        host: {
          name: "loop4",
          nativeSubagents: "unavailable",
          capabilities: ["repository.read"],
        },
        authorization: { granted: ["repository.read"], denied: [] },
      }),
    ).toThrow(/does not exist/);
  });
});
