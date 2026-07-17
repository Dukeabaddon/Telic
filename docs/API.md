# Telic source-preview API

**Version:** `0.1.1` implementation, artifact schema `1.0`

This is the human-oriented reference for the current source tree. The Zod schemas in `packages/protocol/src/` and the registrations in `packages/mcp/src/server-factory.ts` are authoritative. Telic has no compatibility guarantee before its first release.

## Serialization conventions

- Canonical artifact bodies are strict JSON objects: unknown keys are rejected.
- Canonical fields use camelCase and include `schemaVersion: "1.0"`.
- MCP tool argument names use snake_case at the transport boundary, for example `run_id` and `artifact_type`.
- Context discovery has an internal snake_case wire form; `@telic/protocol` normalizes it before the manifest enters the canonical artifact ledger.
- References use `artifact://`, `repo://`, or `trace://` URIs. Artifact references are run-scoped.
- Exact artifact bodies are immutable. Metadata stores a SHA-256 digest and retrieval verifies it.
- Validation failures are tool errors. A caller must correct the artifact rather than guessing that a partial object was accepted.

`telic_get_next_action` is the adapter's source of truth for the legal next phase, bounded input references, expected output artifact, primary `requiredOutputSchema`, phase-permitted `additionalOutputSchemas`, effective permissions, budgets, and stop conditions.

## MCP transport

The bundled server uses Model Context Protocol over STDIO:

```bash
TELIC_REPOSITORY_ROOT="$PWD" node plugins/telic/dist/mcp/server.js
```

Environment variables:

| Variable                | Meaning                                                                             |
| ----------------------- | ----------------------------------------------------------------------------------- |
| `TELIC_REPOSITORY_ROOT` | Repository to ground and bind to the run; defaults to the process working directory |
| `TELIC_STATE_DIR`       | Explicit ledger/content-store directory; overrides XDG-derived storage              |
| `XDG_STATE_HOME`        | Base for default state when `TELIC_STATE_DIR` is absent                             |

Protocol JSON is written only to stdout. Diagnostics go to stderr.

## MCP prompt

The server exposes one host-neutral prompt, `telic_workflow`. It accepts the exact
`original_request` and a required Telic `mode`, then returns instructions for the
host model to drive the nine MCP tools in controller order. The prompt does not
invoke a model, grant permissions, bypass host approvals, or intercept
host-native tools. Clients without MCP prompt support can implement the same
sequence directly from `telic_get_next_action`.

## MCP tools

The server currently exposes exactly nine tools.

### `telic_start_run`

Stores the original request as an immutable artifact and creates a run envelope.

Required input:

- `original_request`: non-empty text, at most 32,768 characters
- `mode`: `report_only`, `plan_only`, `analyze_only`, `fix_only`, or `analyze_and_fix`

Optional input:

- `host_name`
- `native_subagents`: `available`, `unavailable`, or `unknown`
- `host_capabilities`
- `authorization_granted`
- `authorization_denied`
- `shell_execute_allowlist`: at most 256 exact, non-compound command strings
- `network_read_domains`: at most 256 exact DNS names or IP addresses

The capability vocabulary is `repository.read`, `repository.write`,
`repository.delete`, `shell.inspect`, `shell.execute`, `runtime.inspect`,
`runtime.restart`, `browser.inspect`, `browser.mutate`, `network.read`,
`external.write`, and `subagent.spawn`. The effective authorization is an
intersection; presenting a capability does not grant it by itself.

Shell execution is deliberately opt-in. `shell.execute` must appear in both
`host_capabilities` and the explicit `authorization_granted` list, and the
command must exactly equal an entry in `shell_execute_allowlist`. Omitting
`authorization_granted` uses the mode defaults, which do not grant shell
execution. Wildcards, the legacy `authorized` placeholder, and compound shell
syntax are rejected. An accepted `shell.inspect` action uses one of the typed
read-only targets `git.status`, `git.diff`, `git.log`, `network.listen`,
`process.list`, or `runtime.logs`; it is not a raw command channel.

Network reads are also opt-in. `network.read` must appear in both capability
lists, and every target URL must have an exact hostname match in
`network_read_domains`. Schemes, paths, ports, credentials, and wildcards are
invalid allowlist entries. Subdomains are not implied. URL ports do not change
hostname authorization.

### `telic_ground_context`

Builds a bounded repository inventory, stores selected exact text once, and submits the controller-owned `ContextManifest`.

Input:

- `run_id`
- `action_id`: the latest `NextAction.id`
- `expected_run_version`: the current `run.version`
- optional `active_paths`
- optional `budget` with `max_files`, `max_file_bytes`, `max_total_bytes`, and `max_inventory_files`

