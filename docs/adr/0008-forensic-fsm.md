# ADR-0008: Forensic FSM (Loop 5)

**Status:** Accepted (Loop 5 minimal slice)

## Decision

Forensic topology adds `agent_3_evidence_reverify` after `agent_3_review`. A second `QualityReview` with `reviewKind: "evidence_reverify"` is required before release audit. `topology_override: "standard"` is rejected when forensic classification signals are present.

## Validation

- `topology.test.ts`
- `state-machine.test.ts` forensic branch
