# Telic production readiness plan

**Target:** v0.2.0 production-ready preview  
**Repo:** Developer Tools (Telic)  
**Base branch:** `main`

## Context

System review graded protocol and tests highly (S), but security posture (B) and controller complexity (C+) need work before a credible production tag. This plan sequences fixes without rewriting CAGT or the protocol.

## Scope

**In:** fail-closed broker, permission dedup, controller split, ledger hardening, optional storage GC, release gate.

**Out:** CAGT redesign, forensic FSM expansion, new adapters, parallel workers.

## Phases

| Phase | Doc | Branch | Playbook |
|-------|-----|--------|----------|
| 0 | [phase-0-docs.md](./phase-0-docs.md) | `feat/production-phase-0` | multi-phase-plan |
| 1 | [phase-1-broker.md](./phase-1-broker.md) | `feat/production-phase-1-broker` | feature |
| 2 | [phase-2-permissions.md](./phase-2-permissions.md) | `feat/production-phase-2-permissions` | refactoring |
| 3 | [phase-3-controller.md](./phase-3-controller.md) | `feat/production-phase-3a` … `3c` | refactoring |
| 4 | [phase-4-ledger.md](./phase-4-ledger.md) | `feat/production-phase-4-ledger` | bug-fix |
| 5 | [phase-5-storage.md](./phase-5-storage.md) | `feat/production-phase-5-storage` | feature |
| 6 | [phase-6-release.md](./phase-6-release.md) | `release/v0.2.0` | shipping |

## Per-phase gate

```text
/freeze <scope>
→ implement
→ npm test && npm run adapters:validate
→ /review + Bugbot (+ security-review on Phase 1)
→ /ship PR
→ merge when CI green
```

## Done predicate

All rows in [PRODUCTION_GATE.md](../PRODUCTION_GATE.md) pass. Tag `v0.2.0` on `main`.
