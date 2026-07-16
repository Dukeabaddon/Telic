# Host adapters

**Status:** A source-built Codex plugin and six experimental host packs are
present. Every pack passes repository validation and a local STDIO handshake.
Antigravity and Kiro schemas also pass the locally installed host CLIs. None of
the non-Codex packs has completed its real-host lifecycle certification.

## Boundary

Telic's schemas, controller, repository grounding, artifact storage, and MCP tools are portable TypeScript packages. A host adapter supplies the semantic turn driver: it activates the workflow, lets the current host model author the requested artifact, exposes available capabilities, and presents progress/results.

MCP is the deterministic tool and ledger boundary. It is not a universal prompt interceptor, model API, subagent API, or host sandbox. An MCP-capable host does not become a conforming Telic adapter merely by connecting to the server.

The no-extra-model-API flow is:

1. The user explicitly asks Telic to perform the workflow, selects its skill,
   uses a host command, or selects the `telic_workflow` MCP prompt.
2. The adapter calls `telic_start_run`, then passes its action/version tokens to `telic_ground_context`.
3. It asks `telic_get_next_action` for the one legal role and output schema.
4. The active host model performs that logical role with bounded references.
5. The adapter submits the canonical artifact through `telic_submit_artifact` with the latest action/version tokens.
6. The loop ends on clarification or a terminal report.

When native subagents are available, an adapter may isolate one controller-authorized semantic role in a bounded child. The current controller still advances WorkPlan nodes serially. When subagents are unavailable or unknown, the same host model performs every logical role serially. Telic never claims five persistent model processes.

## Portable responsibilities

The current portable packages own:

- strict artifact schemas and camelCase serialization;
- state transitions and bounded review/remediation budgets;
- run-scoped references and immutable artifact bodies;
- requested mode and effective permission projection;
- repository inventory, ranking, budgets, and source provenance;
- SQLite/content-addressed local persistence; and
- seven STDIO MCP operations, one portable workflow prompt, and CLI inspection.

They do not own host prompt routing, model inference, native agent creation, editor UI, or host tool approvals.

## Adapter responsibilities

| Boundary     | Adapter responsibility                                                                                  |
| ------------ | ------------------------------------------------------------------------------------------------------- |
| Invocation   | Provide an explicit way to activate Telic with the user's complete request and mode                     |
| Capabilities | Report the current surface's actual tools and subagent availability; unknown is valid                   |
| Turn driving | Request the next action, give the model only the referenced inputs, and submit the strict output        |
| Tool use     | Stay within the action/contract permissions and the host's sandbox/approval system                      |
| Evidence     | Capture/redact observable results, submit `Evidence`, and cite it from results and claims               |
| Presentation | Show phase, validation errors, clarification, final report, and trace without exposing chain-of-thought |
| Lifecycle    | Start the local server with the correct repository/state and stop it on disconnect                      |

Adapters must not emulate an unsupported capability and report it as native.

## Codex reference adapter

The repository currently ships:

```text
plugins/telic/
├── .codex-plugin/plugin.json
├── .mcp.json
├── dist/mcp/server.js
└── skills/
    └── telic/
        ├── SKILL.md
        ├── agents/openai.yaml
        └── references/
```

The plugin is the distribution shape; the skill is the semantic workflow; `.mcp.json` launches the local tool/ledger process. The installed qualified skill name is `telic:telic`.

The skill tells Codex how to:

- select the least-authorizing outcome mode;
- iterate through next actions and strict artifacts;
- distinguish observations from inferences;
- capture redacted supporting evidence in the executor phase;
- honor one contract revision and bounded remediation; and
- report concise rationale and evidence rather than hidden chain-of-thought.

The plugin includes presentation metadata and a local vector mark. It has no
hooks, browser provider, or custom host-tool interceptor. Direct Codex
editor/shell/browser actions do not pass through the Telic MCP server. The skill
and artifact reviewers can constrain and audit those actions, while preventive
enforcement remains Codex sandbox/user approval policy.

See [Installation](INSTALLATION.md) for the local marketplace flow and [API](API.md) for the MCP prompt and seven tools.

## Capability negotiation

A run records the host name, native-subagent state (`available`, `unavailable`, or `unknown`), declared capabilities, and explicit authorization. Effective capability is an intersection, not a union.

Portable capability identifiers include repository read/write, shell inspection/execution, runtime inspection/restart, browser inspection/mutation, network read/external write, and subagent spawning. An adapter should advertise only capabilities it can actually use on the current surface. Missing optional capability causes a downgrade; a capability required for an acceptance criterion causes an honest partial/blocked result or a material clarification.

## Source-preview adapter packs

`Telic: <your request>` is the portable human-facing intent. The table lists
the deterministic native fallback when description-based matching is unavailable.

`npm run build` copies the canonical skill and model-free MCP bundle into each
pack. `npm run adapters:validate` checks paths, hashes, approval defaults, and
host-specific configuration. The adapter smoke test launches every generated
server and verifies `telic_workflow` plus the exact seven tools.

| Target          | Native fallback                    | Pack shape                 | Evidence and remaining boundary                                     |
| --------------- | ---------------------------------- | -------------------------- | ------------------------------------------------------------------- |
| Codex           | `$telic:telic`                     | Native source plugin       | Reference pack; full clean lifecycle remains a release gate         |
| Claude Code     | `/telic:telic`                     | Native source plugin       | Config and transport tested; Claude lifecycle untested              |
| Antigravity CLI | `/telic`                           | Native source plugin       | `agy 1.1.1` schema passes; installed working directory unproven     |
| Cursor          | `/telic`                           | Project `.cursor/` overlay | Config and transport tested; IDE/CLI lifecycle untested             |
| Kiro CLI        | `/agent swap telic`, then `/telic` | Project `.kiro/` overlay   | `kiro-cli 2.12.1` schema passes; lifecycle untested                 |
| Cline           | `/telic`                           | Project `.cline/` overlay  | Experimental Skills must be enabled; MCP UI may still need checking |
| Roo Code        | `/telic`                           | Legacy `.roo/` overlay     | Confirm installed version; upstream routes and layouts have changed |

The complete layouts and cautions are in [`adapters/README.md`](../adapters/README.md).
No adapter should promise identical behavior merely because its host supports
MCP. Portability comes from the shared artifact protocol and explicit
capability downgrades.

## Extension and cloud boundary

The active AI extension owns its models, tools, rules, and MCP connections. An
outer VS Code-compatible editor does not make separate extensions share those
capabilities. Codex inside Antigravity can use the Codex plugin; Antigravity's
native Agent panel needs the Antigravity pack. Roo, Cline, and Cursor likewise
cannot inherit another extension's registered Telic server.

A local extension can use Telic when it supports STDIO MCP and a workflow
activation surface. A cloud-only agent cannot reach the user's local Telic
process unless it can install and run the package inside its own sandbox or a
separately secured remote MCP transport is provided.

## Adapter conformance target

Before an adapter is called supported, record evidence for:

1. explicit activation and mode tie-breaking;
2. capability detection without host-name assumptions;
3. complete logical-serial workflow without native subagents;
4. strict artifact and reference round trips;
5. preservation of non-mutation modes;
6. evidence capture and redaction;
7. missing-tool/browser behavior;
8. process disconnect and restart/resume behavior;
9. install, upgrade, and clean uninstall; and
10. exact host version, surface, and OS.

Native parallel execution is planned, not a current conformance feature.
Host-enforced mediation requires an explicit hook/tool boundary and is not
implied by MCP conformance.
