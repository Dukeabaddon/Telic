# Installation and local runtime

**Status: public preview.** The npm package provides the portable `telic` CLI
and STDIO MCP server. Codex can install the plugin through this repository's Git
marketplace. The repository can also be built and materialized into six
experimental host packs. There is no curated Codex directory listing, signed
release, or full lifecycle certification yet.

## Requirements

- Every path: Node.js `>=24.15.0`
- Codex plugin: a current Codex CLI with plugin support and Git
- npm/portable MCP: npm or another `npx`-compatible npm client
- source development: npm; the repository already supplies `package-lock.json`
- optional Python 3 with `venv` and installed Codex system skills for the
  official Codex-only validation pass
- optional ripgrep; runtime context discovery falls back to the filesystem when
  ripgrep is unavailable, and can fall back when Git is unavailable after
  installation

No separate model API key, browser package, database server, service manager,
open port, or global npm install is required.

## Install from npm

Run without installing globally:

```bash
npx -y telic-mcp doctor --json
```

Or install the CLI:

```bash
npm install -g telic-mcp
telic doctor --json
```

For a STDIO MCP client, use:

```json
{
  "mcpServers": {
    "telic": {
      "command": "npx",
      "args": ["-y", "telic-mcp", "mcp"],
      "env": {
        "TELIC_REPOSITORY_ROOT": "/absolute/path/to/target-project"
      }
    }
  }
}
```

Add `TELIC_STATE_DIR` to the `env` object when you want isolated run state.

## Build and verify from source

From the repository root:

```bash
npm ci
npm run build
npm test
npm run test:coverage
npm run typecheck
npm run format:check
npm run check
node packages/cli/dist/bin.js doctor --json
```

`npm run build` compiles the workspaces, regenerates
`plugins/telic/dist/mcp/server.js`, and synchronizes the canonical skill and
bundle into the adapter packs. `npm run check` is clean-runner-safe: it runs
formatting, build, the threshold-enforced coverage suite, repository-local Codex
asset validation, marketplace validation, and adapter validation.

When Codex's official validator scripts are installed under `CODEX_HOME`
(default `~/.codex`), add the authoritative host-specific pass:

```bash
npm run check:official
```

The official wrapper creates an ignored virtual environment under `.cache/`
and installs hash-pinned PyYAML `6.0.3` on first use. It checks for the
machine-local validator before bootstrapping. Those official scripts are not a
repository dependency and are therefore not required by portable CI.

Most workspace packages are private implementation packages. `npm ci` installs
them for development; the public package is `telic-mcp`.

## Run the local MCP server

The standalone plugin bundle starts over STDIO:

```bash
TELIC_REPOSITORY_ROOT="$PWD" node plugins/telic/dist/mcp/server.js
```

Or use the built CLI:

```bash
TELIC_REPOSITORY_ROOT="$PWD" node packages/cli/dist/bin.js mcp
```

The server writes MCP protocol traffic to stdout and diagnostics to stderr. It exits when the client disconnects or sends a termination signal. There is no background daemon.

## Load the local Codex plugin

The source tree contains:

```text
plugins/telic/
├── .codex-plugin/plugin.json
├── .mcp.json
├── dist/mcp/server.js
└── skills/telic/
```

Build first so the bundled server matches the TypeScript source. Then add the
repository root as the local marketplace:

```bash
codex plugin marketplace add "$PWD" --json
codex plugin list --available --json
codex plugin add telic@dukeabaddon-telic --json
codex plugin list --json
codex mcp list --json
```

The marketplace has the stable ID `dukeabaddon-telic`, which avoids collisions
with a user's personal marketplace. Start a fresh Codex session after
installation so skill and MCP discovery use the installed snapshot.

Use the portable natural-language activation in a new prompt:

```text
Telic: investigate this repository. Analyze only; do not change files.
```

Telic enables description matching only for a request that asks for Telic by
name. For deterministic manual selection in Codex, use `/skills` or
`$telic:telic` as the technical fallback.

This is a development installation from the current working tree, not a published judge path. It modifies the user's Codex marketplace/plugin configuration, so review the displayed paths and output before proceeding.

For the public Git marketplace path, no source build is required:

```bash
codex plugin marketplace add Dukeabaddon/Telic --json
codex plugin add telic@dukeabaddon-telic --json
```

Codex reserves slash commands for its command surface. Do not add a deprecated
custom prompt only to manufacture `/telic` in Codex.

### Remove the preview install

```bash
codex plugin remove telic@dukeabaddon-telic --json
codex plugin marketplace remove dukeabaddon-telic --json
```

These commands remove Codex's installed plugin/cache and marketplace entry. They do not remove the source checkout or Telic run state.

## Materialize another host pack

Build and validate the shared packs first:

```bash
npm run build
npm run adapters:validate
npm run adapters:test
```

When `agy` or `kiro-cli` is already installed, their native schema validators
can also run:

```bash
npm run adapters:validate:native
```

