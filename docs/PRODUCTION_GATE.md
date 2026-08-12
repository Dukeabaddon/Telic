# Telic production gate

Checklist for declaring **v0.2.0** production-ready preview. Every row must pass before tagging.

**Last updated:** 2026-08-12 (phase 6 release prep)

**Open before tag:** PRs [#8](https://github.com/Dukeabaddon/Telic/pull/8) (ledger), [#9](https://github.com/Dukeabaddon/Telic/pull/9) (3b), [#10](https://github.com/Dukeabaddon/Telic/pull/10) (3c), [#11](https://github.com/Dukeabaddon/Telic/pull/11) (storage). Do not tag until those merge and this checklist is re-walked.

## Trust boundary

| #   | Criterion                                                                        | Verify                                                                               | Status |
| --- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | ------ |
| T1  | Broker hooks fail-closed when `TELIC_BROKER_STRICT=1` (default in adapter hooks) | `npm test -- packages/cli/src/broker-gate.test.ts test/cagt-broker-hook-e2e.test.ts` | pass   |
| T2  | Hook denies when `telic` CLI is missing (strict)                                 | E2E or hook unit test                                                                | pass   |
| T3  | README and STATUS state Telic does not cage the host without hooks               | Manual read                                                                          | pass   |

## Maintainability

| #   | Criterion                                                      | Verify                                                                     | Status  |
| --- | -------------------------------------------------------------- | -------------------------------------------------------------------------- | ------- |
| M1  | `intersectStructuredPermissions` has one implementation        | `rg intersectStructuredPermissions packages/core/src` shows one definition | pass    |
| M2  | `controller.ts` facade under 1,500 lines; validators extracted | `wc -l packages/core/src/controller.ts`                                    | pending |
| M3  | Extracted validators have unit tests                           | `ls packages/core/src/controller/*.test.ts` or `validators/`               | partial |

## Quality

| #   | Criterion                                | Verify                                                | Status  |
| --- | ---------------------------------------- | ----------------------------------------------------- | ------- |
| Q1  | Full test suite passes                   | `npm test`                                            | pass    |
| Q2  | Adapter handshakes pass                  | `npm run adapters:validate`                           | pass    |
| Q3  | Site builds (if web touched)             | `npm run site:check`                                  | n/a     |
| Q4  | Coverage run stable (ledger concurrency) | `npm test -- --coverage` three consecutive green runs | pending |

## Review

| #   | Criterion                                         | Verify                   | Status  |
| --- | ------------------------------------------------- | ------------------------ | ------- |
| R1  | `/review` or equivalent on full diff vs `main`    | PR review notes          | pending |
| R2  | Bugbot triaged (fix or dismiss with reason)       | PR comments              | pending |
| R3  | Security review on broker + permissions (Phase 1) | security-review artifact | pending |

## Release

| #   | Criterion                               | Verify                    | Status  |
| --- | --------------------------------------- | ------------------------- | ------- |
| S1  | `CHANGELOG.md` updated for v0.2.0       | File diff                 | pass    |
| S2  | Workspace + `telic-mcp` version `0.2.0` | `package.json`            | pass    |
| S3  | Git tag `v0.2.0` on `main`              | `git tag -l v0.2.0`       | blocked |
| S4  | `main` CI green after merge             | `gh pr checks` or Actions | pending |

## Explicitly out of scope for v0.2.0

- CAGT / protocol rewrite
- Forensic-only FSM expansion beyond current ADRs
- Adapter marketplace lifecycle certification
- Parallel WorkPlan execution
- Hosted service or telemetry
