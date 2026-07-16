export type InventorySource = "git" | "ripgrep" | "filesystem";

export type ExclusionReason =
  | "binary_file"
  | "duplicate_content"
  | "excluded_directory"
  | "file_count_budget"
  | "file_too_large"
  | "inventory_budget"
  | "invalid_path"
  | "invalid_utf8"
  | "low_relevance"
  | "non_regular_file"
  | "path_escape"
  | "secret_content"
  | "secret_like_file"
  | "symlink_escape"
  | "total_bytes_budget"
  | "unreadable_file";

export interface GroundingBudget {
  readonly max_files: number;
  readonly max_file_bytes: number;
  readonly max_total_bytes: number;
  readonly max_inventory_files: number;
}

export interface GroundingBudgetInput {
  readonly max_files?: number;
  readonly max_file_bytes?: number;
  readonly max_total_bytes?: number;
  readonly max_inventory_files?: number;
}

export interface GroundRepositoryInput {
  readonly run_id: string;
  readonly repository_root: string;
  readonly request: string;
  readonly active_paths?: readonly string[];
  /** Absolute directories whose contents must never be selected as context. */
  readonly excluded_roots?: readonly string[];
  readonly budget?: GroundingBudgetInput;
}

export interface RepositoryFingerprint {
  readonly head_commit: string | null;
  readonly dirty_worktree_hash: `sha256:${string}`;
}

export interface SelectedContextSource {
  readonly ref: `repo://${string}`;
  readonly path: string;
  readonly reason: string;
  readonly content_hash: `sha256:${string}`;
  readonly size_bytes: number;
  readonly score: number;
  readonly pinned: boolean;
}

export interface ExcludedCandidateSummary {
  readonly reason: ExclusionReason;
  readonly count: number;
}

export interface ContextBudgetReport extends GroundingBudget {
  readonly candidate_files: number;
  readonly selected_files: number;
  readonly selected_bytes: number;
  readonly estimated_tokens: number;
}

/**
 * Protocol-facing metadata. Exact file contents deliberately live outside this
 * object so it can be recorded in a trace without leaking repository data.
 */
export interface ContextManifest {
  readonly schema_version: "1.0";
  readonly id: string;
  readonly run_id: string;
  readonly repository_fingerprint: RepositoryFingerprint;
  readonly pinned_refs: readonly `repo://${string}`[];
  readonly selected_sources: readonly SelectedContextSource[];
  readonly derived_refs: readonly string[];
  readonly excluded_candidates: readonly ExcludedCandidateSummary[];
  readonly inventory_source: InventorySource;
  readonly warnings: readonly string[];
  readonly budget: ContextBudgetReport;
}

/** Exact source content for the artifact/blob store, never for trace logging. */
export interface ContextDocument {
  readonly ref: `repo://${string}`;
  readonly path: string;
  readonly content_hash: `sha256:${string}`;
  readonly size_bytes: number;
  readonly content: string;
}

/** A content-free projection safe for ordinary structured trace events. */
export interface ContextTraceSummary {
  readonly context_manifest_id: string;
  readonly repository_fingerprint: RepositoryFingerprint;
  readonly inventory_source: InventorySource;
  readonly candidate_files: number;
  readonly selected_refs: readonly `repo://${string}`[];
  readonly selected_files: number;
  readonly selected_bytes: number;
  readonly excluded_candidates: readonly ExcludedCandidateSummary[];
  readonly warnings: readonly string[];
}

export interface GroundRepositoryResult {
  readonly repository_root: string;
  readonly manifest: ContextManifest;
  readonly documents: readonly ContextDocument[];
  readonly trace_summary: ContextTraceSummary;
}

export class ContextInputError extends Error {
  public override readonly name = "ContextInputError";
}

export class ContextSecurityError extends Error {
  public override readonly name = "ContextSecurityError";
}