The selector prefers Git metadata, then ripgrep, then a filesystem fallback. It rejects repository escapes and unsafe symlinks, excludes known generated/secret-like paths, applies heuristic content-secret filtering, ranks deterministically, and records exclusion counts. It reads repository files and writes only Telic state.

### `telic_get_next_action`

Input: `run_id`.

For a running phase, returns the logical role, input references, context
manifest, current work-node identifier when applicable, required artifact type
and JSON schema, accepted alternative/supporting schemas, effective permissions,
remaining budgets, and stop conditions.
It is idempotent for an unchanged run.

`inputRefs` is a bounded phase context projection, not an access-control list for
`telic_get_artifact`. The controller starts with the mandatory current artifacts,
closes transitive references among artifact types eligible for that phase, and
then fills remaining capacity with recent `Evidence`. It fails explicitly when
the mandatory closure exceeds 256 references instead of silently dropping a
dependency. `telic_get_artifact` may still inspect any immutable artifact in the
same run.

The controller returns phase, clarification, and terminal `NextAction` variants.
Clarification actions contain the stored request reference and no effective
permissions. Terminal actions contain the final status and report reference when
a `UserReport` exists.

### `telic_submit_artifact`

Submits either one strict phase artifact or one clarification response.

Artifact path:

- `run_id`
- `action_id`: the latest `NextAction.id`
- `expected_run_version`: the current `run.version`
- `artifact_type`
- `body`: canonical camelCase artifact body containing matching `id`, `runId`, and `schemaVersion`
- `body_json`: mutually exclusive JSON-string form of that same canonical body;
  use it only when a host cannot preserve required nested empty arrays in an
  object-valued tool argument
- optional `source_refs`: at most 256 unique, valid reference URIs

Clarification path:

- `run_id`
- `action_id`: the latest `NextAction.id`
- `expected_run_version`: the current `run.version`
- `clarification_response`: the exact identifier of one stored response choice

Do not combine the two paths. The server derives the producer role from the
expected artifact/phase; callers cannot self-assign it. Controller-owned
`RunEnvelope`, `ContextManifest`, `NextAction`, and `TraceEvent` bodies cannot be
supplied as host-role artifacts. `ScenarioSpec` is optional supporting
presentation after `ProblemFrame`. `Evidence` is supporting data captured during
the executor phase and must be referenced by later claims.

A run asks the user at most one clarification question. Its request contains two
to eight choices with typed `authorityEffect` and `runEffect` values. A
`within_current_authority`/`resume` choice resumes the paused phase without
broadening authority. A `cancel` or `new_run` choice terminates the current run;
`new_run` indicates that the requested authority must be supplied explicitly to a
separate run. The next resumed phase artifact must cite both the clarification
request and the stored answer. If a later phase submits another material
clarification boundary, the controller stores that boundary but routes directly
to an honest blocked `UserReport`; it does not ask the user a second question.

Supporting artifacts have bounded quotas. At most one `ScenarioSpec` may follow
the current `ProblemFrame`, and it remains presentation-only rather than an Agent
2 authority source. At most 128 `Evidence` artifacts may be captured for the
current `WorkPlan`. Evidence is accepted only during the executor phase, is
secret-scanned before storage, and uses a typed kind such as `repository`,
`runtime`, `browser`, `test`, `diff`, `tool_output`, or `log`.

`body_json` is parsed into the same strict object schema as `body`. It cannot
be combined with `body`, and it is not a permission escape hatch: required
empty permission arrays must remain empty.

### `telic_cancel_run`

Input: `run_id`, the latest `action_id`, and the latest
`expected_run_version`.

Terminates one non-terminal Telic run and returns a terminal cancellation next
action. It records no repository mutation and produces no `UserReport`. Use it
only after the user explicitly cancels the run.

### `telic_list_runs`

Optional input: `limit` from `1` to `100` (default `20`).

Returns newest-first, redacted metadata for runs in the local repository
ledger. It excludes original requests, repository roots, artifact bodies, and
evidence. Listing does not resume a run or attach a new request; call
`telic_get_run` only after the user selects a run to continue.

### `telic_get_run`

Input: `run_id`.

Returns deterministic run state, artifact metadata, and the current
`nextAction`. It does not return every body. The action is safe to inspect after
a transport reconnect but must still be used with its current version token.

### `telic_get_artifact`

Input: `run_id`, `artifact_id`.

Returns one hydrated immutable artifact after checking its stored digest. Cross-run lookup does not succeed.

### `telic_get_trace`

Input:

- `run_id`
- optional `after_sequence` (default `0`)
- optional `limit` from `1` to `500` (default `100`)

