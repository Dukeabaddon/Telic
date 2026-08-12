# Phase 1 — Fail-closed broker

## Goal

When adapter hooks run with strict mode, deny risky tools if Telic cannot evaluate permissions.

## Files

- `packages/cli/src/broker-gate.ts`
- `packages/cli/src/broker-gate.test.ts`
- `adapters/cursor/project/.cursor/hooks/broker-gate.mjs`
- `adapters/cline/project/.cline/hooks/broker-gate.mjs`
- `adapters/roo-code/project/.roo/hooks/broker-gate.mjs`
- `plugins/telic/hooks/broker-gate.mjs`
- `test/cagt-broker-hook-e2e.test.ts`
- `docs/STATUS.md`, `README.md`, `docs/ADAPTERS.md`

## Data shape

`HookPermissionResponse`: `{ permission: "allow" | "deny"; user_message?; agent_message? }`

Strict mode via `TELIC_BROKER_STRICT=1` (set in hook scripts). Opt-out: `TELIC_BROKER_PERMISSIVE=1`.

## Behavior changes

1. Hook fallback when CLI missing → `deny` (strict).
2. `evaluateBrokerGate`: when strict and mapped capability with no valid active session → `deny`.
3. When strict and run version mismatch / not running → `deny` (not allow).

## Exit criteria

- PRODUCTION_GATE T1–T3
- All tests pass

## Verify

```bash
npm test -- packages/cli/src/broker-gate.test.ts test/cagt-broker-hook-e2e.test.ts
npm run adapters:validate
```
