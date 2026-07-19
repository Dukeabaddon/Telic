# Telic

> Rough request in. Evidence-backed workflow out.

[![npm](https://img.shields.io/npm/v/telic-mcp?label=telic-mcp)](https://www.npmjs.com/package/telic-mcp)
![Node.js](https://img.shields.io/badge/Node.js-%3E%3D24.15.0-339933)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

![Telic workflow: Prompt, Restructure, Evaluate, Act, Verify, Report](assets/telic-hero.png)

Telic is an opt-in workflow plugin, agent workflow compiler, and safety layer
for coding agents. Give it a rough request. Telic turns that request into
structured work, keeps the agent inside your permissions, checks the result,
and reports only what the evidence supports.

**Prompt. Restructure. Evaluate. Act. Verify. Report.**

Telic is local, model-independent, and available as a Codex plugin or portable
MCP package. It uses your coding host's active model. No separate model API key
or hosted Telic service is required.

## From rough request to verified result

Start with the way people naturally ask for help:

```text
Telic: Is the profession recommendation algorithm flawed, and are the school
recommendations appropriate for each profession? Analyze only. Do not change files.
```

Telic turns that into an inspectable workflow:

```mermaid
flowchart LR
    U["Your rough request"] --> C["Understand context"]
    C --> S["Frame the problem"]
    S --> R["Write requirements"]
    R --> Q["Review once"]
    Q --> W["Guide the work"]
    W --> V["Verify evidence"]
    V --> O["Report honestly"]
```

**What happens under the hood:** Telic studies the repository context, frames
the problem, creates structured requirements, reviews the task, guides the work
within your permissions, verifies the evidence, and produces an honest final
report.

The workflow uses five logical roles:

1. **Scenario author** understands the repository and frames the real problem.
2. **Task compiler** converts that understanding into clear requirements.
3. **Quality controller** checks scope, permissions, and completion criteria.
4. **Executor** investigates, plans, or changes the project when allowed.
5. **Release auditor** verifies the evidence before reporting back.

These roles can run serially through the active host model. Telic does not need
five hosted models or five external API calls.

## Why developers use Telic

| A normal agent session                 | A Telic workflow                               |
| -------------------------------------- | ---------------------------------------------- |
| A vague request can expand silently    | Intent, scope, and permissions become explicit |
| “Done” may be only an agent claim      | Completion claims must reference evidence      |
| Review can continue without a boundary | Contract revision and remediation are bounded  |
| Missing tools can invite guesses       | Unavailable checks remain clearly unverified   |

Telic gives the coding agent a workflow spine. It does not replace the agent.

## Install and use

Telic requires Node.js `>=24.15.0`. Open the setup that matches your coding
host. The portable request form is `Telic: <your request>`; each host also has
its own technical fallback when natural activation is unavailable.

<details open>
<summary><strong>Codex plugin</strong></summary>

You need Git and a current
[Codex CLI](https://learn.chatgpt.com/docs/codex/cli) with plugin support.

```bash
node --version
git --version
codex --version
codex plugin marketplace add Dukeabaddon/Telic --json
codex plugin add telic@dukeabaddon-telic --json
codex plugin list --json
codex mcp list --json
```

Restart Codex or reload its IDE extension. Start a new chat, then write:

```text
Telic: investigate why this project is not talking to its API. Analyze only.
```

The plugin includes the Telic skill and local MCP server. Do not add a second
Telic MCP server manually. If natural activation is unavailable, select Telic
through `/skills` or use `$telic:telic`.

</details>

<details>
<summary><strong>Portable npm CLI and MCP server</strong></summary>

Run Telic without a permanent global installation:

```bash
npx -y telic-mcp doctor --json
```

Or install the CLI globally:

```bash
npm install -g telic-mcp
telic doctor --json
```

A generic STDIO MCP client can launch Telic with:

```json
{
  "mcpServers": {
    "telic": {
      "command": "npx",
      "args": ["-y", "telic-mcp", "mcp"],
      "env": {
        "TELIC_REPOSITORY_ROOT": "/absolute/path/to/your-project"
      }
    }
  }
}
```

The npm package provides Telic's deterministic tools and portable workflow
prompt. Your host still needs a skill, command, or equivalent workflow driver.

</details>

<details>
<summary><strong>Claude Code, Cursor, Antigravity, Kiro IDE/CLI, Cline, and Roo Code</strong></summary>

Telic includes preview source adapters for these hosts. Kiro IDE and Kiro CLI
use separate packs. Each host stores skills, commands, and MCP configuration
differently, so setup is host-specific.

See [adapter setup](docs/ADAPTERS.md) for the correct files and activation
syntax. Do not copy an adapter over existing configuration without reviewing
the paths first.

</details>

For troubleshooting, removal, source builds, and state configuration, see the
complete [installation guide](docs/INSTALLATION.md).

## Choose what Telic may do

State the boundary in normal language:

| Mode              | What Telic may do                                   |
| ----------------- | --------------------------------------------------- |
| `report_only`     | Explain supplied facts or existing results          |
| `plan_only`       | Produce a plan without executing it                 |
| `analyze_only`    | Investigate without changing files or runtime state |
| `fix_only`        | Apply a known correction inside the approved scope  |
| `analyze_and_fix` | Diagnose first, then fix an evidenced root cause    |

Missing permission is denial. Telic does not silently broaden your request.

Use Telic for ambiguous diagnoses, risky changes, security-sensitive work, or
anything needing a clear evidence trail. Skip it for simple questions, typo
fixes, formatting, and obvious one-file edits.

## Local by design

Telic runs locally through STDIO and stores its run ledger outside your
repository. It does not provide a hosted model service or send work to a Telic
cloud. Selected source and submitted evidence can still be sensitive, so review
[Security](SECURITY.md) and [Privacy](PRIVACY.md) before using private projects.

## Project status

Telic is a public preview.

| Distribution                            | Support   |
| --------------------------------------- | --------- |
| Codex Git marketplace plugin            | Available |
| npm package `telic-mcp`                 | Published |
| Additional host adapters in `adapters/` | Preview   |

Read the [current implementation status](docs/STATUS.md) for exact technical
boundaries.

## Built with Codex and GPT-5.6

Telic was built through an iterative author–Codex collaboration during OpenAI
Build Week. The author set the product direction, selected the evidence and
permission boundaries, tested real host setups, and made the final decisions.
Codex with GPT-5.6 turned those decisions into code, tests, packaging, website
work, and release documentation.

The working method was deliberately dialectical: each promising idea was
challenged against its cost, safety, and portability before becoming part of
the product.

| Initial direction                                        | Challenge                                                         | Product decision                                                            |
| -------------------------------------------------------- | ----------------------------------------------------------------- | --------------------------------------------------------------------------- |
| A hosted prompt-engineering lab with many agents         | Extra accounts, API costs, and friction weaken developer adoption | A local workflow compiler that uses the coding host's active model          |
| An agent that acts as soon as it understands the request | Ambiguous work can silently exceed the user's authority           | Explicit modes, immutable handoffs, and missing-permission denial           |
| Five separate model agents                               | More model calls do not guarantee clearer responsibility          | Five logical roles that a host can run serially or with native subagents    |
| Broad cross-host claims                                  | A configuration file is not evidence of a working lifecycle       | A Codex reference plugin, preview adapters, and explicit support boundaries |

Codex was used end to end to compare architectures, implement the protocol and
packages, add focused tests, audit permission and artifact behavior, diagnose
installation failures, incorporate tester feedback, prepare npm/plugin assets,
and build the public website. The author continuously supplied the product
intent, approved tradeoffs, tested in real projects and IDEs, and rejected
claims that could not be demonstrated. This loop shaped Telic itself:

```text
idea -> challenge -> evidence -> implementation -> test -> review -> revision -> release
```

The result is not a generated demo alone. It is a tested local control plane,
an installable Codex plugin, a published npm package, and a public product
experience with documented limits.

## Develop Telic

```bash
git clone https://github.com/Dukeabaddon/Telic.git
cd Telic
npm ci
npm run check
```

See [Contributing](CONTRIBUTING.md) for the artifact-first workflow.

## Documentation

- [Installation](docs/INSTALLATION.md)
- [Example run](docs/EXAMPLE_RUN.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Protocol](docs/PROTOCOL.md)
- [API reference](docs/API.md)
- [Adapter setup](docs/ADAPTERS.md)
- [Current status](docs/STATUS.md)
- [Security](SECURITY.md)
- [Privacy](PRIVACY.md)

Use [GitHub Issues](https://github.com/Dukeabaddon/Telic/issues) for
reproducible, non-sensitive defects.

## License

Telic is released under the [MIT License](LICENSE).
