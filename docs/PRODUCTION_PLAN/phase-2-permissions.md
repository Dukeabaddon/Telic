# Phase 2 — Permission dedup

## Goal

Single `intersectStructuredPermissions` in `packages/core/src/permissions.ts` (or dedicated module).

## Files

- New or extended `packages/core/src/permissions.ts`
- `packages/core/src/controller.ts` (remove duplicate)
- `packages/core/src/tool-broker.ts` (import shared)
- Unit tests for intersection edge cases

## Exit criteria

- PRODUCTION_GATE M1
- No behavior change (refactor only)

## Verify

```bash
rg "function intersectStructuredPermissions" packages/core/src
npm test -- packages/core
```