Returns an indexed, bounded page of strict canonical `TraceEvent` objects:
identifiers, sequences, timestamps, actors, protocol phases, input/output
references, concise rationale summaries, and budget snapshots. It never exposes
hidden chain-of-thought. The low-level diagnostic CLI currently retains the
ledger's internal event projection.

The ledger performs cursor and limit filtering in SQLite; the MCP server does not
materialize the complete run trace before returning a page.

## Canonical artifact families

| Owner/stage         | Artifact               | Purpose                                                                                          |
| ------------------- | ---------------------- | ------------------------------------------------------------------------------------------------ |
| Controller          | `RunEnvelope`          | Immutable request reference, host capabilities, mode, authorization, and budgets                 |
| Controller          | `ContextManifest`      | Selected/excluded repository context, hashes, reasons, and byte budgets                          |
| Controller          | `NextAction`           | One legal next action and its exact output contract                                              |
| Any pre-audit phase | `ClarificationRequest` | One inspected material decision or permission boundary with typed run effects                    |
| Agent 1             | `ProblemFrame`         | Facts, inferences, unknowns, scope, risks, acceptance criteria, and frozen rubric                |
| Agent 1             | `ScenarioSpec`         | Optional sourced presentation of the frame; it is not an authoritative compiler input            |
| Agent 2             | `TaskContract`         | Executable objective, constraints, permissions, evidence expectations, and done conditions       |
| Agent 1             | `PromptReview`         | Pass/revise/block decision against the frozen contract rubric                                    |
| Agent 3             | `WorkPlan`             | Validated serial node graph, required capabilities, budgets, and stop conditions                 |
| Agent 4             | `Evidence`             | Redacted repository, command, runtime, browser, test, diff, or user evidence                     |
| Agent 4             | `WorkResult`           | Findings, actions, changes, tests, evidence links, and unresolved issues                         |
| Agent 3             | `QualityReview`        | Acceptance/rule/permission review, typed diagnosis evidence gate, and bounded decision           |
| Agent 5             | `ReleaseAudit`         | Independent claim/evidence and mode-compliance audit                                             |
| Agent 5             | `UserReport`           | Terminal user-facing summary, claims, verification, risks, and trace reference                   |
| Controller          | `TraceEvent`           | Canonical observable transition/tool/permission/budget summary returned by the MCP trace surface |

The conceptual examples in [PROTOCOL.md](PROTOCOL.md) use a readable YAML notation and may use snake_case labels. They are explanatory, not copy-paste request bodies. Generate or inspect the executable schema from `packages/protocol/src/` and the `requiredOutputSchema` returned by the next action.

## CLI

After `npm run build`:

```text
telic doctor [--repo PATH] [--json]
telic status RUN_ID [--repo PATH] [--json]
telic trace RUN_ID [--repo PATH] [--json]
telic artifact RUN_ID ARTIFACT_ID [--repo PATH] [--json]
telic mcp
```

From a source checkout, use `node packages/cli/dist/bin.js` in place of `telic`. `status`, `trace`, and `artifact` open the repository-specific existing ledger; they do not create a run.

## State layout and deletion

Default base:

```text
${XDG_STATE_HOME:-$HOME/.local/state}/telic/repositories/<24-character repository hash>/
```

The hash is derived from the real absolute repository path, keeping runtime state out of the working tree. The directory contains `ledger.sqlite3` and the content-addressed body store. `TELIC_STATE_DIR` selects a different location for isolated tests or manual control.

Each run is capped at 2,048 artifacts and 10,000 trace events. The sum of node
`maximumToolCalls` reservations across accepted WorkPlans is capped at 4,000 per
run, and each plan's node reservations must fit its global budget. A node's tool
budget must cover its unique required capabilities; a required `subagent.spawn`
also needs a positive child budget. These are safety/storage limits, not an
automatic retention policy.

There is no per-run deletion command yet. To remove all Telic state for a repository, first stop every Telic process using that state directory, confirm the path reported by `doctor --json`, and remove that directory with normal OS tools. This is irreversible and deletes all runs for that repository.

## API limitations

- The MCP facade does not intercept or authorize calls made directly through host-native tools.
- MCP arguments and artifact schemas may change before a release.
- No browser provider, remote API, HTTP transport, telemetry, or inspector ships in the current vertical slice.
- Codex has the reference source plugin. Seven non-Codex source packs pass local
  config and transport checks but lack real-host lifecycle certification.
- State integrity is designed for local correctness, not hostile same-user tamper resistance.
- Trace responses are indexed and paginated, but age-based retention,
  automatic orphan-blob collection, and supported per-run deletion remain
  release work.
