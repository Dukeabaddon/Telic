import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";

import {
  discoverRepositoryFiles,
  fingerprintRepository,
  resolveRepositoryRoot,
} from "./inventory.js";
import { rankCandidates } from "./ranking.js";
import {
  DEFAULT_PINNED_PATHS,
  isExcludedDirectoryPath,
  isPathContained,
  containsLikelySecret,
  isInstructionPath,
  isProbablyBinary,
  isSecretLikePath,
  makeRepoRef,
  normalizeRepositoryPath,
  resolveExistingRepositoryPath,
  validateActivePath,
} from "./security.js";
import {
  ContextInputError,
  ContextSecurityError,
  type ContextDocument,
  type ContextManifest,
  type ContextTraceSummary,
  type ExcludedCandidateSummary,
  type ExclusionReason,
  type GroundingBudget,
  type GroundingBudgetInput,
  type GroundRepositoryInput,
  type GroundRepositoryResult,
  type SelectedContextSource,
} from "./types.js";

const DEFAULT_BUDGET: GroundingBudget = {
  max_files: 48,
  max_file_bytes: 128 * 1024,
  max_total_bytes: 512 * 1024,
  max_inventory_files: 20_000,
};

const HARD_LIMITS: GroundingBudget = {
  max_files: 256,
  max_file_bytes: 2 * 1024 * 1024,
  max_total_bytes: 16 * 1024 * 1024,
  max_inventory_files: 100_000,
};

const REQUEST_CHARACTER_LIMIT = 32_768;
const BINARY_PREFIX_BYTES = 8_192;
const MAX_ZERO_SCORE_FALLBACK_FILES = 8;

function sha256(value: Uint8Array | string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function assertPositiveInteger(
  name: string,
  value: number,
  hardLimit: number,
): void {
  if (!Number.isSafeInteger(value) || value <= 0 || value > hardLimit) {
    throw new ContextInputError(
      `${name} must be a positive integer no greater than ${String(hardLimit)}.`,
    );
  }
}

function resolveBudget(
  input: GroundingBudgetInput | undefined,
): GroundingBudget {
  const budget: GroundingBudget = {
    max_files: input?.max_files ?? DEFAULT_BUDGET.max_files,
    max_file_bytes: input?.max_file_bytes ?? DEFAULT_BUDGET.max_file_bytes,
    max_total_bytes: input?.max_total_bytes ?? DEFAULT_BUDGET.max_total_bytes,
    max_inventory_files:
      input?.max_inventory_files ?? DEFAULT_BUDGET.max_inventory_files,
  };
  assertPositiveInteger("max_files", budget.max_files, HARD_LIMITS.max_files);
  assertPositiveInteger(
    "max_file_bytes",
    budget.max_file_bytes,
    HARD_LIMITS.max_file_bytes,
  );
  assertPositiveInteger(
    "max_total_bytes",
    budget.max_total_bytes,
    HARD_LIMITS.max_total_bytes,
  );
  assertPositiveInteger(
    "max_inventory_files",
    budget.max_inventory_files,
    HARD_LIMITS.max_inventory_files,
  );
  return budget;
}

function increment(
  map: Map<ExclusionReason, number>,
  reason: ExclusionReason,
  count = 1,
): void {
  map.set(reason, (map.get(reason) ?? 0) + count);
}

function exclusionSummary(
  counts: ReadonlyMap<ExclusionReason, number>,
): readonly ExcludedCandidateSummary[] {
  return [...counts.entries()]
    .filter(([, count]) => count > 0)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([reason, count]) => ({ reason, count }));
}

async function addPinnedPaths(
  root: string,
  paths: Set<string>,
  shouldExclude: (repositoryPath: string) => boolean,
): Promise<void> {
  for (const pinnedPath of DEFAULT_PINNED_PATHS) {
    if (shouldExclude(pinnedPath)) continue;
    try {
      const info = await stat(resolve(root, ...pinnedPath.split("/")));
      if (info.isFile()) {
        paths.add(pinnedPath);
      }
    } catch {
      // Optional instruction source is absent.
    }
  }
}

