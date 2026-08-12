import { DatabaseSync } from "node:sqlite";
import { Worker } from "node:worker_threads";

export type BlockedWorkerResult =
  | { kind: "result"; ok: true; artifact: unknown }
  | { kind: "result"; ok: false; error: string };

function workerMessage<T>(worker: Worker, kind: string): Promise<T> {
  return new Promise<T>((resolvePromise, rejectPromise) => {
    const onMessage = (message: { kind?: unknown }): void => {
      if (message.kind !== kind) return;
      cleanup();
      resolvePromise(message as T);
    };
    const onError = (error: Error): void => {
      cleanup();
      rejectPromise(error);
    };
    const onExit = (code: number): void => {
      cleanup();
      rejectPromise(
        new Error(
          `Supporting worker exited with code ${String(code)} before ${kind}`,
        ),
      );
    };
    const cleanup = (): void => {
      worker.off("message", onMessage);
      worker.off("error", onError);
      worker.off("exit", onExit);
    };
    worker.on("message", onMessage);
    worker.on("error", onError);
    worker.on("exit", onExit);
  });
}

function createContentionBarrier(workerCount: number): SharedArrayBuffer {
  const buffer = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT);
  const counter = new Int32Array(buffer);
  counter[0] = workerCount;
  return buffer;
}

async function waitForContentionBarrier(
  buffer: SharedArrayBuffer,
  timeoutMs = 5000,
): Promise<void> {
  const counter = new Int32Array(buffer);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (Atomics.load(counter, 0) <= 0) return;
    Atomics.wait(counter, 0, Atomics.load(counter, 0), 25);
  }
  throw new Error(
    `Timed out waiting for ${String(Atomics.load(counter, 0))} workers to reach ledger contention`,
  );
}

export async function runBlockedWorkers<T extends Record<string, unknown>>(
  workerModuleUrl: URL,
  databasePath: string,
  workerData: readonly T[],
  options?: { execArgv?: string[] },
): Promise<BlockedWorkerResult[]> {
  const contentionBarrier = createContentionBarrier(workerData.length);
  const workers = workerData.map(
    (data) =>
      new Worker(workerModuleUrl, {
        workerData: { ...data, contentionBarrier },
        execArgv: options?.execArgv ?? ["--import", "tsx"],
      }),
  );
  await Promise.all(
    workers.map(async (worker) => workerMessage(worker, "ready")),
  );
  const blocker = new DatabaseSync(databasePath);
  blocker.exec("PRAGMA busy_timeout = 5000; BEGIN IMMEDIATE;");
  let locked = true;
  try {
    const starting = workers.map(async (worker) =>
      workerMessage(worker, "starting"),
    );
    const results = workers.map(async (worker) =>
      workerMessage<BlockedWorkerResult>(worker, "result"),
    );
    for (const worker of workers) worker.postMessage("go");
    await Promise.all(starting);
    await waitForContentionBarrier(contentionBarrier);
    blocker.exec("COMMIT");
    locked = false;
    return await Promise.all(results);
  } finally {
    if (locked) blocker.exec("ROLLBACK");
    blocker.close();
  }
}
