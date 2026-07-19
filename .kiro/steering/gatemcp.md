---
inclusion: always
---

# Gate MCP usage

Use Gate MCP as the first-pass repository exploration path to reduce context usage. Gate is opt-in and does not intercept ordinary file reads.

- Call `gate_init` once near the start of repository-oriented work.
- Prefer `gate_graph_query` before broad searches or opening many files.
- Prefer `gate_compress_file` with `signature` depth for TypeScript/JavaScript and `structure` depth for JSON, YAML, and Markdown.
- Use `gate_dedup_context` before re-reading unchanged files when exact content is not required.
- Use normal file reads for exact implementation details, before editing a file, or when Gate reports incomplete/fallback output.
- Use `gate_session_stats` when reporting measured token savings; do not present modeled savings as observed results.
- Do not enable unrestricted paths or MCP proxy execution unless the user explicitly requests it.
- Use Graphify-backed Gate queries only when a current `graphify-out/GRAPH_REPORT.md` exists.
