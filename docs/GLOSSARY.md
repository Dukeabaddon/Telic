# Telic glossary

This glossary uses each term in the specific sense intended by the Telic design.

## Product and packaging

### Telic

The complete product: a portable protocol and local controller, a context/evidence plane, host adapters, an MCP facade, and an inspectable user experience. Telic is larger than any one skill or MCP server.

### Coding host

The AI development environment the user is already running, such as Codex, Claude Code, Cursor, Antigravity, or Kiro CLI. The host supplies the model session, permission sandbox, and whatever native agent or tool capabilities it supports.

### Host adapter

A thin host-specific layer that activates Telic and maps the host's rules, skills, tools, subagents, and permission surfaces to the portable Telic protocol. Telic ships a source-built Codex reference plugin and seven experimental host packs.

### Skill

A reusable workflow package centered on a `SKILL.md` instruction file, with optional resources and scripts. In Telic, the skill teaches the active host agent when to invoke Telic tools and how to produce the next typed artifact. The skill does not itself become a persistent server process.

### Plugin

An installable host package. A plugin may distribute skills, MCP configuration,
hooks, app mappings, and presentation assets according to that host's contract.
Telic has a local Codex reference plugin and experimental Claude Code and
Antigravity plugin-shaped packs. Their manifests are not the portable core or a
published release.

### MCP

Model Context Protocol, a standard connection between an AI host and tools or context providers. MCP describes how a host discovers and calls tools and resources. It does not universally intercept every user prompt, reuse the host model on its own, or guarantee that a host can spawn subagents.

### MCP server

A local or remote process exposing MCP tools, resources, and prompts. The Telic source preview ships a local STDIO process exposing nine controller, context, trace, recovery, and artifact operations plus the `telic_workflow` prompt. It contains deterministic runtime behavior and does not call a model API.

### MCP tool

A callable operation exposed by an MCP server, such as starting a Telic run, submitting an artifact, requesting the next phase, resolving an evidence reference, or inspecting status.

### MCP resource

Readable context exposed through MCP, such as a run manifest, task contract, trace event, or stored evidence artifact.

### STDIO server

A local MCP process launched by the coding host and connected over standard input/output. It normally starts on demand and exits with the host session; it does not require a separately managed web service.

## Agent model

### Logical role

A responsibility with a defined input and output contract: Intent Architect, Task Compiler, Quality Orchestrator, Executor, or Release Auditor. A logical role does not require a separate operating-system process or separate model account.

### Subagent

A distinct agent thread delegated by the coding host for a bounded task. Telic may request subagents for genuinely independent work when the host supports them. It must have a serial fallback.

### Multi-agent workflow

A controlled workflow in which multiple specialized agent threads or logical roles contribute typed results to one task. Telic is a multi-agent workflow when parallel or isolated agents are useful, but it can execute the same protocol serially.

### Swarm

A looser, often decentralized collection of agents that coordinate dynamically. Telic should not describe its core as a swarm: its deterministic controller owns the state machine, permissions, budgets, and handoffs.

### Harness

The deterministic environment around model reasoning: contracts, tool access, context selection, permissions, retries, tests, and evidence. “Agent harness” is a reasonable technical description of part of Telic.

### Orchestrator

The semantic role that creates a work plan and reviews execution results. In Telic, Agent 3 is the Quality Orchestrator. It does not directly own process scheduling or permission enforcement; the deterministic controller does.

### Controller

Non-AI code that validates artifacts, advances the state machine, intersects permissions, enforces budgets, schedules eligible work, and records the trace. It is the authoritative control plane.

## Contracts and evidence

### Problem frame

Agent 1's grounded interpretation of the original request: goal, facts with provenance, unknowns, scope, non-goals, project rules, authorization, and acceptance criteria. A human-readable scenario can be rendered from it.

### Task contract

Agent 2's typed, executable description of what must be achieved. It contains objective, intent mode, context references, scope, permissions, constraints, acceptance criteria, verification requirements, output format, and stopping conditions.

### Intent mode

The operation the user authorized: `report_only`, `analyze_only`, `fix_only`, `analyze_and_fix`, or `plan_only`. It constrains every later tool and agent action.

### Context pack

The bounded, role-specific input assembled from pinned instructions, selected repository excerpts, structural outlines, prior artifacts, and deltas. It records provenance and selection reasons.

### Artifact

A versioned typed object produced or consumed by a phase, such as a task contract, finding, change set, test result, quality review, or release audit.

### Artifact ledger

The local index of immutable inputs, outputs, raw evidence, hashes, relationships, state transitions, scores, denials, and retry use for a run.

### Evidence

An observable item supporting or contradicting a claim: a repository location, exact diff, command result, test output, browser request, console event, screenshot, runtime log, or configuration value. Model confidence alone is not evidence.

### Trace

The inspectable sequence of phase inputs and outputs, decisions, tool calls, artifact references, budgets, and concise rationale summaries. It is designed for debugging and trust.

### Rationale summary

A short, user-facing explanation of why a decision was made, grounded in inputs and evidence. It is not hidden chain-of-thought, private scratch work, or a token-by-token reasoning transcript.

### Compression

Reducing repeated context through relevance selection, structural outlines, deduplication, artifact references, and delta handoffs. Lossy natural-language compression is optional and deferred; immutable instructions and evidence are never eligible for it.

### Browser capability provider

An adapter presenting a normalized set of browser actions and evidence—navigation, console, network, screenshots, performance, or framework inspection—from a host-native browser, Chrome DevTools MCP, `agent-browser`, or a future provider.
