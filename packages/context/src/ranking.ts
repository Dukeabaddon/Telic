import { isInstructionPath } from "./security.js";

const STOP_WORDS = new Set([
  "a",
  "about",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "can",
  "check",
  "code",
  "com",
  "could",
  "do",
  "does",
  "file",
  "fix",
  "for",
  "from",
  "have",
  "how",
  "in",
  "investigate",
  "is",
  "it",
  "me",
  "my",
  "of",
  "on",
  "or",
  "please",
  "project",
  "report",
  "review",
  "so",
  "task",
  "that",
  "the",
  "this",
  "to",
  "use",
  "using",
  "we",
  "what",
  "when",
  "where",
  "who",
  "why",
  "will",
  "with",
  "would",
  "you",
]);

export interface RankedCandidate {
  readonly path: string;
  readonly score: number;
  readonly pinned: boolean;
  readonly reason: string;
}

function lexicalCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function normalizeToken(token: string): string {
  if (
    token.length > 4 &&
    token.endsWith("s") &&
    !token.endsWith("ss") &&
    !token.endsWith("is") &&
    !token.endsWith("us")
  ) {
    return token.slice(0, -1);
  }
  return token;
}

function tokens(value: string): readonly string[] {
  const separated = value.replaceAll(/([a-z0-9])([A-Z])/g, "$1 $2");
  return (separated.toLowerCase().match(/[a-z0-9]+/gu) ?? []).map(
    normalizeToken,
  );
}

function requestTerms(request: string): readonly string[] {
  const terms = new Set<string>();
  for (const term of tokens(request)) {
    if (term.length >= 2 && !STOP_WORDS.has(term)) {
      terms.add(term);
    }
  }
  return [...terms].sort(lexicalCompare);
}

function requestPathHints(request: string): readonly string[] {
  const matches =
    request.match(/[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)+/gu) ?? [];
  return [
    ...new Set(
      matches.map((match) => match.replace(/^\.\//u, "").toLowerCase()),
    ),
  ].sort(lexicalCompare);
}

function isRootProjectMetadata(path: string): boolean {
  if (path.includes("/")) return false;
  return (
    path === "package.json" ||
    path === "package-lock.json" ||
    path === "pyproject.toml" ||
    path === "cargo.toml" ||
    path === "go.mod" ||
    path === "readme" ||
    path.startsWith("readme.") ||
    path === "tsconfig.json" ||
    (path.startsWith("tsconfig.") && path.endsWith(".json"))
  );
}

export function rankCandidates(
  paths: readonly string[],
  request: string,
  activePaths: readonly string[],
): readonly RankedCandidate[] {
  const terms = requestTerms(request);
  const pathHints = requestPathHints(request);
  const active = new Set(activePaths.map((path) => path.toLowerCase()));

  const ranked = paths.map((path): RankedCandidate => {
    const lowerPath = path.toLowerCase();
    const pathTokens = new Set(tokens(path));
    const basenameTokens = new Set(tokens(path.split("/").at(-1) ?? path));
    const instruction = isInstructionPath(path);
    const activeExact = active.has(lowerPath);
    const activeAncestor = [...active].some(
      (activePath) =>
        activePath.startsWith(`${lowerPath}/`) ||
        lowerPath.startsWith(`${activePath}/`),
    );
    const matchingHints = pathHints.filter(
      (hint) => lowerPath === hint || lowerPath.endsWith(`/${hint}`),
    );
    const matchingTerms = terms.filter((term) => pathTokens.has(term));
    const basenameTerms = matchingTerms.filter((term) =>
      basenameTokens.has(term),
    );
    const projectMetadata = isRootProjectMetadata(lowerPath);

    const pinned = instruction || activeExact;
    let score = pinned ? 1_000_000 : 0;
    score += activeExact ? 50_000 : activeAncestor ? 10_000 : 0;
    score += matchingHints.length * 5_000;
    score += basenameTerms.length * 250;
    score += (matchingTerms.length - basenameTerms.length) * 75;
    score += projectMetadata ? 20 : 0;

    let reason: string;
    if (instruction) {
      reason = "Applicable repository instruction source pinned by policy.";
    } else if (activeExact) {
      reason = "Exact active-path source pinned by the host context.";
    } else if (matchingHints.length > 0) {
      reason = `Path matches an explicit request hint: ${matchingHints.slice(0, 3).join(", ")}.`;
    } else if (matchingTerms.length > 0) {
      reason = `Path matches request terms: ${matchingTerms.slice(0, 5).join(", ")}.`;
    } else if (activeAncestor) {
      reason = "Path is adjacent to an active host path.";
    } else if (projectMetadata) {
      reason = "Root project metadata selected for bounded baseline context.";
    } else {
      reason =
        "Repository source selected by the deterministic budget fallback.";
    }
    return { path, score, pinned, reason };
  });

  return ranked.sort(
    (left, right) =>
      right.score - left.score || lexicalCompare(left.path, right.path),
  );
}
