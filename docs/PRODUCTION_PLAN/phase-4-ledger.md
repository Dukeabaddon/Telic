# Phase 4 — Ledger concurrency

## Goal

Fix flaky multi-worker ledger tests; make concurrency suite reliable in CI.

## Files

- `packages/core/src/ledger.test.ts`
- `packages/core/src/sqlite-ledger.ts` (if race fix needed)

## Exit criteria

- PRODUCTION_GATE Q4

## Verify

```bash
npm test -- packages/core/src/ledger.test.ts
npm test -- --coverage
```
