# Phase 3 — Controller split

## Goal

Extract validators from `packages/core/src/controller.ts` without changing public API.

## PR stack

| PR | Extract | Target file |
|----|---------|-------------|
| 3a | Evidence validation | `controller/evidence-validator.ts` |
| 3b | Cross-artifact validation | `controller/cross-artifact-validator.ts` |
| 3c | Work-plan + permission trace helpers | `controller/work-plan-validator.ts`, `controller/permission-trace.ts` |

Facade remains `RunController` in `controller/index.ts` or slimmed `controller.ts`.

## Exit criteria

- PRODUCTION_GATE M2, M3
- `full-flow-conformance.test.ts` passes

## Verify

```bash
wc -l packages/core/src/controller.ts
npm test -- packages/core test/full-flow-conformance.test.ts
```
