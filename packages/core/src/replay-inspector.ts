import type { SqliteLedger } from "./ledger.js";
import type { Phase, RunRecord, RunTopology } from "./types.js";

export type DigestStatus = "ok" | "missing" | "mismatch";

export interface ReplayStep {
  sequence: number;
  phase: Phase;
  artifactRef: string;
  artifactType: string;
  digestStatus: DigestStatus;
  escalationReason?: string;
}

export interface ReplayReport {
  runId: string;
  topology: RunTopology;
  steps: ReplayStep[];
  traceHighlights: string[];
  degraded?: boolean;
  reason?: string;
}

const ARTIFACT_REF_PATTERN =
  /^artifact:\/\/([0-9a-f-]{36})\/([A-Za-z0-9][A-Za-z0-9._:-]*)$/u;

function verifyArtifactDigest(
  ledger: SqliteLedger,
  runId: string,
  artifactId: string,
): DigestStatus {
  try {
    ledger.getArtifact(runId, artifactId);
    return "ok";
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("integrity check failed")) return "mismatch";
    if (
      message.includes("ENOENT") ||
      message.includes("must be a regular file") ||
      message.includes("Stored artifact blob")
    ) {
      return "missing";
    }
    return "missing";
  }
}

function parseArtifactRef(reference: string): { runId: string; artifactId: string } | null {
  const match = ARTIFACT_REF_PATTERN.exec(reference);
  if (!match) return null;
  return { runId: match[1]!, artifactId: match[2]! };
}

function escalationHighlights(ledger: SqliteLedger, runId: string): string[] {
  return ledger
    .listTrace(runId)
    .filter((event) => event.eventType === "topology_escalated")
    .map((event) => event.decisionSummary);
}

function brokerDenyHighlights(ledger: SqliteLedger, runId: string): string[] {
  return ledger
    .listTrace(runId)
    .filter(
      (event) =>
        event.eventType === "broker_decision" &&
        event.permissionDecision?.decision === "deny",
    )
    .map((event) => event.decisionSummary);
}

function artifactTraceIndex(
  ledger: SqliteLedger,
  runId: string,
): Map<
  string,
  { sequence: number; phase: Phase; escalationReason?: string }
> {
  const escalationBySequence = new Map<number, string>();
  for (const event of ledger.listTrace(runId)) {
    if (event.eventType === "topology_escalated") {
      escalationBySequence.set(event.sequence, event.decisionSummary);
    }
  }

  const index = new Map<
    string,
    { sequence: number; phase: Phase; escalationReason?: string }
  >();
  for (const event of ledger.listTrace(runId)) {
    for (const reference of event.outputRefs) {
      const parsed = parseArtifactRef(reference);
      if (!parsed || parsed.runId !== runId) continue;
      index.set(parsed.artifactId, {
        sequence: event.sequence,
        phase: event.phase,
        ...(escalationBySequence.has(event.sequence)
          ? { escalationReason: escalationBySequence.get(event.sequence)! }
          : {}),
      });
    }
  }
  return index;
}

export function inspectRunReplay(ledger: SqliteLedger, run: RunRecord): ReplayReport {
  if (run.topology === "micro") {
    return {
      runId: run.runId,
      topology: run.topology,
      steps: [],
      traceHighlights: [],
      degraded: true,
      reason: "micro_topology",
    };
  }

  const traceIndex = artifactTraceIndex(ledger, run.runId);
  const steps: ReplayStep[] = ledger.listArtifacts(run.runId).map((stored, index) => {
    const artifactRef = `artifact://${run.runId}/${stored.id}`;
    const traced = traceIndex.get(stored.id);
    return {
      sequence: traced?.sequence ?? index,
      phase: traced?.phase ?? run.phase,
      artifactRef,
      artifactType: stored.type,
      digestStatus: verifyArtifactDigest(ledger, run.runId, stored.id),
      ...(traced?.escalationReason
        ? { escalationReason: traced.escalationReason }
        : {}),
    };
  });

  steps.sort((left, right) => left.sequence - right.sequence);

  return {
    runId: run.runId,
    topology: run.topology,
    steps,
    traceHighlights: [
      ...escalationHighlights(ledger, run.runId),
      ...brokerDenyHighlights(ledger, run.runId),
    ],
  };
}
