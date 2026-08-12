# Phase 6 — Release v0.2.0

## Goal

Run [PRODUCTION_GATE.md](../PRODUCTION_GATE.md), tag, ship.

## Steps

1. Walk every gate row; record pass/fail.
2. Bump version to `0.2.0` in workspace packages and `telic-mcp`.
3. Update `CHANGELOG.md`.
4. `/ship` → merge to `main`.
5. Tag `v0.2.0`.
6. `/land-and-deploy` + `/monitor` for website if applicable.
7. `/document-release`.

## Exit criteria

- All PRODUCTION_GATE rows pass
- `git tag -l v0.2.0`
