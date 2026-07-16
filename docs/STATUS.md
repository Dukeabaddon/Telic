# Telic implementation status

**Last checked:** July 16, 2026

Telic is an executable, local source preview. It is suitable for development and hackathon demonstration, not yet a supported release. The canonical truth for serialization is `packages/protocol/src/`; this page distinguishes current behavior from design targets elsewhere in the documentation.

## Current vertical slice

| Area            | Current behavior                                                                                                                                                         |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Protocol        | Strict Zod v4 schemas for controller, intent, serial execution, evidence, release, and trace artifacts; canonical bodies use camelCase and `schemaVersion: "1.0"`        |
| Controller      | Deterministic phase ordering, stage-aware verification preflight, one user-facing clarification, one contract revision, one shared remediation, and terminal reports     |
| Persistence     | SQLite metadata/events plus immutable SHA-256-addressed JSON bodies; digest verification occurs on read                                                                  |
| Context         | Bounded inventory; token-boundary path ranking; eight-file zero-score fallback cap; relevance/file/byte budgets; path, symlink, duplicate, and heuristic secret controls |
| MCP             | Local STDIO server with seven tools plus a host-neutral `telic_workflow` prompt                                                                                          |
| CLI             | npm-packaged and source-built `doctor`, `status`, `trace`, `artifact`, and `mcp` commands                                                                                |
| Host package    | Codex reference plugin plus six experimental source packs generated from one canonical skill and MCP bundle                                                              |
| Model access    | None in the runtime; the active host model authors semantic artifacts                                                                                                    |
| Network service | None required; normal transport is local STDIO                                                                                                                           |

Automated checks cover protocol fixtures/invariants, controller transitions, permissions, ledger behavior, context selection/security controls, MCP service/tools, CLI behavior, an end-to-end artifact pipeline, and the standalone plugin handshake. The current verification commands are listed in [Installation](INSTALLATION.md); test totals are intentionally not frozen in prose.

## Current workflow boundary

Telic deterministically controls its own run state and artifact acceptance. A host asks for a `NextAction`, performs the named logical role, and submits the required artifact. The controller validates the schema, legal phase, references, retry budgets, and applicable mode/permission invariants before appending it.

`report_only` and `plan_only` do not enter the executor phase. `analyze_only` is a non-mutation mode. `fix_only` permits only contract-scoped mutation. `analyze_and_fix` is the intended diagnosis-then-change mode. Its protocol requires separate diagnosis and completion criteria, a typed directly evidenced root-cause gate before `proceed_to_fix`, and a new bounded WorkPlan before mutation. The controller enforces cross-artifact lineage, reference target types, capability/evidence compatibility, required verification, exact rule coverage, and terminal claim/report consistency. These are artifact-acceptance controls; adapters must still rely on explicit host approvals because Telic does not intercept host-native actions.

Clarification is not an open-ended planning conversation. A run may pause once
for two to eight typed choices after inspected evidence is recorded. A bounded
choice resumes without broader authority. Cancellation and new-authorization
choices terminate the current run; a permission expansion must be expressed in a
new run. A second material boundary is recorded for audit but routes to a blocked
report without another user question.

The canonical Telic skill is the semantic driver and remains explicitly opt-in.
Description matching is enabled only so a request that asks for Telic by name,
such as `Telic: <your request>`, can resolve without a qualified host command.
Questions and discussions about Telic itself remain outside the workflow.
Compatible MCP clients may
instead retrieve the host-neutral `telic_workflow` prompt. Telic does not
automatically intercept user prompts, invoke a host model, or guarantee separate
agents. The run records whether native subagents are available, but the current
controller accepts serial WorkPlans only and does not schedule parallel workers.

## Security reality

Current controls include strict schemas, bounded inputs, missing-reference rejection, cross-run checks, transitive phase-input closure, content digests, local state permissions, repository containment, path/symlink rejection, context budgets, secret-like filename exclusion, heuristic content-secret detection, exact shell-command allowlisting, exact network-read hostname allowlisting, typed read-only shell targets, evidence-kind checks, and trace-safe summaries.

Important limits:

- **Host-native actions are not intercepted.** If Codex or another host uses its own shell, editor, browser, or repository tool directly, the Telic MCP server is not in that call path. Telic artifact acceptance and review can reject or expose an unauthorized result; prevention still depends on host sandboxing, approvals, and adapter compliance.
- **Same-user state is not an adversarial vault.** SHA-256 and SQLite consistency detect ordinary corruption and mismatches. A malicious process with the same OS account and filesystem access may be able to replace metadata and blobs together. Use OS permissions and an isolated account/workspace for stronger separation.
- **Secret scanning is heuristic.** It can miss uncommon credentials and can exclude harmless text. Do not ground repositories containing secrets you are unwilling to store locally, and do not treat the context selector as a dedicated secret scanner.
- **Exact local artifacts may be sensitive.** Selected source and submitted evidence are stored exactly in the content-addressed store. Hashing is identity/integrity metadata, not anonymization.
- **Repository/browser content is untrusted data.** The protocol preserves provenance, but a host model can still be influenced by malicious content. Host/system instructions and applicable project rules must remain higher priority.
- **Scenario prose is not semantically proven equivalent.** `ScenarioSpec` is
  presentation-only, stored at most once per frame, and excluded from Agent 2's
  authoritative inputs. The controller does not prove that arbitrary narrative
  prose is contradiction-free.
- **No retention/deletion UX is shipped.** Users can remove a repository's state directory manually; a supported per-run deletion command and retention policy remain work items.
- **Retention controls are basic.** Runs are capped at 2,048 artifacts and
  10,000 trace events, accepted WorkPlan node reservations share a cumulative
  4,000-tool-call ceiling,
  each current WorkPlan is capped at 128 Evidence artifacts, and MCP trace reads
  use indexed pagination. There is no age-based retention or automatic
  orphan-blob garbage collection yet.
- **Trace surfaces differ.** MCP returns strict canonical `TraceEvent` objects;
  the low-level CLI still exposes the ledger's internal record for diagnostics.
- **Cancellation has no final report.** Early contract blocks now require an
  honest blocked `UserReport`; an explicit cancellation or new-run clarification
  choice terminates the current run with a null report reference.

This project is not a security boundary against a compromised host, OS account,
or deliberately unsafe tool policy.

## Not shipped yet

- real-host install, permission, lifecycle, upgrade, and uninstall certification
  for the Claude Code, Cursor, Antigravity, Kiro, Cline, and Roo source packs
- browser/DevTools providers and provider-driven evidence capture (the generic typed browser Evidence kind exists)
- host-enforced mediation of every repository, shell, runtime, network, or browser action
- visual inspector or web application
- curated Codex directory listing, signed release artifact, or full clean-machine lifecycle certification
- native parallel-work scheduling guarantees across hosts
- runtime Tree-sitter/LSP/code-graph retrieval and lossy semantic compression (development-only Graphifyy/Gate-MCP use is recorded separately)
- team sync, remote storage, telemetry, or hosted model service
- supported upgrade, uninstall, retention, and per-run deletion flows
- one canonical trace projection shared by MCP and the diagnostic CLI
- a user-facing cancellation/new-run handoff beyond the terminal `NextAction`
- a public vulnerability-reporting address

## Platform and distribution claim

The npm package provides the portable `telic` CLI and STDIO MCP server. The
Codex plugin is installable through this repository's public Git marketplace
and bundles a Node.js MCP server. Six additional source packs pass repository validation and a local STDIO
contract smoke test; Antigravity and Kiro also pass locally installed CLI schema
validators. That is not the same as a published host marketplace release or
real-host certification. Linux x86-64 is the active development environment.
Ubuntu and macOS are configured as CI targets in the current candidate, but a
passing remote run is required before broadening the claim. Native Windows and
WSL need explicit filesystem, permission, and lifecycle work.

## Next release gates

1. Close any remaining independent permission, cross-artifact, and multi-node audit findings.
2. Run all repository checks from a clean checkout on the claimed platforms.
3. Verify local marketplace install, MCP discovery, sample run, upgrade, and uninstall.
4. Add a deterministic demo fixture with honest browser-unavailable behavior.
5. Complete the dependency and security review, then publish a monitored
   vulnerability-reporting channel.
6. Publish a pinned artifact and record its checksum, repository URL, and Build Week session evidence.