The Claude Code and Antigravity directories are plugin-shaped source previews.
Cursor, Kiro IDE, Kiro CLI, Cline, and Roo are project overlays that must be merged into the
target repository rather than copied over existing configuration blindly. See
[`adapters/README.md`](../adapters/README.md) for exact paths, activation names,
and host-specific cautions. A successful local MCP handshake does not certify
install, permission, upgrade, or uninstall behavior in that host.

## Runtime lifecycle

```text
Codex resolves an explicit Telic request or selection
        |
        v
Codex launches plugin-provided Telic STDIO process
        |
        v
Host model calls nine deterministic Telic tools
        |
        v
Artifacts and trace persist in local XDG state
        |
        v
Codex disconnects; the process exits
```

The host model performs semantic work. The MCP process does not call or inherit the host model, and it has no model credential.

## State location

By default, each real repository path maps to:

```text
${XDG_STATE_HOME:-$HOME/.local/state}/telic/repositories/<repository-hash>/
```

The repository hash is the first 24 hexadecimal characters of a SHA-256 digest of the canonical absolute repository path. This keeps ledgers and exact selected source out of the working tree.

Override the complete directory when isolation or explicit cleanup is useful:

```bash
TELIC_STATE_DIR=/tmp/telic-demo-state \
  TELIC_REPOSITORY_ROOT="$PWD" \
  node plugins/telic/dist/mcp/server.js
```

Do not point `TELIC_STATE_DIR` inside a repository you may commit. Telic rejects unsafe state-directory symlinks, but users remain responsible for OS permissions, backups, and retention.

The CLI reports the resolved location:

```bash
TELIC_STATE_DIR=/tmp/telic-demo-state \
  node packages/cli/dist/bin.js doctor --repo "$PWD" --json
```

## Inspect an existing run

```bash
TELIC_STATE_DIR=/tmp/telic-demo-state \
  node packages/cli/dist/bin.js status RUN_ID --repo "$PWD" --json
TELIC_STATE_DIR=/tmp/telic-demo-state \
  node packages/cli/dist/bin.js trace RUN_ID --repo "$PWD" --json
TELIC_STATE_DIR=/tmp/telic-demo-state \
  node packages/cli/dist/bin.js artifact RUN_ID ARTIFACT_ID --repo "$PWD" --json
```

These commands require the same state directory used when the MCP server created
the run. Omit the prefix when the server used the default. They are read-only
ledger views; there is no visual inspector yet.

## Current support matrix

| Host/platform                                          | Current claim       | Notes                                                                                         |
| ------------------------------------------------------ | ------------------- | --------------------------------------------------------------------------------------------- |
| Codex plugin from a Linux source checkout              | Development preview | Plugin, skill, local marketplace, and bundled STDIO MCP are present                           |
| Seven non-Codex source packs                           | Experimental        | Config, generated bundle, skill sync, and STDIO handshake tested; lifecycle untested          |
| Antigravity CLI and Kiro CLI schemas                   | Locally validated   | `agy 1.1.1` and `kiro-cli 2.12.1`; installed host lifecycle remains untested                  |
| Codex CLI/IDE/desktop as separately certified surfaces | Not certified       | Requires clean install, lifecycle, and interaction evidence per surface                       |
| macOS                                                  | CI candidate        | CI is configured; require a passing clean run before claiming compatibility                   |
| Native Windows or WSL                                  | Not certified       | Filesystem safety, permission semantics, path handling, and lifecycle need dedicated evidence |
| Browser/DevTools providers                             | No provider shipped | Optional provider boundary remains planned                                                    |

## Troubleshooting

### Node check fails

Use a Node version satisfying `>=24.15.0`; the core uses the current built-in `node:sqlite` API.

### MCP starts for the wrong repository

Set `TELIC_REPOSITORY_ROOT` to the absolute target repository or ensure Codex launches the plugin with that repository as its working directory.

### No ledger exists

`status`, `trace`, and `artifact` do not create a run. Confirm the repository and `TELIC_STATE_DIR`, then start a run through MCP.

### Skill or MCP is missing after install

Run `npm run build`, validate the plugin, inspect `codex plugin list --json` and `codex mcp list --json`, and start a new Codex session. The installed skill's qualified name is `telic:telic`.

### `git` or `rg` is absent

Grounding falls back to the filesystem and records the selected inventory source and warnings. Install them only if desired; Telic does not install global tools.

## Release installation status

The public npm package is one bundled runner rather than five independently
versioned workspace packages:

```bash
npx -y telic-mcp doctor
npx -y telic-mcp mcp
```

The package has a `bin`, exact file allowlist, license/repository metadata,
packed-tarball inspection, clean temporary installation, doctor smoke test, and
MCP coverage through the repository test suite. Remaining distribution work is
trusted publishing/provenance, clean-machine install and uninstall evidence,
tested upgrade behavior, and a monitored vulnerability-reporting channel. It
does not need a model API key.
