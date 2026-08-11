import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  activeSessionPath,
  clearActiveSession,
  readActiveSession,
  writeActiveSession,
} from "./active-session.js";

describe("active session", () => {
  it("round-trips through the state directory file", () => {
    const stateDirectory = mkdtempSync(join(tmpdir(), "telic-active-session-"));
    const session = {
      schemaVersion: "1.0" as const,
      runId: "00000000-0000-4000-8000-000000000001",
      actionId: "action-01",
      runVersion: 3,
      repositoryRoot: "/repo",
      requestedMode: "report_only" as const,
      updatedAt: "2026-08-11T00:00:00.000Z",
    };
    writeActiveSession(stateDirectory, session);
    expect(readActiveSession(stateDirectory)).toEqual(session);
    expect(readFileSync(activeSessionPath(stateDirectory), "utf8")).toContain(
      session.runId,
    );
    clearActiveSession(stateDirectory);
    expect(readActiveSession(stateDirectory)).toBeNull();
    rmSync(stateDirectory, { recursive: true, force: true });
  });
});
