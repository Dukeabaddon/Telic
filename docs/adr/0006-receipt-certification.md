# ADR-0006: Receipt certification (Loop 3)

**Status:** Accepted (Loop 3 minimal slice)

## Decision

Micro topology auto-emits a `ReceiptAudit` companion when spot `QualityReview` passes. `certifyRun()` re-hashes evidence blobs before terminal `UserReport`. Trace emits `digest_verified` on success.

## Validation

- `certify-run.test.ts`
- Micro conformance + benchmark scorecards
