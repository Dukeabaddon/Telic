import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { TelicService } from "../packages/mcp/src/service.js";

const services: TelicService[] = [];

afterEach(() => {
  for (const service of services.splice(0)) service.close();
});

function markTerminal(service: TelicService, runId: string): void {
  const run = service.getRun(runId).run;
  service.ledger.transitionWithoutArtifact(
    run.version,
    {
      ...run,
      status: "completed",
      phase: "agent_5_report",
      version: run.version + 1,
      updatedAt: new Date().toISOString(),
    },
    {
      actor: "controller",
      eventType: "run_terminated",
      phase: "agent_5_report",
      decisionSummary: "Prior run marked terminal for lineage replay test.",
    },
  );
}

describe("CAGT loop 7 conformance", () => {
  it("preserves lineage_linked in MCP trace export", () => {
    const repositoryRoot = mkdtempSync(join(tmpdir(), "telic-cagt-loop7-"));
    mkdirSync(join(repositoryRoot, "src"), { recursive: true });
    writeFileSync(join(repositoryRoot, "src", "index.ts"), "export const x = 1;\n");
    const service = new TelicService({
      repositoryRoot,
      stateDirectory: mkdtempSync(join(tmpdir(), "telic-cagt-loop7-state-")),
    });
    services.push(service);
    const prior = service.startRun({
      originalRequest: "What does src/index.ts export?",
      mode: "report_only",
      hostCapabilities: ["repository.read"],
      authorizationGranted: ["repository.read"],
    });
    markTerminal(service, prior.run.runId);

    const linked = service.startRun({
      originalRequest: "Fix typo in src/index.ts: x→y",
      mode: "fix_only",
      priorRunId: prior.run.runId,
      hostCapabilities: ["repository.read", "repository.write"],
      authorizationGranted: ["repository.read", "repository.write"],
    });
    expect(linked.run.priorRunId).toBe(prior.run.runId);

    const mcpTrace = service.getTrace(linked.run.runId);
    expect(
      mcpTrace.some((event) => event.eventType === "lineage_linked"),
    ).toBe(true);
  });

  it("returns digest-only forensic replay steps without artifact bodies", () => {
    const service = new TelicService({
      repositoryRoot: mkdtempSync(join(tmpdir(), "telic-cagt-loop7-replay-")),
      stateDirectory: mkdtempSync(
        join(tmpdir(), "telic-cagt-loop7-replay-state-"),
      ),
    });
    services.push(service);
    const started = service.startRun({
      originalRequest: "Forensic deep inspection required.",
      mode: "analyze_and_fix",
      topologyOverride: "forensic",
      hostCapabilities: ["repository.read"],
      authorizationGranted: ["repository.read"],
    });
    const report = service.replayRun(started.run.runId);
    expect(report.topology).toBe("forensic");
    expect(report.degraded).toBeUndefined();
    expect(report.steps.length).toBeGreaterThan(0);
    for (const step of report.steps) {
      expect(step).not.toHaveProperty("body");
      expect(step.artifactRef).toMatch(/^artifact:\/\//);
    }
  });
});
