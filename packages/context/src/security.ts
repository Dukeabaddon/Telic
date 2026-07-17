import { constants } from "node:fs";
import { access, lstat, realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";

import { ContextInputError, ContextSecurityError } from "./types.js";

const EXCLUDED_DIRECTORY_NAMES = new Set([
  ".git",
  ".telic",
  "build",
  "coverage",
  "dist",
  "node_modules",
]);

const ROOT_INSTRUCTION_FILES = new Set([
  ".cursorrules",
  ".windsurfrules",
  "AGENTS.md",
  "CLAUDE.md",
  "CODEX.md",
  "GEMINI.md",
]);

export const DEFAULT_PINNED_PATHS = [
  "AGENTS.md",
  "CLAUDE.md",
  "CODEX.md",
  "GEMINI.md",
  ".cursorrules",
  ".windsurfrules",
  ".github/copilot-instructions.md",
] as const;

export function isPathContained(root: string, target: string): boolean {
  const fromRoot = relative(root, target);
  return (
    fromRoot === "" ||
    (!fromRoot.startsWith(`..${sep}`) &&
      fromRoot !== ".." &&
      !isAbsolute(fromRoot))
  );
}

export function normalizeRepositoryPath(candidate: string): string | null {
  if (
    candidate.length === 0 ||
    candidate.length > 1_024 ||
    candidate.includes("\0") ||
    candidate.includes("\\")
  ) {
    return null;
  }

  const normalized = candidate.replace(/^\.\//u, "").replace(/\/{2,}/gu, "/");
  if (
    normalized.length === 0 ||
    normalized === "." ||
    normalized.startsWith("/") ||
    normalized
      .split("/")
      .some((segment) => segment === "" || segment === "." || segment === "..")
  ) {
    return null;
  }
  return normalized;
}

export function isExcludedDirectoryPath(repositoryPath: string): boolean {
  const segments = repositoryPath.toLowerCase().split("/");
  return segments.some((segment) => EXCLUDED_DIRECTORY_NAMES.has(segment));
}

export function isSecretLikePath(repositoryPath: string): boolean {
  const segments = repositoryPath.toLowerCase().split("/");
  const basename = segments.at(-1) ?? "";
  return (
    basename.startsWith(".env") ||
    basename === ".git-credentials" ||
    basename === ".netrc" ||
    basename === ".npmrc" ||
    basename === ".pypirc" ||
    segments.some((segment) => /^(?:credentials?|secrets?)$/u.test(segment)) ||
    /^(?:credentials?|secrets?)(?:\.|$)/u.test(basename) ||
    /^service-account(?:\.|-|_)/u.test(basename) ||
    /^id_(?:dsa|ecdsa|ed25519|rsa)(?:\.|$)/u.test(basename) ||
    /\.(?:key|p12|pfx|pem)$/u.test(basename)
  );
}

/**
 * Conservative credential detector used before exact repository content is
 * persisted. This intentionally favors exclusion over attempting to redact a
 * value whose boundaries may be ambiguous. It is not a general-purpose secret
 * scanner and callers must continue to treat selected context as sensitive.
 */
export function containsLikelySecret(content: string): boolean {
  const credentialPatterns = [
    /-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----/u,
    /\bAKIA[0-9A-Z]{16}\b/u,
    /\bgh[pousr]_[A-Za-z0-9]{20,}\b/u,
    /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/u,
    /\b(?:api[_-]?key|authorization|client[_-]?secret|password|secret|token)\b\s*[:=]\s*["']?(?!\$\{|<|example\b|placeholder\b|redacted\b|changeme\b)(?:[A-Za-z0-9_+./:@=-]){8,}["']?/iu,
  ] as const;
  return credentialPatterns.some((pattern) => pattern.test(content));
}

export function isInstructionPath(repositoryPath: string): boolean {
  const segments = repositoryPath.split("/");
  const basename = segments.at(-1) ?? "";
  if (
    ROOT_INSTRUCTION_FILES.has(basename) ||
    basename === "copilot-instructions.md"
  ) {
    return true;
  }
  const lower = repositoryPath.toLowerCase();
  return (
    lower.startsWith(".roo/rules/") ||
    lower.startsWith(".cursor/rules/") ||
    lower.startsWith(".agents/rules/") ||
    lower.startsWith(".github/instructions/")
  );
}

export async function resolveExistingRepositoryPath(
  root: string,
  repositoryPath: string,
): Promise<{
  readonly absolutePath: string;
  readonly isSymlink: boolean;
} | null> {
  const normalized = normalizeRepositoryPath(repositoryPath);
  if (normalized === null) {
    return null;
  }
  const lexicalPath = resolve(root, ...normalized.split("/"));
  if (!isPathContained(root, lexicalPath)) {
    throw new ContextSecurityError(
      "Repository path escapes the resolved repository root.",
    );
  }

  const linkInfo = await lstat(lexicalPath);
  const resolvedPath = await realpath(lexicalPath);
  if (!isPathContained(root, resolvedPath)) {
    throw new ContextSecurityError(
      linkInfo.isSymbolicLink()
        ? "Repository symlink resolves outside the repository root."
        : "Repository path resolves outside the repository root.",
    );
  }
  const resolvedInfo = await stat(resolvedPath);
  if (!resolvedInfo.isFile()) {
    return null;
  }
  return { absolutePath: resolvedPath, isSymlink: linkInfo.isSymbolicLink() };
}

export async function validateActivePath(
  root: string,
  value: string,
): Promise<string> {
  if (value.length === 0 || value.length > 4_096 || value.includes("\0")) {
    throw new ContextInputError(
      "Active paths must be non-empty repository-relative paths.",
    );
  }

  let normalized: string;
  if (isAbsolute(value)) {
    const lexical = resolve(value);
    if (!isPathContained(root, lexical)) {
      throw new ContextSecurityError(activePathBoundaryMessage(root, value));
    }
    normalized = relative(root, lexical).split(sep).join("/");
  } else {
    normalized = normalizeRepositoryPath(value) ?? "";
    if (normalized.length === 0) {
      throw new ContextSecurityError(activePathBoundaryMessage(root, value));
    }
  }

  const lexical = resolve(root, ...normalized.split("/"));
  if (!isPathContained(root, lexical)) {
    throw new ContextSecurityError(activePathBoundaryMessage(root, value));
  }

  try {
    await access(lexical, constants.F_OK);
    const resolvedPath = await realpath(lexical);
    if (!isPathContained(root, resolvedPath)) {
      throw new ContextSecurityError(activePathBoundaryMessage(root, value));
    }
  } catch (error) {
    if (error instanceof ContextSecurityError) {
      throw error;
    }
    // A not-yet-created active file is still a useful lexical hint.
  }
  return normalized;
}

function activePathBoundaryMessage(root: string, value: string): string {
  return `Active path ${JSON.stringify(value)} is outside Telic's repository root ${JSON.stringify(root)}. Remove it from active_paths or start a run with TELIC_REPOSITORY_ROOT set to the containing project.`;
}

export function makeRepoRef(repositoryPath: string): `repo://${string}` {
  const encoded = repositoryPath
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  return `repo://${encoded}`;
}

export function isProbablyBinary(prefix: Uint8Array): boolean {
  if (prefix.length === 0) {
    return false;
  }
  let suspiciousControls = 0;
  for (const byte of prefix) {
    if (byte === 0) {
      return true;
    }
    if (byte < 9 || (byte > 13 && byte < 32)) {
      suspiciousControls += 1;
    }
  }
  return suspiciousControls / prefix.length > 0.1;
}
