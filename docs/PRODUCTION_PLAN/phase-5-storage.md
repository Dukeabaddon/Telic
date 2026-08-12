# Phase 5 — Storage lifecycle

## Goal

`telic purge-run RUN_ID` and `telic gc` for orphan blob cleanup.

## Files

- `packages/cli/src/index.ts`
- New `packages/cli/src/purge-run.ts`, `packages/cli/src/gc.ts`
- Tests with `TELIC_STATE_DIR`
- `docs/API.md`

## Exit criteria

- Commands documented and tested
- Dry-run mode for `gc`

## Verify

```bash
npm test -- packages/cli
telic purge-run --help
telic gc --help
```
