# ADR-0009: Tool Broker (Loop 6)

**Status:** Accepted (Loop 6 foundation)

## Context

Telic validates submitted artifacts but cannot intercept host-native tool calls. Hosts need a check-before-call hook that applies the same permission intersection as the controller.

## Decision

1. **`evaluateBrokerAction()`** in `packages/core/src/tool-broker.ts` wraps `authorizeAction()` with run envelope permissions.
2. **MCP `telic_check_tool_action`** — host calls before native tools; service records trace.
3. **Trace `broker_decision`** events with `permissionDecision` payload (same shape as `permission_checked`).
4. **No `BrokerDecision` artifact** — trace-only audit.

## Consequences

### Positive

- Hosts can deny tool calls consistently with run authorization.
- Broker denies are inspectable via `telic_get_trace`.

### Deferred

- Full adapter `beforeToolCall` wiring (Cursor stub docs only).
- OS-level interception.

## Validation

- `packages/core/src/tool-broker.test.ts`
- `packages/mcp/src/replay.test.ts` (broker trace case)
