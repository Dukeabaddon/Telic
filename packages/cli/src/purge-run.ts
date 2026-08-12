import type { PurgeRunResult, SqliteLedger } from "@telic/core";

export interface PurgeRunCliIo {
  stdout: (line: string) => void;
}

export function runPurgeRun(
  ledger: SqliteLedger,
  runId: string,
  json: boolean,
  io: PurgeRunCliIo,
): number {
  const result: PurgeRunResult = ledger.purgeRun(runId);
  io.stdout(json ? JSON.stringify(result) : JSON.stringify(result, null, 2));
  return 0;
}

export function purgeRunUsage(): string {
  return "  telic purge-run RUN_ID [--repo PATH] [--json]";
}
