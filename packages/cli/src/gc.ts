import type { CollectOrphanBlobsResult, SqliteLedger } from "@telic/core";

export interface GcCliIo {
  stdout: (line: string) => void;
}

export function runGc(
  ledger: SqliteLedger,
  options: { dryRun: boolean; json: boolean },
  io: GcCliIo,
): number {
  const result: CollectOrphanBlobsResult = ledger.collectOrphanBlobs({
    dryRun: options.dryRun,
  });
  io.stdout(
    options.json ? JSON.stringify(result) : JSON.stringify(result, null, 2),
  );
  return 0;
}

export function gcUsage(): string {
  return "  telic gc [--repo PATH] [--dry-run] [--json]";
}
