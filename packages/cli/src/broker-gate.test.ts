import { afterEach, describe, expect, it } from "vitest";

import { evaluateBrokerGate, isBrokerStrict, mapHookInputToToolCall } from "./broker-gate.js";

const writeHook = {
  tool_name: "Write",
  tool_input: { path: "src/foo.ts" },
};

describe("broker gate", () => {
  const envSnapshot = { ...process.env };

  afterEach(() => {
    process.env = { ...envSnapshot };
  });

  it("maps write tools to repository.write", () => {
    expect(mapHookInputToToolCall(writeHook)).toEqual({
      capability: "repository.write",
      target: "src/foo.ts",
    });
  });

  it("fails open without an active session when not strict", () => {
    delete process.env.TELIC_BROKER_STRICT;
    delete process.env.TELIC_BROKER_PERMISSIVE;
    expect(
      evaluateBrokerGate({
        repositoryRoot: process.cwd(),
        hookInput: writeHook,
      }),
    ).toEqual({ permission: "allow" });
  });

  it("fails closed without an active session when strict", () => {
    process.env.TELIC_BROKER_STRICT = "1";
    const result = evaluateBrokerGate({
      repositoryRoot: process.cwd(),
      hookInput: writeHook,
    });
    expect(result.permission).toBe("deny");
    expect(result.user_message).toContain("strict mode");
  });

  it("respects permissive override", () => {
    process.env.TELIC_BROKER_STRICT = "1";
    process.env.TELIC_BROKER_PERMISSIVE = "1";
    expect(isBrokerStrict()).toBe(false);
    expect(
      evaluateBrokerGate({
        repositoryRoot: process.cwd(),
        hookInput: writeHook,
      }),
    ).toEqual({ permission: "allow" });
  });
});
