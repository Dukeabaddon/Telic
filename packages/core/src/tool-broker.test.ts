import { describe, expect, it } from "vitest";

import {
  evaluateBrokerAction,
  permissionsFromEnvelope,
} from "./tool-broker.js";
import type { StructuredPermissionSet } from "./types.js";

const repositoryRoot = "/repo";

const NO_PERMISSIONS: StructuredPermissionSet = {
  repository: { read: [], write: [], delete: [] },
  shell: { inspect: false, executeAllowlist: [] },
  runtime: { inspect: [], restart: [] },
  browser: { inspect: false, mutateState: false },
  network: { readDomains: [], externalWrite: false },
  subagents: { spawn: false, maximumChildren: 0, maximumDepth: 0 },
};

const READ_PERMISSIONS: StructuredPermissionSet = {
  ...NO_PERMISSIONS,
  repository: { read: ["**"], write: [], delete: [] },
  shell: { inspect: true, executeAllowlist: [] },
  runtime: { inspect: ["local"], restart: [] },
  browser: { inspect: true, mutateState: false },
};

describe("tool broker", () => {
  it("denies repository.write without grant", () => {
    const decision = evaluateBrokerAction(
      {
        repositoryRoot,
        mode: "report_only",
        permissions: permissionsFromEnvelope("report_only", {
          authorization: { granted: READ_PERMISSIONS, denied: NO_PERMISSIONS },
        }),
      },
      {
        capability: "repository.write",
        target: "src/foo.ts",
        runId: "00000000-0000-4000-8000-000000000001",
        actionId: "action-1",
      },
    );
    expect(decision.allowed).toBe(false);
    expect(decision.reasonCode).toBe("policy_denied");
    expect(decision.permissionDecision.decision).toBe("deny");
  });

  it("allows scoped write inside granted path", () => {
    const writePermissions = {
      ...READ_PERMISSIONS,
      repository: {
        read: ["**"],
        write: ["src/**"],
        delete: [],
      },
    };
    const decision = evaluateBrokerAction(
      {
        repositoryRoot,
        mode: "fix_only",
        permissions: writePermissions,
      },
      {
        capability: "repository.write",
        target: "src/foo.ts",
        runId: "00000000-0000-4000-8000-000000000001",
        actionId: "action-1",
      },
    );
    expect(decision.allowed).toBe(true);
    expect(decision.reasonCode).toBe("allowed");
    expect(decision.permissionDecision.decision).toBe("allow");
  });

  it("denies unknown capabilities", () => {
    const decision = evaluateBrokerAction(
      {
        repositoryRoot,
        mode: "analyze_only",
        permissions: permissionsFromEnvelope("analyze_only", {
          authorization: { granted: READ_PERMISSIONS, denied: NO_PERMISSIONS },
        }),
      },
      {
        capability: "custom.tool",
        runId: "00000000-0000-4000-8000-000000000001",
        actionId: "action-1",
      },
    );
    expect(decision.allowed).toBe(false);
    expect(decision.reasonCode).toBe("capability_not_granted");
  });
});
