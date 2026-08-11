import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { TelicService } from "./service.js";

const services: TelicService[] = [];

function service(): TelicService {
  const root = mkdtempSync(join(tmpdir(), "telic-replay-mcp-"));
  const created = new TelicService({
    repositoryRoot: root,
    stateDirectory: mkdtempSync(join(tmpdir(), "telic-replay-mcp-state-")),
  });
  services.push(created);
  return created;
}

afterEach(() => {
  for (const active of services.splice(0)) active.close();
});

describe("telic_replay_run MCP service", () => {
  it("returns degraded replay for micro topology", () => {
    const active = service();
    const started = active.startRun({
      originalRequest: "Summarize exports only.",
      mode: "report_only",
      hostCapabilities: ["repository.read"],
      authorizationGranted: ["repository.read"],
    });
    expect(started.run.topology).toBe("micro");
    const report = active.replayRun(started.run.runId);
    expect(report).toMatchObject({
      degraded: true,
      reason: "micro_topology",
    });
  });

  it("returns digest steps without artifact bodies for forensic runs", () => {
    const active = service();
    const started = active.startRun({
      originalRequest: "Forensic deep inspection required.",
      mode: "analyze_and_fix",
      topologyOverride: "forensic",
      hostCapabilities: ["repository.read"],
      authorizationGranted: ["repository.read"],
    });
    const report = active.replayRun(started.run.runId);
    expect(report.topology).toBe("forensic");
    expect(report.degraded).toBeUndefined();
    for (const step of report.steps) {
      expect(step).not.toHaveProperty("body");
      expect(step.artifactRef).toMatch(/^artifact:\/\//);
    }
  });

  it("records broker_decision trace on denied tool check", () => {
    const active = service();
    const started = active.startRun({
      originalRequest: "Inspect repository only.",
      mode: "report_only",
      hostCapabilities: ["repository.read"],
      authorizationGranted: ["repository.read"],
    });
    const decision = active.checkToolAction({
      runId: started.run.runId,
      actionId: started.nextAction.id,
      expectedRunVersion: started.run.version,
      capability: "repository.write",
      target: "src/foo.ts",
    });
    expect(decision.allowed).toBe(false);
    const trace = active.ledger.listTrace(started.run.runId);
    expect(
      trace.some(
        (event) =>
          event.eventType === "broker_decision" &&
          event.permissionDecision?.decision === "deny",
      ),
    ).toBe(true);
  });
});
