# Telic

Turn a rough coding request into a permission-bounded, evidence-backed local
workflow.

Telic is a local MCP control plane for coding agents. It does not call a model
API or run a hosted service. The active coding host supplies the model; Telic
validates workflow artifacts, permissions, evidence references, and run state.

## Install

Run without a global install:

```bash
npx telic doctor --json
```

Or install globally:

```bash
npm install -g telic
telic doctor --json
```

Node.js `>=24.15.0` is required because Telic uses the built-in `node:sqlite`
module.

## MCP Server

For STDIO MCP clients:

```bash
TELIC_REPOSITORY_ROOT=/absolute/path/to/project npx telic mcp
```

Example MCP configuration:

```json
{
  "mcpServers": {
    "telic": {
      "command": "npx",
      "args": ["-y", "telic", "mcp"],
      "env": {
        "TELIC_REPOSITORY_ROOT": "/absolute/path/to/project"
      }
    }
  }
}
```

Use `TELIC_STATE_DIR` to store run state outside the repository when needed.

## Commands

```bash
telic doctor [--repo PATH] [--json]
telic status RUN_ID [--repo PATH] [--json]
telic trace RUN_ID [--repo PATH] [--json]
telic artifact RUN_ID ARTIFACT_ID [--repo PATH] [--json]
telic mcp
```

## Source, Docs, And Adapters

The full source repository includes the Codex source plugin, six experimental
host adapter packs, protocol docs, and conformance tests:

https://github.com/Dukeabaddon/Telic

## License

MIT
