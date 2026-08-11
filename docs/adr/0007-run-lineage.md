# ADR-0007: Run lineage (Loop 4)

**Status:** Accepted (Loop 4 minimal slice)

## Decision

`priorRunId` links a new run to a terminal prior run in the same repository. `lineage_linked` trace records the link. `evidence-oracle` validates cross-run `artifact://` refs by digest; `contract-delta` extracts inherited scope from the prior run.

## Validation

- `cagt-loop4-conformance.test.ts`
