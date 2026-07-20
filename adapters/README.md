# Telic host adapter previews

These packs map one local Telic MCP runtime and its canonical skill into each
host's native configuration layout. They do not add model APIs, intercept host
tools, or make one editor extension control another.

Build before using a pack:

```bash
npm ci
npm run build
npm run adapters:validate
npm run adapters:test
```

The build copies the standalone MCP bundle and canonical skill into every pack.
Project overlays must be merged into a target repository; do not overwrite an
existing host configuration blindly.

Use `Telic: <your request>` as the portable human-facing intent when the host
supports description-based skill matching. The table lists each host's native
fallback.

| Host            | Preview layout                    | Native fallback                                    |
| --------------- | --------------------------------- | -------------------------------------------------- |
| Claude Code     | `claude-code/telic/` plugin       | `/telic:telic`                                     |
| Antigravity CLI | `antigravity/telic/` plugin       | `/telic`; native IDE activation remains unverified |
| Cursor          | `cursor/project/.cursor/` overlay | `/telic`                                           |
| Kiro IDE        | `kiro-ide/project/.kiro/` overlay | select **Telic**, then `Telic: <request>`          |
| Kiro CLI        | `kiro/project/.kiro/` overlay     | `/agent swap telic`, then `/telic`                 |
| Cline           | `cline/project/.cline/` overlay   | enable experimental Skills, then `/telic`          |
| Roo Code        | `roo-code/project/.roo/` overlay  | `/telic`                                           |

`agy` and `kiro-cli` schemas can be checked when those CLIs are installed:

```bash
npm run adapters:validate:native
```

Only schema and local transport smoke checks are automated here. Each host still
needs lifecycle, permission, and user-interface certification before its pack is
called production-supported.

The transport smoke test resolves every bundled server from the adapter's
source-preview root, connects over STDIO, and verifies the shared MCP prompt and
nine-tool contract. This proves the generated files agree with the checked-in
configurations. It does not prove that a host launches them from the same working
directory. In particular, Antigravity accepts the relative MCP path during
plugin validation, but its installed plugin lifecycle and working-directory
behavior remain uncertified.

Cline currently exposes different configuration storage paths across its CLI,
IDE extension, and older releases. This preview targets the current project
path, `.cline/mcp.json`. Merge it with the configuration used by the active
surface, and do not register a second `telic` entry through a legacy global path.

Roo Code's current documentation is also reachable through legacy GitHub Pages
URLs, and older Roo/Cline-derived releases use different customization layouts.
This preview targets current `.roo/mcp.json`, `.roo/skills/`, and
`.roo/commands/` behavior only. Confirm those paths against the installed Roo
version before treating the adapter as supported.

## Try a source pack

Build once, then set absolute paths:

```bash
export TELIC_ROOT=/absolute/path/to/Telic
export TARGET=/absolute/path/to/target-project
cd "$TELIC_ROOT"
npm ci
npm run build
```

### Claude Code

The development flag loads the plugin for one session and leaves no persistent
installation:

```bash
cd "$TARGET"
claude --plugin-dir "$TELIC_ROOT/adapters/claude-code/telic"
```

Run `/telic:telic <request>`. Use `/help` and `/mcp` to confirm discovery. End
the session to unload the source plugin.

### Antigravity CLI

Install the staged plugin, then start `agy` in the target project:

```bash
agy plugin install "$TELIC_ROOT/adapters/antigravity/telic"
agy plugin list
cd "$TARGET"
agy
```

Run `/telic <request>`. Remove the preview with
`agy plugin uninstall telic`. The native Antigravity IDE panel is a separate,
unverified lifecycle.

### Cursor

If the target has no `.cursor/` directory, copy the complete overlay:

```bash
cp -R "$TELIC_ROOT/adapters/cursor/project/.cursor" "$TARGET/"
```

PowerShell equivalent:

```powershell
$telicRoot = "C:\\path\\to\\Telic"
$target = "C:\\path\\to\\target-project"
Copy-Item -Recurse -Force "$telicRoot\\adapters\\cursor\\project\\.cursor" $target
```

