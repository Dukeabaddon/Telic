# Changelog

All notable changes to the Telic workspace and `telic-mcp` npm package are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] - Unreleased

Production-ready preview release. Tag `v0.2.0` after phases 3b–5 land on `main` and every row in [docs/PRODUCTION_GATE.md](docs/PRODUCTION_GATE.md) passes.

### Added

- **Fail-closed broker gate (strict mode).** Adapter hooks default to `TELIC_BROKER_STRICT=1`. When the `telic` CLI is missing, the active run cannot be evaluated, or the run is not in a running state, mapped mutating tools are denied instead of allowed. Opt out locally with `TELIC_BROKER_PERMISSIVE=1`.
- **Storage lifecycle CLI.** `telic purge-run RUN_ID` removes a run's ledger rows and unreferenced blob bodies. `telic gc` lists or deletes orphan content-store blobs (`--dry-run` supported).
- **Production gate and plan docs.** `docs/PRODUCTION_GATE.md` checklist and phased plan under `docs/PRODUCTION_PLAN/`.

### Changed

- **Controller validator extraction.** Evidence, cross-artifact, work-plan, and permission-trace validation moved from `RunController` into `packages/core/src/controller/*` modules with focused unit tests. Public `RunController` API unchanged.
- **Permission intersection.** Single `intersectStructuredPermissions` implementation in `packages/core/src/permissions.ts`; `controller.ts` and `tool-broker.ts` import the shared helper.

### Fixed

- **Ledger concurrency.** Multi-worker ledger tests use a SharedArrayBuffer contention barrier instead of a fixed sleep. `appendSupportingArtifact` reconciles concurrent `UNIQUE` inserts idempotently instead of surfacing raw SQLite errors.

### Security

- Broker hooks fail closed under strict mode when Telic cannot evaluate permissions for a mapped capability ([#6](https://github.com/Dukeabaddon/Telic/pull/6)).

## [0.1.1] - Prior release

Initial public preview: MCP control plane, nine-phase run controller, SQLite ledger, adapter packs, and `telic` CLI.
