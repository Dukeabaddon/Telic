import { describe, expect, it } from "vitest";

import { classifyRun } from "./classify-run.js";

describe("classifyRun", () => {
  it("classifies short fix_only with read/write as micro", () => {
    const result = classifyRun({
      originalRequest: "Fix typo in src/foo.ts: bar→baz",
      requestedMode: "fix_only",
      granted: ["repository.read", "repository.write"],
    });
    expect(result).toMatchObject({
      topology: "micro",
      rationaleCode: "MICRO_SHORT_FIX_ONLY",
    });
    expect(result.signals).toContain("MICRO_SHORT_FIX_ONLY");
  });

  it("classifies fix_only with shell grant as forensic", () => {
    const result = classifyRun({
      originalRequest: "Fix typo in src/foo.ts",
      requestedMode: "fix_only",
      granted: ["repository.read", "repository.write", "shell.execute"],
    });
    expect(result.topology).toBe("forensic");
    expect(result.signals).toContain("ELEVATED_CAPABILITY");
  });

  it("classifies short report_only as micro", () => {
    const result = classifyRun({
      originalRequest: "What does src/index.ts export?",
      requestedMode: "report_only",
      granted: ["repository.read"],
    });
    expect(result).toMatchObject({
      topology: "micro",
      rationaleCode: "MICRO_SHORT_REPORT_ONLY",
    });
    expect(result.signals).toContain("MICRO_SHORT_REPORT_ONLY");
  });

  it("classifies analyze_and_fix as forensic", () => {
    const result = classifyRun({
      originalRequest: "Fix the auth bug",
      requestedMode: "analyze_and_fix",
      granted: ["repository.read"],
    });
    expect(result.topology).toBe("forensic");
    expect(result.signals).toContain("ANALYZE_AND_FIX");
  });

  it("classifies write capability as forensic", () => {
    const result = classifyRun({
      originalRequest: "Update README",
      requestedMode: "report_only",
      granted: ["repository.read", "repository.write"],
    });
    expect(result.topology).toBe("forensic");
    expect(result.signals).toContain("ELEVATED_CAPABILITY");
  });

  it("rejects micro override when gates fail", () => {
    expect(() =>
      classifyRun({
        originalRequest: "Fix auth",
        requestedMode: "analyze_only",
        granted: ["repository.read"],
        topologyOverride: "micro",
      }),
    ).toThrow(/incompatible/);
  });

  it("honors standard override", () => {
    const result = classifyRun({
      originalRequest: "What exports?",
      requestedMode: "report_only",
      granted: ["repository.read"],
      topologyOverride: "standard",
    });
    expect(result.topology).toBe("standard");
    expect(result.signals).toContain("OVERRIDE_STANDARD");
  });

  it("rejects standard override when forensic signals are present", () => {
    expect(() =>
      classifyRun({
        originalRequest: "Fix auth across the codebase",
        requestedMode: "analyze_and_fix",
        granted: ["repository.read"],
        topologyOverride: "standard",
      }),
    ).toThrow(/incompatible with forensic classification signals/);
  });
});