If `.cursor/` already exists, copy only `skills/telic/` and `telic/`, then merge
the `mcpServers.telic` object from the preview `mcp.json` into the existing
`.cursor/mcp.json`. Reload Cursor, confirm `telic` under MCP settings, and run
`/telic <request>`. Removal means deleting only those two Telic directories and
the `telic` MCP entry.

### Kiro IDE

Kiro IDE and Kiro CLI use different agent formats. This preview uses Kiro IDE's
workspace MCP configuration, workspace skill, and Markdown custom agent.

If the target has no `.kiro/` directory, copy the complete overlay:

```bash
cp -R "$TELIC_ROOT/adapters/kiro-ide/project/.kiro" "$TARGET/"
```

For an existing `.kiro/`, merge the Telic-owned `settings/mcp.json` server
entry, `agents/telic.md`, `skills/telic/`, and `telic/` paths. Do not replace
other MCP servers or agents. Trust the workspace, enable MCP support in Kiro if
needed, and save the MCP configuration. Kiro reconnects after the file saves.
Confirm the local `telic` server in the MCP Servers panel, select **Telic** in
the agent selector, then send `Telic: <request>`.

The agent is instructed to show a concise phase/status line after each accepted
transition. To resume, ask it to resume Telic work; it lists local run metadata
and asks which run to continue. Cancellation records a terminal run state but
does not produce a final report. Confirm this behavior in your installed Kiro
IDE before relying on it.

This is a source-preview overlay. Its launcher derives
`TELIC_REPOSITORY_ROOT` from the checked-in `.kiro/` overlay rather than the
process working directory. The repository smoke test covers that local STDIO
behavior; Kiro's editor lifecycle remains unverified. Remove only the
Telic-owned paths and the `telic` MCP entry to uninstall.

### Kiro CLI

If the target has no `.kiro/` directory, copy the complete overlay:

```bash
cp -R "$TELIC_ROOT/adapters/kiro/project/.kiro" "$TARGET/"
cd "$TARGET"
kiro-cli --agent telic
```

For an existing `.kiro/`, merge the Telic-owned `agents/telic.json`,
`skills/telic/`, and `telic/` paths instead of replacing the directory. Within a
running Kiro session, `/agent list` confirms discovery and `/agent swap telic`
selects it. Then run `/telic <request>`. Remove only those three Telic-owned
paths to uninstall the overlay.

### Cline

If the target has no `.cline/` directory, copy the complete overlay:

```bash
cp -R "$TELIC_ROOT/adapters/cline/project/.cline" "$TARGET/"
```

For an existing `.cline/`, copy `skills/telic/` and `telic/`, then merge the
`mcpServers.telic` object into `.cline/mcp.json`. In Cline, enable
**Settings → Features → Enable Skills**, confirm both the skill and MCP server,
then run `/telic <request>`. Remove only those Telic paths and MCP entry.

### Roo Code

If the target has no `.roo/` directory, copy the complete overlay:

```bash
cp -R "$TELIC_ROOT/adapters/roo-code/project/.roo" "$TARGET/"
```

For an existing `.roo/`, copy `commands/telic.md`, `skills/telic/`, and
`telic/`, then merge `mcpServers.telic` into `.roo/mcp.json`. Reload Roo, confirm
the MCP server, and run `/telic <request>`. Remove only those Telic paths and MCP
entry.

Every path above is a source-preview procedure. Back up existing host config
before merging. A successful discovery check is not release certification.

## Host documentation used

- [Claude Code plugins](https://code.claude.com/docs/en/plugins)
- [Antigravity CLI plugins](https://antigravity.google/docs/cli-plugins)
- [Cursor commands](https://docs.cursor.com/en/agent/chat/commands)
- [Kiro CLI custom agents](https://kiro.dev/docs/cli/custom-agents/creating/)
- [Kiro CLI skills](https://kiro.dev/docs/cli/skills/)
- [Cline skills](https://docs.cline.bot/customization/skills)
- [Roo Code MCP](https://docs.roocode.com/features/mcp/using-mcp-in-roo)

Re-check the active host version before relying on a path. These products evolve
independently from Telic.
