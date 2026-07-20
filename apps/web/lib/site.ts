import type { LucideIcon } from "lucide-react";
import {
  Braces,
  ClipboardCheck,
  FileSearch,
  Fingerprint,
  GitBranch,
  ListChecks,
  ScanSearch,
  ShieldCheck,
  TerminalSquare,
} from "lucide-react";

const vercelProductionHost = process.env.VERCEL_PROJECT_PRODUCTION_URL;

export const siteConfig = {
  name: "Telic",
  description:
    "The workflow spine for coding agents. Turn rough requests into repository-grounded, permission-aware, evidence-linked workflows.",
  url:
    process.env.NEXT_PUBLIC_SITE_URL ??
    (vercelProductionHost
      ? `https://${vercelProductionHost}`
      : "https://telic.vercel.app"),
  github: "https://github.com/Dukeabaddon/Telic",
  npm: "https://www.npmjs.com/package/telic-mcp",
  docs: "https://github.com/Dukeabaddon/Telic/tree/main/docs",
  issues: "https://github.com/Dukeabaddon/Telic/issues",
} as const;

export interface WorkflowStage {
  readonly id: string;
  readonly shortLabel: string;
  readonly title: string;
  readonly description: string;
  readonly input: string;
  readonly output: string;
  readonly icon: LucideIcon;
}

export const workflowStages: readonly WorkflowStage[] = [
  {
    id: "prompt",
    shortLabel: "Prompt",
    title: "Start with the request you have",
    description:
      "State the problem naturally. Telic preserves the original request and the authority boundary you choose.",
    input: "A rough developer request",
    output: "Immutable request and mode",
    icon: TerminalSquare,
  },
  {
    id: "context",
    shortLabel: "Context",
    title: "Ground the work in the repository",
    description:
      "Telic selects bounded, relevant repository context and records where each fact came from.",
    input: "Repository, rules, and active paths",
    output: "Bounded context manifest",
    icon: FileSearch,
  },
  {
    id: "frame",
    shortLabel: "Frame",
    title: "Frame the real problem",
    description:
      "Facts, inferences, unknowns, scope, risks, and acceptance criteria become explicit before execution.",
    input: "Request and grounded context",
    output: "Problem frame",
    icon: ScanSearch,
  },
  {
    id: "contract",
    shortLabel: "Structure",
    title: "Compile a task contract",
    description:
      "The request becomes structured requirements with permissions, evidence needs, constraints, and a definition of done.",
    input: "Problem frame",
    output: "Permission-bounded task contract",
    icon: Braces,
  },
  {
    id: "review",
    shortLabel: "Evaluate",
    title: "Review once before work starts",
    description:
      "Telic checks clarity, scope, and authority. One bounded revision is available when the contract needs correction.",
    input: "Task contract and frozen rubric",
    output: "Pass, revise, or block decision",
    icon: ClipboardCheck,
  },
  {
    id: "work",
    shortLabel: "Act",
    title: "Guide only authorized work",
    description:
      "The active coding host investigates, plans, or changes the project within the approved mode and contract.",
    input: "Reviewed contract and work plan",
    output: "Evidence and work result",
    icon: GitBranch,
  },
  {
    id: "verify",
    shortLabel: "Verify",
    title: "Check the evidence",
    description:
      "Claims are checked against acceptance criteria, permissions, repository rules, and submitted evidence.",
    input: "Work result and evidence",
    output: "Quality review and release audit",
    icon: ShieldCheck,
  },
  {
    id: "report",
    shortLabel: "Report",
    title: "Report without pretending",
    description:
      "The final result distinguishes what was proven, what changed, and what remains uncertain or unavailable.",
    input: "Audited claims and unresolved risk",
    output: "Evidence-linked user report",
    icon: ListChecks,
  },
] as const;

export const roles = [
  {
    id: "scenario-author",
    number: "01",
    name: "Scenario author",
    verb: "Understands",
    description:
      "Frames the repository-specific problem using facts, unknowns, scope, risks, and acceptance criteria.",
    creates: "Problem frame",
    checks: "Intent fidelity",
  },
  {
    id: "task-compiler",
    number: "02",
    name: "Task compiler",
    verb: "Structures",
    description:
      "Converts the problem frame into an executable contract with permissions, constraints, and evidence requirements.",
    creates: "Task contract",
    checks: "Required structure",
  },
  {
    id: "quality-controller",
    number: "03",
    name: "Quality controller",
    verb: "Controls",
    description:
      "Plans the work, checks scope and rules, and owns one bounded remediation when evidence shows a gap.",
    creates: "Work plan and quality review",
    checks: "Scope, rules, and completion",
  },
  {
    id: "executor",
    number: "04",
    name: "Executor",
    verb: "Acts",
    description:
      "Investigates, plans, or changes only inside the approved mode while capturing observable evidence.",
    creates: "Evidence and work result",
    checks: "Current permission ceiling",
  },
  {
    id: "release-auditor",
    number: "05",
    name: "Release auditor",
    verb: "Verifies",
    description:
      "Checks claim-to-evidence links and mode compliance before producing the final user-facing report.",
    creates: "Release audit and user report",
    checks: "Evidence and report consistency",
  },
] as const;

