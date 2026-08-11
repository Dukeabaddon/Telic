import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { IntentMode } from "./types.js";

export interface ActiveSession {
  schemaVersion: "1.0";
  runId: string;
  actionId: string;
  runVersion: number;
  repositoryRoot: string;
  requestedMode: IntentMode;
  updatedAt: string;
}

export function activeSessionPath(stateDirectory: string): string {
  return join(stateDirectory, "active-session.json");
}

export function writeActiveSession(
  stateDirectory: string,
  session: ActiveSession,
): void {
  mkdirSync(stateDirectory, { recursive: true, mode: 0o700 });
  writeFileSync(activeSessionPath(stateDirectory), JSON.stringify(session), {
    encoding: "utf8",
    mode: 0o600,
  });
}

export function readActiveSession(
  stateDirectory: string,
): ActiveSession | null {
  const path = activeSessionPath(stateDirectory);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8")) as ActiveSession;
}

export function clearActiveSession(stateDirectory: string): void {
  const path = activeSessionPath(stateDirectory);
  if (existsSync(path)) unlinkSync(path);
}
