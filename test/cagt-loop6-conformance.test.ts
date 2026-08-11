import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { TelicService } from "../packages/mcp/src/service.js";

const services: TelicService[] = [];

afterEach(() => {
  for (const service of services.splice(0)) service.close();
});

describe("CAGT loop 6 conformance", () => {
  it("records broker_decision and preserves it in MCP trace export", () => {
    const service = new TelicService({
      repositoryRoot: mkdtempSync(join(tmpdir(), "telic-cagt-loop6-")),
      stateDirectory: mkdtempSync(join(tmpdir(), "telic-cagt-loop6-state-")),
    });
    services.push(service);
    const started = service.startRun({
      originalRequest: "Inspect repository only.",
      mode: "report_only",
      hostCapabilities: ["repository.read"],
      authorizationGranted: ["repository.read"],
    });
    const decision = service.checkToolAction({
      runId: started.run.runId,
      actionId: started.nextAction.id,
      expectedRunVersion: started.run.version,
      capability: "repository.write",
      target: "src/foo.ts",
    });
    expect(decision.allowed).toBe(false);
    expect(decision.reasonCode).toBe("policy_denied");

    const ledgerEvents = service.ledger.listTrace(started.run.runId);
    expect(
      ledgerEvents.some((event) => event.eventType === "broker_decision"),
    ).toBe(true);

    const mcpTrace = service.getTrace(started.run.runId);
    const brokerEvent = mcpTrace.find(
      (event) => event.eventType === "broker_decision",
    );
    expect(brokerEvent).toBeDefined();
    expect(brokerEvent?.permissionDecision?.decision).toBe("deny");
  });

  it("allows scoped write when policy grants the target path", () => {
    const service = new TelicService({
      repositoryRoot: mkdtempSync(join(tmpdir(), "telic-cagt-loop6-allow-")),
      stateDirectory: mkdtempSync(
        join(tmpdir(), "telic-cagt-loop6-allow-state-"),
      ),
    });
    services.push(service);
    const started = service.startRun({
      originalRequest: "Fix typo in src/foo.ts: bar→baz",
      mode: "fix_only",
      hostCapabilities: ["repository.read", "repository.write"],
      authorizationGranted: ["repository.read", "repository.write"],
    });
    const decision = service.checkToolAction({
      runId: started.run.runId,
      actionId: started.nextAction.id,
      expectedRunVersion: started.run.version,
      capability: "repository.write",
      target: "src/foo.ts",
    });
    expect(decision.allowed).toBe(true);
    expect(decision.reasonCode).toBe("allowed");
  });
});
