import type { IntentMode } from "./types.js";
import type { RunTopology } from "./types.js";

const ELEVATED_CAPABILITIES = new Set([
  "repository.write",
  "repository.delete",
  "shell.execute",
  "runtime.restart",
  "browser.mutate",
  "external.write",
  "subagent.spawn",
]);

const COMPLEXITY_PATTERN =
  /\b(refactor|migrate|architecture|security audit|across (the )?codebase|multi-?file)\b/i;
const DIVERGENCE_PATTERN =
  /\b(either|or both|unclear|not sure|choose between)\b/i;

export interface ClassifyRunInput {
  originalRequest: string;
  requestedMode: IntentMode;
  granted: string[];
  shellExecuteAllowlist?: string[];
  networkReadDomains?: string[];
  topologyOverride?: RunTopology | null;
}

export interface ClassifyRunResult {
  topology: RunTopology;
  rationaleCode: string;
  signals: string[];
}

function forensicSignals(input: ClassifyRunInput): string[] {
  const signals: string[] = [];
  if (input.requestedMode === "analyze_and_fix")
    signals.push("ANALYZE_AND_FIX");
  if (input.granted.some((cap) => ELEVATED_CAPABILITIES.has(cap))) {
    signals.push("ELEVATED_CAPABILITY");
  }
  if ((input.networkReadDomains?.length ?? 0) > 0) signals.push("NETWORK_READ");
  if ((input.shellExecuteAllowlist?.length ?? 0) > 0) {
    signals.push("SHELL_EXECUTE_ALLOWLIST");
  }
  const trimmed = input.originalRequest.trim();
  if (trimmed.length > 512 || trimmed.split("\n").length > 12) {
    signals.push("LONG_REQUEST");
  }
  if (COMPLEXITY_PATTERN.test(trimmed)) signals.push("COMPLEXITY_KEYWORD");
  return signals.sort();
}

const SINGLE_FILE_PATH =
  /\b(?:[\w.-]+\/)*[\w.-]+\.(?:ts|tsx|js|jsx|md|json|css|html|py|rs|go)\b/i;

function passesMicroFixGate(input: ClassifyRunInput): boolean {
  if (input.requestedMode !== "fix_only") return false;
  const trimmed = input.originalRequest.trim();
  if (trimmed.length > 200 || trimmed.split("\n").length > 5) return false;
  if (DIVERGENCE_PATTERN.test(trimmed)) return false;
  if (COMPLEXITY_PATTERN.test(trimmed)) return false;
  const granted = new Set(input.granted);
  if (!granted.has("repository.read") || !granted.has("repository.write")) {
    return false;
  }
  for (const capability of granted) {
    if (capability !== "repository.read" && capability !== "repository.write") {
      return false;
    }
  }
  const paths = trimmed.match(SINGLE_FILE_PATH) ?? [];
  const uniquePaths = [...new Set(paths.map((path) => path.toLowerCase()))];
  return uniquePaths.length === 1;
}

function passesMicroGate(input: ClassifyRunInput): boolean {
  const trimmed = input.originalRequest.trim();
  if (input.requestedMode !== "report_only") return false;
  if (trimmed.length > 200 || trimmed.split("\n").length > 5) return false;
  if (DIVERGENCE_PATTERN.test(trimmed)) return false;
  if (input.granted.some((cap) => cap !== "repository.read")) return false;
  return true;
}

export function classifyRun(input: ClassifyRunInput): ClassifyRunResult {
  const forensic = forensicSignals(input);
  if (input.topologyOverride) {
    if (input.topologyOverride === "micro") {
      const microEligible = passesMicroGate(input) || passesMicroFixGate(input);
      if (forensic.length > 0 || !microEligible) {
        throw new Error(
          "topologyOverride micro is incompatible with the current request signals",
        );
      }
      return {
        topology: "micro",
        rationaleCode: passesMicroFixGate(input)
          ? "MICRO_SHORT_FIX_ONLY"
          : "MICRO_SHORT_REPORT_ONLY",
        signals: [
          passesMicroFixGate(input)
            ? "MICRO_SHORT_FIX_ONLY"
            : "MICRO_SHORT_REPORT_ONLY",
        ],
      };
    }
    if (input.topologyOverride === "standard" && forensic.length > 0) {
      throw new Error(
        "topologyOverride standard is incompatible with forensic classification signals",
      );
    }
    const signal =
      input.topologyOverride === "forensic"
        ? "OVERRIDE_FORENSIC"
        : "OVERRIDE_STANDARD";
    return {
      topology: input.topologyOverride,
      rationaleCode: signal,
      signals: [signal, ...forensic].sort(),
    };
  }

  if (input.requestedMode === "fix_only" && passesMicroFixGate(input)) {
    return {
      topology: "micro",
      rationaleCode: "MICRO_SHORT_FIX_ONLY",
      signals: ["MICRO_SHORT_FIX_ONLY"],
    };
  }

  if (forensic.length > 0) {
    return {
      topology: "forensic",
      rationaleCode: forensic[0]!,
      signals: forensic,
    };
  }

  if (
    input.requestedMode === "analyze_only" &&
    input.granted.some((cap) =>
      ["runtime.inspect", "browser.inspect", "shell.inspect"].includes(cap),
    )
  ) {
    return {
      topology: "standard",
      rationaleCode: "INVESTIGATIVE_MODE",
      signals: ["INVESTIGATIVE_MODE"],
    };
  }
  if (input.requestedMode === "plan_only") {
    return {
      topology: "standard",
      rationaleCode: "PLAN_ONLY",
      signals: ["PLAN_ONLY"],
    };
  }
  if (input.requestedMode === "fix_only") {
    return {
      topology: "standard",
      rationaleCode: "FIX_ONLY",
      signals: ["FIX_ONLY"],
    };
  }
  if (passesMicroGate(input)) {
    return {
      topology: "micro",
      rationaleCode: "MICRO_SHORT_REPORT_ONLY",
      signals: ["MICRO_SHORT_REPORT_ONLY"],
    };
  }

  return {
    topology: "standard",
    rationaleCode: "DEFAULT_STANDARD",
    signals: ["DEFAULT_STANDARD"],
  };
}
