import { describe, expect, it } from "vitest";

import { gateHostToolCall } from "./host-tool-gate.js";

const repositoryRoot = "/repo";
const runId = "00000000-0000-4000-8000-000000000001";

describe("host tool gate", () => {
  it("denies repository.write on report_only envelopes", () => {
    const decision = gateHostToolCall(
      {
        repositoryRoot,
        mode: "report_only",
        envelope: {
          authorization: {
            granted: {
              repository: { read: ["**"], write: [], delete: [] },
              shell: { inspect: true, executeAllowlist: [] },
              runtime: { inspect: ["local"], restart: [] },
              browser: { inspect: true, mutateState: false },
              network: { readDomains: [], externalWrite: false },
              subagents: { spawn: false, maximumChildren: 0, maximumDepth: 0 },
            },
            denied: {
              repository: { read: [], write: ["**"], delete: ["**"] },
              shell: { inspect: false, executeAllowlist: [] },
              runtime: { inspect: [], restart: ["**"] },
              browser: { inspect: false, mutateState: true },
              network: { readDomains: [], externalWrite: true },
              subagents: { spawn: true, maximumChildren: 0, maximumDepth: 0 },
            },
          },
        },
      },
      {
        capability: "repository.write",
        target: "src/foo.ts",
        runId,
        actionId: "host-action-1",
      },
    );
    expect(decision.allowed).toBe(false);
    expect(decision.reasonCode).toBe("policy_denied");
    expect(decision.permissionDecision.decision).toBe("deny");
  });

  it("allows scoped repository.write when the envelope grants the path", () => {
    const decision = gateHostToolCall(
      {
        repositoryRoot,
        mode: "fix_only",
        envelope: {
          authorization: {
            granted: {
              repository: { read: ["**"], write: ["src/**"], delete: [] },
              shell: { inspect: true, executeAllowlist: [] },
              runtime: { inspect: ["local"], restart: [] },
              browser: { inspect: true, mutateState: false },
              network: { readDomains: [], externalWrite: false },
              subagents: { spawn: false, maximumChildren: 0, maximumDepth: 0 },
            },
            denied: {
              repository: { read: [], write: [], delete: ["**"] },
              shell: { inspect: false, executeAllowlist: [] },
              runtime: { inspect: [], restart: ["**"] },
              browser: { inspect: false, mutateState: true },
              network: { readDomains: [], externalWrite: true },
              subagents: { spawn: true, maximumChildren: 0, maximumDepth: 0 },
            },
          },
        },
      },
      {
        capability: "repository.write",
        target: "src/foo.ts",
        runId,
        actionId: "host-action-2",
      },
    );
    expect(decision.allowed).toBe(true);
    expect(decision.reasonCode).toBe("allowed");
    expect(decision.permissionDecision.decision).toBe("allow");
  });
});
