import { parentPort, workerData } from "node:worker_threads";

import {
  SqliteLedger,
  type SubmissionEvent,
  type SupportingArtifactQuota,
} from "../ledger.js";
import type { ArtifactSubmission } from "../types.js";
import { TelicService } from "../../../mcp/src/service.js";

type LedgerWorkerData = {
  kind: "ledger";
  stateDirectory: string;
  artifact: ArtifactSubmission;
  event: Omit<SubmissionEvent, "phase"> & {
    phase?: SubmissionEvent["phase"];
  };
  quota?: SupportingArtifactQuota;
};

type ServiceWorkerData = {
  kind: "service";
  repositoryRoot: string;
  stateDirectory: string;
  artifact: ArtifactSubmission;
};

type WorkerData = (LedgerWorkerData | ServiceWorkerData) & {
  contentionBarrier?: SharedArrayBuffer;
};

function signalContentionReady(
  contentionBarrier: SharedArrayBuffer | undefined,
): void {
  if (contentionBarrier === undefined) return;
  const counter = new Int32Array(contentionBarrier);
  const remaining = Atomics.sub(counter, 0, 1) - 1;
  if (remaining === 0) Atomics.notify(counter, 0);
}

if (parentPort === null) throw new Error("Supporting worker requires a parent");

const data = workerData as WorkerData;
const target =
  data.kind === "ledger"
    ? new SqliteLedger(data.stateDirectory)
    : new TelicService({
        repositoryRoot: data.repositoryRoot,
        stateDirectory: data.stateDirectory,
      });

parentPort.postMessage({ kind: "ready" });
parentPort.once("message", (message: unknown) => {
  if (message !== "go") return;
  parentPort.postMessage({ kind: "starting" });
  signalContentionReady(data.contentionBarrier);
  try {
    const artifact =
      data.kind === "ledger"
        ? target instanceof SqliteLedger
          ? target.appendSupportingArtifact(
              data.artifact,
              data.event,
              data.quota,
            )
          : null
        : target instanceof TelicService
          ? target.submitArtifact(data.artifact).artifact
          : null;
    parentPort.postMessage({ kind: "result", ok: true, artifact });
  } catch (error) {
    parentPort.postMessage({
      kind: "result",
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    target.close();
    parentPort.close();
  }
});
