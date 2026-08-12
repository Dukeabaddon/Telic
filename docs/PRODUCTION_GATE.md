# Telic production gate

Checklist for declaring **v0.2.0** production-ready preview. Every row must pass before tagging.

**Last updated:** 2026-08-12

## Trust boundary

| #   | Criterion                                                                        | Verify                                                                               |
| --- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| T1  | Broker hooks fail-closed when `TELIC_BROKER_STRICT=1` (default in adapter hooks) | `npm test -- packages/cli/src/broker-gate.test.ts test/cagt-broker-hook-e2e.test.ts` |
| T2  | Hook denies when `telic` CLI is missing (strict)                                 | E2E or hook unit test                                                                |
| T3  | README and STATUS state Telic does not cage the host without hooks               | Manual read                                                                          |

## Maintainability

| #   | Criterion                                                      | Verify                                                                     |
| --- | -------------------------------------------------------------- | -------------------------------------------------------------------------- |
| M1  | `intersectStructuredPermissions` has one implementation        | `rg intersectStructuredPermissions packages/core/src` shows one definition |
| M2  | `controller.ts` facade under 1,500 lines; validators extracted | `wc -l packages/core/src/controller.ts`                                    |
| M3  | Extracted validators have unit tests                           | `ls packages/core/src/controller/*.test.ts` or `validators/`               |

## Quality

| #   | Criterion                                | Verify                                                |
| --- | ---------------------------------------- | ----------------------------------------------------- |
| Q1  | Full test suite passes                   | `npm test`                                            |
| Q2  | Adapter handshakes pass                  | `npm run adapters:validate`                           |
| Q3  | Site builds (if web touched)             | `npm run site:check`                                  |
| Q4  | Coverage run stable (ledger concurrency) | `npm test -- --coverage` three consecutive green runs |

## Review

| #   | Criterion                                         | Verify                   |
| --- | ------------------------------------------------- | ------------------------ |
| R1  | `/review` or equivalent on full diff vs `main`    | PR review notes          |
| R2  | Bugbot triaged (fix or dismiss with reason)       | PR comments              |
| R3  | Security review on broker + permissions (Phase 1) | security-review artifact |

## Release

| #   | Criterion                               | Verify                    |
| --- | --------------------------------------- | ------------------------- |
| S1  | `CHANGELOG.md` updated for v0.2.0       | File diff                 |
| S2  | Workspace + `telic-mcp` version `0.2.0` | `package.json`            |
| S3  | Git tag `v0.2.0` on `main`              | `git tag -l v0.2.0`       |
| S4  | `main` CI green after merge             | `gh pr checks` or Actions |

## Explicitly out of scope for v0.2.0

- CAGT / protocol rewrite
- Forensic-only FSM expansion beyond current ADRs
- Adapter marketplace lifecycle certification
- Parallel WorkPlan execution
- Hosted service or telemetry
