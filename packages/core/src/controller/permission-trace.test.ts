import { describe, expect, it } from "vitest";

import { emptyPermissionSet } from "../permissions.js";
import type { RunRecord } from "../types.js";
import {
  PermissionAuthorizationError,
  buildWorkResultPermissionEvents,
  tracePermissionDecision,
} from "./permission-trace.js";

function runRecord(overrides: Partial<RunRecord> = {}): RunRecord {
  return {
    runId: "run-1",
    phase: "agent_4_execute",
    requestedMode: "analyze_and_fix",
    repositoryRoot: "/workspace/project",
    budgets: {
      promptRevisionsRemaining: 1,
      postExecutionRemediationsRemaining: 1,
      escalationsRemaining: 1,
    },
    ...overrides,
  } as RunRecord;
}

describe("tracePermissionDecision", () => {
  it("records allow decisions with capability and scope", () => {
    const decision = tracePermissionDecision(
      { capability: "repository.read", target: "src/app.ts" },
      true,
      ["artifact://run-1/contract-1"],
      "Allowed repository.read.",
    );
    expect(decision).toEqual({
      decision: "allow",
      capability: "repository.read",
      scope: "src/app.ts",
      policyRefs: ["artifact://run-1/contract-1"],
      rationaleSummary: "Allowed repository.read.",
    });
  });

  it("normalizes network targets to hostnames", () => {
    const decision = tracePermissionDecision(
      { capability: "network.read", target: "https://Example.COM/path" },
      false,
      [],
      "Denied.",
    );
    expect(decision.scope).toBe("example.com");
    expect(decision.decision).toBe("deny");
  });

  it("marks invalid network targets explicitly", () => {
    const decision = tracePermissionDecision(
      { capability: "external.write", target: "not a url" },
      false,
      [],
      "Denied.",
    );
    expect(decision.scope).toBe("invalid_network_target");
  });
});

describe("PermissionAuthorizationError", () => {
  it("retains the permission decision and policy refs", () => {
    const decision = tracePermissionDecision(
      { capability: "repository.write", target: "src/app.ts" },
      false,
      ["artifact://run-1/plan-1"],
      "Denied.",
    );
    const error = new PermissionAuthorizationError(
      "mutation blocked",
      decision,
      ["artifact://run-1/plan-1"],
    );
    expect(error.name).toBe("PermissionAuthorizationError");
    expect(error.message).toBe("mutation blocked");
    expect(error.permissionDecision).toBe(decision);
    expect(error.inputRefs).toEqual(["artifact://run-1/plan-1"]);
  });
});

describe("buildWorkResultPermissionEvents", () => {
  it("returns no events when no pending node exists", () => {
    expect(
      buildWorkResultPermissionEvents(runRecord(), { actions: [] }, null, [
        "artifact://run-1/contract-1",
      ]),
    ).toEqual([]);
  });

  it("emits permission_checked events for completed actions", () => {
    const permissions = emptyPermissionSet();
    permissions.shell.inspect = true;
    const events = buildWorkResultPermissionEvents(
      runRecord({ requestedMode: "fix_only" }),
      {
        actions: [
          {
            capability: "shell.inspect",
            target: "process:list",
            status: "completed",
          },
        ],
      },
      {
        id: "node-1",
        dependsOn: [],
        allowedTools: ["shell.inspect"],
        permissions,
      },
      ["artifact://run-1/contract-1", "artifact://run-1/plan-1"],
    );
    expect(events).toHaveLength(1);
    expect(events[0]?.eventType).toBe("permission_checked");
    expect(events[0]?.permissionDecision.decision).toBe("allow");
    expect(events[0]?.inputRefs).toEqual([
      "artifact://run-1/contract-1",
      "artifact://run-1/plan-1",
    ]);
  });

  it("denies capabilities outside the work node", () => {
    const permissions = emptyPermissionSet();
    permissions.repository.read = ["/workspace/project"];
    const events = buildWorkResultPermissionEvents(
      runRecord({ requestedMode: "fix_only" }),
      {
        actions: [
          {
            capability: "repository.write",
            target: "src/app.ts",
            status: "completed",
          },
        ],
      },
      {
        id: "node-1",
        dependsOn: [],
        allowedTools: ["repository.read"],
        permissions,
      },
      ["artifact://run-1/contract-1"],
    );
    expect(events[0]?.permissionDecision.decision).toBe("deny");
    expect(events[0]?.decisionSummary).toContain("Denied");
  });
});