export const proofPoints = [
  {
    title: "Context before action",
    description:
      "Bounds repository context before the host starts semantic work.",
    icon: FileSearch,
    marker: "01",
  },
  {
    title: "Explicit authority",
    description:
      "Makes scope and permissions inspectable. Missing permission is denied.",
    icon: Fingerprint,
    marker: "02",
  },
  {
    title: "Bounded workflow",
    description:
      "One contract revision and one shared remediation. No endless loop.",
    icon: GitBranch,
    marker: "03",
  },
  {
    title: "Evidence-linked reporting",
    description:
      "Completion claims reference evidence; unavailable checks stay unverified.",
    icon: ShieldCheck,
    marker: "04",
  },
] as const;

export const comparisonRows = [
  ["Scope can expand silently", "Intent and authority become explicit"],
  ["Context may be guessed", "Repository context is selected with bounds"],
  ["“Done” may be unsupported", "Completion claims reference evidence"],
  ["Review can continue indefinitely", "Revision and remediation are bounded"],
  ["Missing checks invite assumptions", "Unknowns remain clearly unverified"],
] as const;

export const hosts = [
  "Codex",
  "Claude Code",
  "Cursor",
  "Kiro IDE",
  "Antigravity",
  "Cline",
  "Roo Code",
] as const;

export interface InstallGuide {
  readonly id: string;
  readonly label: string;
  readonly status: string;
  readonly title: string;
  readonly description: string;
  readonly commands: string;
  readonly windowsCommands?: string;
  readonly next: string;
  readonly technicalFallback?: string;
}

export const installGuides: readonly InstallGuide[] = [
  {
    id: "codex",
    label: "Codex",
    status: "Reference plugin",
    title: "Install the complete Codex plugin",
    description:
      "The Git marketplace plugin includes both the Telic workflow skill and its local MCP server.",
    commands: `node --version
git --version
codex --version
codex plugin marketplace add Dukeabaddon/Telic --json
codex plugin add telic@dukeabaddon-telic --json
codex plugin list --json
codex mcp list --json`,
    next: "Restart Codex or reload its IDE extension. Start a new chat, then write: Telic: <your request>.",
    technicalFallback: "Select Telic through /skills or use $telic:telic.",
  },
  {
    id: "kiro",
    label: "Kiro IDE",
    status: "Source adapter",
    title: "Add the Kiro workspace overlay",
    description:
      "Build Telic once, then merge its workspace agent, skill, launcher, and MCP entry into your target project.",
    commands: `git clone https://github.com/Dukeabaddon/Telic.git
cd Telic
npm ci
npm run build
export TELIC_ROOT="$PWD"
export TARGET="/absolute/path/to/target-project"
cp -R "$TELIC_ROOT/adapters/kiro-ide/project/.kiro" "$TARGET/"`,
    next: "Open the target project itself in Kiro, reload the workspace, confirm the telic MCP server, and select the Telic agent.",
    technicalFallback:
      "If .kiro already exists, merge only the Telic-owned paths and MCP entry. Do not overwrite other agents or servers.",
  },
  {
    id: "claude",
    label: "Claude Code",
    status: "Source adapter",
    title: "Load the Claude Code source plugin",
    description:
      "Use the checked-in plugin directory for one development session after building the shared bundle.",
    commands: `git clone https://github.com/Dukeabaddon/Telic.git
cd Telic
npm ci
npm run build
export TELIC_ROOT="$PWD"
cd /absolute/path/to/target-project
claude --plugin-dir "$TELIC_ROOT/adapters/claude-code/telic"`,
    next: "Run /telic:telic <request>. Use /help and /mcp to confirm discovery.",
  },
  {
    id: "cursor",
    label: "Cursor",
    status: "Source adapter",
    title: "Merge the Cursor project overlay",
    description:
      "Copy the Telic skill and bundle, then merge the telic MCP server entry into the project configuration.",
    commands: `git clone https://github.com/Dukeabaddon/Telic.git
cd Telic
npm ci
npm run build
export TELIC_ROOT="$PWD"
export TARGET="/absolute/path/to/target-project"
cp -R "$TELIC_ROOT/adapters/cursor/project/.cursor" "$TARGET/"`,
    windowsCommands: `$telicRoot = "C:\\path\\to\\Telic"
$target = "C:\\path\\to\\target-project"
Copy-Item -Recurse -Force "$telicRoot\\adapters\\cursor\\project\\.cursor" $target`,
    next: "Reload Cursor, confirm telic under MCP settings, and run /telic <request>.",
    technicalFallback:
      "For an existing .cursor directory, merge the Telic-owned skill, bundle, and MCP entry instead of replacing it.",
  },
  {
    id: "portable",
    label: "Portable MCP",
    status: "Published npm package",
    title: "Connect the local MCP server",
    description:
      "The npm package supplies deterministic tools and a portable workflow prompt for compatible STDIO MCP clients.",
    commands: `npx -y telic-mcp doctor --json

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
}`,
    windowsCommands: `npx -y telic-mcp doctor --json

{
  "mcpServers": {
    "telic": {
      "command": "npx",
      "args": ["-y", "telic-mcp", "mcp"],
      "env": {
        "TELIC_REPOSITORY_ROOT": "C:\\\\Users\\\\you\\\\source\\\\repos\\\\target-project"
      }
    }
  }
}`,
    next: "Add a host skill, command, or equivalent workflow driver that follows telic_get_next_action.",
    technicalFallback:
      "The doctor command verifies the local package. It is not a complete host installation by itself.",
  },
] as const;
