# Codex public-preview demo

This guide demonstrates the public Codex Git plugin. It also explains how the
local MCP process fits the six experimental host packs. Source development is
an alternate path; Telic is not a certified Antigravity integration.

## What the demo proves

The demo can show:

- a rough request becoming a typed, permission-bounded run;
- repository grounding and explicit evidence references;
- one contract review and one bounded remediation path;
- an inspectable local trace; and
- a final claim limited by the recorded evidence.

It does not prove that Telic intercepts every editor action, controls the host
model, provides hidden chain-of-thought, or supports an untested host surface.

## Prepare Telic

For a quick MCP-only demo, verify the npm package from the target project:

```bash
npx -y telic-mcp doctor --json
```

The public Codex plugin path does not require cloning or building Telic.

Requirements:

- Node.js `>=24.15.0`;
- npm;
- Git for the public marketplace install;
- a working Codex installation with plugin support; and
- optional ripgrep for faster runtime inventory.

Only when developing Telic from a source checkout:

```bash
npm ci
npm run build
npm test
node packages/cli/dist/bin.js doctor --json
```

Keep the Telic checkout separate from the repository being demonstrated. Use a
small test project without secrets.

## Install the local Codex plugin

For the shortest public demo path:

```bash
codex plugin marketplace add Dukeabaddon/Telic --json
codex plugin add telic@dukeabaddon-telic --json
codex plugin list --json
codex mcp list --json
```

For local source development after `npm run build`, replace the first command
with `codex plugin marketplace add "$PWD" --json` from the Telic checkout.

The repository uses the stable marketplace ID `dukeabaddon-telic`, so it does
not conflict with a user's personal marketplace. Start a fresh Codex session
after installation.

## Codex extension inside Antigravity

This is an exploratory setup, not a certified Antigravity claim.

Antigravity is the outer editor. The Codex extension remains the active coding
host. It reads Codex's plugin and MCP configuration. Antigravity's native Agent
panel has separate configuration and does not automatically receive tools from
the Codex extension.

1. Confirm the Codex extension opens and works in Antigravity.
2. Install Telic through the Codex commands above.
3. Reload the editor or start a new Codex chat.
4. Open the separate target project in Antigravity.
5. Open the Codex panel, not the native Antigravity Agent panel.
6. Confirm Telic appears in Codex's plugin/MCP listing.
7. Start with an explicit, non-mutating request.

Suggested demo request:

```text
Telic: investigate why this project is not talking to its API. Analyze only.
Do not change files. Inspect repository evidence and available runtime evidence.
If browser or DevTools access is unavailable, say so instead of inventing
results.
```

Expected high-level flow:

```text
request
  -> grounded problem frame
  -> task contract
  -> one prompt/contract review
  -> read-only work plan
  -> evidence-backed results
  -> quality and release reviews
  -> honest user report
```

The five logical roles can be performed serially by one host model. Separate
host subagents are optional. Telic itself does not choose their models or call a
model API.

## Inspect the run

Record the run ID shown by the workflow. Run the published CLI from any
terminal and point it at the target repository:

```bash
npx -y telic-mcp status RUN_ID --repo /absolute/path/to/target --json
npx -y telic-mcp trace RUN_ID --repo /absolute/path/to/target --json
```

Inspect one artifact when useful:

```bash
npx -y telic-mcp artifact RUN_ID ARTIFACT_ID \
  --repo /absolute/path/to/target --json
```

These commands match the plugin's default state path. For a clean recording,
launch the host with an isolated directory outside both repositories, then use
the same prefix for every inspection command:

```bash
TELIC_STATE_DIR="$HOME/.local/state/telic-demo" \
  npx -y telic-mcp status RUN_ID \
    --repo /absolute/path/to/target --json
```

Never switch state paths between execution and inspection.

## What “connect from a custom MCP client” means

The bundled file is a local STDIO MCP server. A compatible host normally
launches it as a child process and exchanges JSON-RPC messages through stdin
and stdout. It is not a web server, background daemon, chat application, or
model endpoint.

The process command is:

```bash
TELIC_REPOSITORY_ROOT=/absolute/path/to/target \
TELIC_STATE_DIR="$HOME/.local/state/telic-demo" \
node /absolute/path/to/Telic/plugins/telic/dist/mcp/server.js
```

When run directly in a terminal, it may appear idle because it is waiting for
an MCP client on stdin. Stop that manual process with `Ctrl-C`. Do not expect a
browser page or prompt.

Direct MCP connection is useful for:

- host-adapter development;
- protocol and transport debugging;
- custom MCP clients; and
- hosts that support STDIO MCP but do not yet have a Telic-native package.

MCP connectivity exposes deterministic tools. It does not automatically make a
host follow Telic's semantic workflow, route all native tools through Telic, or
reuse another extension's agent.

## Native host adapters

Claude Code, Cursor, Antigravity, Kiro, Roo Code, and Cline each own their skill,
rule, command, permission, and MCP configuration surfaces. An extension inside
an editor is still its own host boundary. One extension cannot assume access to
another extension's registered MCP tools or conversation.

The portable human request is `Telic: <your request>`. Host-native fallback
syntax differs: Codex uses `/skills` or `$telic:telic`, Claude Code uses
`/telic:telic`, Antigravity CLI, Cursor, Cline, and Roo use `/telic`, and Kiro
uses `/agent swap telic` followed by `/telic`. These packs remain previews until
install, discovery, sample run, permission, upgrade, and uninstall behavior is
tested on the named host. Read [adapter status](ADAPTERS.md) before repeating a
compatibility claim.

When two coding agents share a repository, run them serially or give each a
separate Git worktree. Concurrent mutation in one worktree can corrupt evidence
and invalidate review conclusions.

## Demo failure handling

- **Skill missing:** rebuild, inspect `codex plugin list --json` and
  `codex mcp list --json`, then start a new Codex session.
- **Wrong repository:** set `TELIC_REPOSITORY_ROOT` or relaunch from the target
  project.
- **No browser evidence:** keep the claim unverified or use repository/runtime
  evidence that is actually available.
- **No ledger:** starting `status` or `trace` does not create a run. Start the
  workflow first.
- **Unexpected mutation request:** stop. `analyze_only` is non-mutating; a fix
  requires a new authorized mode or run.
- **Two agents conflict:** stop both, inspect Git state, and resume in separate
  worktrees.

## Remove the local preview

```bash
codex plugin remove telic@dukeabaddon-telic --json
codex plugin marketplace remove dukeabaddon-telic --json
```

Removal does not delete the Telic checkout or its XDG state. Review and remove
the relevant state directory separately when its evidence is no longer needed.
