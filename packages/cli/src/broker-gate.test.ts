import { describe, expect, it } from "vitest";

import { evaluateBrokerGate, mapHookInputToToolCall } from "./broker-gate.js";

describe("broker gate", () => {
  it("maps write tools to repository.write", () => {
    expect(
      mapHookInputToToolCall({
        tool_name: "Write",
        tool_input: { path: "src/foo.ts" },
      }),
    ).toEqual({ capability: "repository.write", target: "src/foo.ts" });
  });

  it("fails open without an active session", () => {
    expect(
      evaluateBrokerGate({
        repositoryRoot: process.cwd(),
        hookInput: {
          tool_name: "Write",
          tool_input: { path: "src/foo.ts" },
        },
      }),
    ).toEqual({ permission: "allow" });
  });
});