function repositoryExclusionPrefixes(
  root: string,
  excludedRoots: readonly string[],
): readonly string[] {
  const prefixes = new Set<string>();
  for (const excludedRoot of excludedRoots) {
    if (isPathContained(excludedRoot, root)) {
      prefixes.add("");
    } else if (isPathContained(root, excludedRoot)) {
      prefixes.add(relative(root, excludedRoot).split(sep).join("/"));
    }
  }
  return [...prefixes];
}

function isExcludedRepositoryPath(
  repositoryPath: string,
  prefixes: readonly string[],
): boolean {
  const normalized = normalizeRepositoryPath(repositoryPath);
  if (normalized === null) return false;
  return prefixes.some(
    (prefix) =>
      prefix.length === 0 ||
      normalized === prefix ||
      normalized.startsWith(`${prefix}/`),
  );
}

/**
 * Opens the final path component without following a symlink. The candidate was
 * already resolved during inventory, but a repository-controlled process could
 * replace it between that check and this read. Keeping the handle open means
 * the bytes checked here are the bytes later persisted in the context ledger.
 *
 * This is intentionally not part of the package barrel; tests import it from
 * this module to exercise the filesystem boundary directly.
 */
export async function readBoundedTextFile(
  absolutePath: string,
  maximumBytes: number,
): Promise<
  | {
      readonly kind: "text";
      readonly bytes: Uint8Array;
      readonly content: string;
    }
  | { readonly kind: "too_large" }
  | { readonly kind: "binary" }
  | { readonly kind: "invalid_utf8" }
> {
  const linkInfo = await lstat(absolutePath);
  if (linkInfo.isSymbolicLink()) {
    throw new ContextSecurityError(
      "Repository symlink cannot be opened as selected context.",
    );
  }
  const handle = await open(
    absolutePath,
    constants.O_RDONLY |
      (process.platform === "win32" ? 0 : constants.O_NOFOLLOW),
  );
  try {
    const info = await handle.stat();
    if (!info.isFile()) {
      return { kind: "binary" };
    }
    if (info.size > maximumBytes) {
      return { kind: "too_large" };
    }
    const prefix = Buffer.alloc(Math.min(BINARY_PREFIX_BYTES, info.size));
    if (prefix.length > 0) {
      await handle.read(prefix, 0, prefix.length, 0);
      if (isProbablyBinary(prefix)) {
        return { kind: "binary" };
      }
    }
    const bytes = new Uint8Array(await handle.readFile());
    try {
      const content = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      return { kind: "text", bytes, content };
    } catch {
      return { kind: "invalid_utf8" };
    }
  } finally {
    await handle.close();
  }
}

export function summarizeContextManifest(
  manifest: ContextManifest,
): ContextTraceSummary {
  return {
    context_manifest_id: manifest.id,
    repository_fingerprint: manifest.repository_fingerprint,
    inventory_source: manifest.inventory_source,
    candidate_files: manifest.budget.candidate_files,
    selected_refs: manifest.selected_sources.map((source) => source.ref),
    selected_files: manifest.budget.selected_files,
    selected_bytes: manifest.budget.selected_bytes,
    excluded_candidates: manifest.excluded_candidates,
    warnings: manifest.warnings,
  };
}

