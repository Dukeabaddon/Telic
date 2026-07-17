# Telic documentation

**Status: executable source preview plus forward design.** Read [STATUS.md](STATUS.md) before repeating a product claim. Executable contracts in `packages/protocol/src/` override conceptual examples.

## Fast reading paths

For a user or hackathon judge:

1. [Current status and limitations](STATUS.md)
2. [Product definition](PRODUCT.md)
3. [Source-preview installation](INSTALLATION.md)
4. [Source-preview demo](DEMO.md)
5. [API reference](API.md)
6. [Architecture](ARCHITECTURE.md)
7. [Security policy](../SECURITY.md)
8. [Contribution guide](../CONTRIBUTING.md)

For an adapter or core contributor:

1. [Current API](API.md)
2. [Architecture](ARCHITECTURE.md)
3. [Conceptual protocol](PROTOCOL.md)
4. [Quality model](QUALITY.md)
5. [Security policy](../SECURITY.md)
6. [Host adapters](ADAPTERS.md)

## Document map

| File                                 | Question                                                      | Status                                      |
| ------------------------------------ | ------------------------------------------------------------- | ------------------------------------------- |
| [`STATUS.md`](STATUS.md)             | What works today, and where is the trust boundary?            | Current                                     |
| [`API.md`](API.md)                   | What tools, commands, artifacts, and paths exist?             | Current source preview                      |
| [`PRODUCT.md`](PRODUCT.md)           | Who is Telic for, and what outcome does it own?               | Current product; target experience marked   |
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | What implements the vertical slice, and what remains planned? | Mixed; boundaries labeled                   |
| [`PROTOCOL.md`](PROTOCOL.md)         | What enters and leaves each logical phase?                    | Conceptual; schemas are authoritative       |
| [`QUALITY.md`](QUALITY.md)           | What evidence is sufficient, and how are loops bounded?       | Normative design with partial enforcement   |
| [`EXAMPLE_RUN.md`](EXAMPLE_RUN.md)   | What should a complete diagnosis look like?                   | Illustrative, not a recorded run            |
| [`ADAPTERS.md`](ADAPTERS.md)         | What is shared, and what changes by coding host?              | Codex reference; seven experimental packs   |
| [`INSTALLATION.md`](INSTALLATION.md) | How can a developer build and load the preview?               | Current source flow; release flow planned   |
| [`DEMO.md`](DEMO.md)                 | How can a developer demonstrate the source preview safely?    | Codex current; Antigravity path exploratory |
| [`THIRD_PARTY.md`](THIRD_PARTY.md)   | What is installed, optional, or merely inspirational?         | Current inventory                           |
| [`GLOSSARY.md`](GLOSSARY.md)         | What do skill, plugin, MCP, role, swarm, and trace mean?      | Current terminology                         |

## Architecture decisions

- [ADR-0001: Portable core with a Codex-first plugin](adr/0001-product-shape.md)
- [ADR-0002: Conditional clarification and bounded retries](adr/0002-clarification-and-retries.md)
- [ADR-0003: Browser access as an optional capability](adr/0003-browser-capability.md)

ADRs preserve the status and wording of decisions when they were recorded. A `Proposed` label in an older ADR is historical; [STATUS.md](STATUS.md) records what was subsequently implemented.

## Source-of-truth order

1. `packages/protocol/src/` for canonical camelCase artifact serialization.
2. `packages/core/src/` for deterministic transition and ledger behavior.
3. `packages/mcp/src/server-factory.ts` for the live MCP tool surface.
4. [`API.md`](API.md) for a human-readable current reference.
5. [`PROTOCOL.md`](PROTOCOL.md) for rationale and conceptual examples.

## Documentation rules

- Use **current** only for behavior present and verified in the repository.
- Use **planned**, **candidate**, or **deferred** for unimplemented behavior.
- Keep source-preview commands distinct from published-release commands.
- Do not turn conceptual snake_case YAML into a canonical API claim; current artifact bodies are strict camelCase with `schemaVersion: "1.0"`.
- Link changing external-product and hackathon claims to primary sources.
- Record material reversals in an ADR.
- Expose inputs, outputs, evidence, scores, decisions, and concise rationale summaries—never hidden chain-of-thought.

Private hackathon planning, presentation drafts, and source-material migration
notes are intentionally kept outside the public release tree.
