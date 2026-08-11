# ADR-0010: Forensic Replay Inspector (Loop 7)

**Status:** Accepted (Loop 7 foundation)

## Context

Forensic runs need read-only ledger replay with digest verification. Micro runs should not claim full forensic replay fidelity.

## Decision

1. **`inspectRunReplay()`** returns `ReplayReport` with trace-ordered steps and per-artifact `digestStatus`.
2. **MCP `telic_replay_run`** returns refs + digests only (no artifact bodies).
3. **Micro topology** returns `{ degraded: true, reason: "micro_topology" }` without full step walk.
4. **Forensic / standard** runs perform full digest verification via ledger blob reads.

## Consequences

### Positive

- Corrupt blobs surface as `digestStatus: "mismatch"`.
- Escalation and broker deny highlights appear in `traceHighlights`.

### Deferred

- Live host execution replay.
- Web UI inspector.

## Validation

- `packages/core/src/replay-inspector.test.ts`
- `packages/mcp/src/replay.test.ts`