export async function groundRepository(
  input: GroundRepositoryInput,
): Promise<GroundRepositoryResult> {
  if (
    !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u.test(input.run_id) ||
    input.run_id.length > 128
  ) {
    throw new ContextInputError(
      "run_id must be a valid Telic identifier containing at most 128 characters.",
    );
  }
  if (Buffer.byteLength(input.request, "utf8") > REQUEST_CHARACTER_LIMIT) {
    throw new ContextInputError(
      `request must not exceed ${String(REQUEST_CHARACTER_LIMIT)} UTF-8 bytes.`,
    );
  }
  if (input.repository_root.length > 4_096) {
    throw new ContextInputError(
      "repository_root must not exceed 4096 characters.",
    );
  }
  if ((input.active_paths?.length ?? 0) > 256) {
    throw new ContextInputError(
      "active_paths must not contain more than 256 entries.",
    );
  }
  if ((input.excluded_roots?.length ?? 0) > 16) {
    throw new ContextInputError(
      "excluded_roots must not contain more than 16 entries.",
    );
  }
  const budget = resolveBudget(input.budget);
  const root = await resolveRepositoryRoot(input.repository_root);
  const excludedRoots: string[] = [];
  for (const excludedRoot of input.excluded_roots ?? []) {
    if (
      excludedRoot.length === 0 ||
      excludedRoot.length > 4_096 ||
      excludedRoot.includes("\0")
    ) {
      throw new ContextInputError(
        "excluded_roots entries must be non-empty paths of at most 4096 characters.",
      );
    }
    if (!isAbsolute(excludedRoot)) {
      throw new ContextInputError(
        "excluded_roots entries must be absolute directory paths.",
      );
    }
    const absoluteRoot = resolve(excludedRoot);
    try {
      excludedRoots.push(await realpath(absoluteRoot));
    } catch {
      excludedRoots.push(absoluteRoot);
    }
  }
  const excludedPrefixes = repositoryExclusionPrefixes(root, excludedRoots);
  const shouldExclude = (repositoryPath: string): boolean =>
    isExcludedRepositoryPath(repositoryPath, excludedPrefixes);
  const activePaths: string[] = [];
  for (const activePath of input.active_paths ?? []) {
    activePaths.push(await validateActivePath(root, activePath));
  }

  const inventory = await discoverRepositoryFiles(
    root,
    budget.max_inventory_files + 1,
    shouldExclude,
  );
  const warnings = [...inventory.warnings];
  const exclusions = new Map<ExclusionReason, number>();
  increment(exclusions, "excluded_directory", inventory.excludedPathCount);
  const uniquePaths = new Set<string>();
  for (const rawPath of inventory.paths) {
    const normalized = normalizeRepositoryPath(rawPath);
    if (normalized === null) {
      increment(exclusions, "invalid_path");
    } else {
      uniquePaths.add(normalized);
    }
  }
  await addPinnedPaths(root, uniquePaths, shouldExclude);
  for (const activePath of activePaths) {
    if (!shouldExclude(activePath)) uniquePaths.add(activePath);
  }

  const activePathSet = new Set(activePaths);
  const sortedInventory = [...uniquePaths].sort((left, right) => {
    const leftRequired = isInstructionPath(left) || activePathSet.has(left);
    const rightRequired = isInstructionPath(right) || activePathSet.has(right);
    if (leftRequired !== rightRequired) {
      return leftRequired ? -1 : 1;
    }
    return left < right ? -1 : left > right ? 1 : 0;
  });
  const discoveredCandidateCount = sortedInventory.length;
  if (sortedInventory.length > budget.max_inventory_files) {
    increment(
      exclusions,
      "inventory_budget",
      sortedInventory.length - budget.max_inventory_files,
    );
    sortedInventory.length = budget.max_inventory_files;
    warnings.push(
      "Repository inventory exceeded the configured candidate limit and was deterministically truncated.",
    );
  }

  const eligiblePaths: string[] = [];
  for (const repositoryPath of sortedInventory) {
    if (isExcludedDirectoryPath(repositoryPath)) {
      increment(exclusions, "excluded_directory");
    } else if (isSecretLikePath(repositoryPath)) {
      increment(exclusions, "secret_like_file");
    } else {
      eligiblePaths.push(repositoryPath);
    }
  }

  const ranked = rankCandidates(eligiblePaths, input.request, activePaths);
  const selectedSources: SelectedContextSource[] = [];
  const documents: ContextDocument[] = [];
  const hashesByPath = new Map<string, string>();
  const selectedHashes = new Set<string>();
  let selectedBytes = 0;
  let selectedZeroScoreFallbacks = 0;

  for (const candidate of ranked) {
    if (
      !candidate.pinned &&
      candidate.score === 0 &&
      selectedZeroScoreFallbacks >= MAX_ZERO_SCORE_FALLBACK_FILES
    ) {
      increment(exclusions, "low_relevance");
      continue;
    }
    if (selectedSources.length >= budget.max_files) {
      increment(exclusions, "file_count_budget");
      continue;
    }

    let resolvedPath: Awaited<ReturnType<typeof resolveExistingRepositoryPath>>;
    try {
      resolvedPath = await resolveExistingRepositoryPath(root, candidate.path);
    } catch (error) {
      if (error instanceof ContextSecurityError) {
        increment(
          exclusions,
          error.message.includes("symlink") ? "symlink_escape" : "path_escape",
        );
      } else {
        increment(exclusions, "unreadable_file");
      }
      continue;
    }
    if (resolvedPath === null) {
      increment(exclusions, "non_regular_file");
      continue;
    }
    if (
      excludedRoots.some((excludedRoot) =>
        isPathContained(excludedRoot, resolvedPath.absolutePath),
      )
    ) {
      increment(exclusions, "excluded_directory");
      continue;
    }

    let readResult: Awaited<ReturnType<typeof readBoundedTextFile>>;
    try {
      readResult = await readBoundedTextFile(
        resolvedPath.absolutePath,
        budget.max_file_bytes,
      );
    } catch {
      increment(exclusions, "unreadable_file");
      continue;
    }
    if (readResult.kind !== "text") {
      increment(
        exclusions,
        readResult.kind === "too_large"
          ? "file_too_large"
          : readResult.kind === "invalid_utf8"
            ? "invalid_utf8"
            : "binary_file",
      );
      continue;
    }

    if (containsLikelySecret(readResult.content)) {
      increment(exclusions, "secret_content");
      continue;
    }

    const contentHash = sha256(readResult.bytes);
    hashesByPath.set(candidate.path, contentHash);
    if (selectedHashes.has(contentHash)) {
      increment(exclusions, "duplicate_content");
      continue;
    }
    if (selectedBytes + readResult.bytes.byteLength > budget.max_total_bytes) {
      increment(exclusions, "total_bytes_budget");
      continue;
    }

    const ref = makeRepoRef(candidate.path);
    selectedHashes.add(contentHash);
    selectedBytes += readResult.bytes.byteLength;
    selectedSources.push({
      ref,
      path: candidate.path,
      reason: candidate.reason,
      content_hash: contentHash,
      size_bytes: readResult.bytes.byteLength,
      score: candidate.score,
      pinned: candidate.pinned,
    });
    if (!candidate.pinned && candidate.score === 0) {
      selectedZeroScoreFallbacks += 1;
    }
    documents.push({
      ref,
      path: candidate.path,
      content_hash: contentHash,
      size_bytes: readResult.bytes.byteLength,
      content: readResult.content,
    });
  }

  if ((exclusions.get("low_relevance") ?? 0) > 0) {
    warnings.push(
      `Unpinned zero-relevance context was capped at ${String(MAX_ZERO_SCORE_FALLBACK_FILES)} files.`,
    );
  }

  const fingerprintResult = await fingerprintRepository(
    root,
    sortedInventory,
    hashesByPath,
  );
  warnings.push(...fingerprintResult.warnings);
  const manifestProjection = JSON.stringify({
    run_id: input.run_id,
    repository_fingerprint: fingerprintResult.fingerprint,
    selected_sources: selectedSources.map(({ ref, content_hash }) => ({
      ref,
      content_hash,
    })),
    budget,
  });
  const id = `context-${sha256(manifestProjection).slice("sha256:".length, "sha256:".length + 16)}`;
  const excludedCandidates = exclusionSummary(exclusions);
  const manifest: ContextManifest = {
    schema_version: "1.0",
    id,
    run_id: input.run_id,
    repository_fingerprint: fingerprintResult.fingerprint,
    pinned_refs: selectedSources
      .filter((source) => source.pinned)
      .map((source) => source.ref),
    selected_sources: selectedSources,
    derived_refs: [],
    excluded_candidates: excludedCandidates,
    inventory_source: inventory.source,
    warnings,
    budget: {
      ...budget,
      candidate_files: discoveredCandidateCount,
      selected_files: selectedSources.length,
      selected_bytes: selectedBytes,
      estimated_tokens: Math.ceil(selectedBytes / 4),
    },
  };

  return {
    repository_root: root,
    manifest,
    documents,
    trace_summary: summarizeContextManifest(manifest),
  };
}
