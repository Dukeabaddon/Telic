import { execFile } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

import {
  ContextSecurityError,
  groundRepository,
  type GroundRepositoryResult,
} from "../src/index.js";

const execFileAsync = promisify(execFile);
const temporaryDirectories: string[] = [];

async function temporaryDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

async function write(
  root: string,
  path: string,
  content: string | Uint8Array,
): Promise<void> {
  const destination = join(root, path);
  await mkdir(join(destination, ".."), { recursive: true });
  await writeFile(destination, content);
}

async function initializeGit(root: string): Promise<void> {
  await execFileAsync("git", ["init", "--quiet", root]);
  await execFileAsync("git", ["-C", root, "add", "--all"]);
}

async function ground(
  root: string,
  request = "investigate the network client",
): Promise<GroundRepositoryResult> {
  return await groundRepository({
    run_id: "run-test",
    repository_root: root,
    request,
  });
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map(async (directory) => await rm(directory, { recursive: true })),
  );
});

describe("groundRepository", () => {
  it("uses Git inventory, pins instructions, ranks request paths, and returns content separately", async () => {
    const root = await temporaryDirectory("telic-context-git-");
    await write(root, "AGENTS.md", "Follow repository architecture rules.\n");
    await write(
      root,
      "src/network/client.ts",
      "export const endpoint = '/api/projects';\n",
    );
    await write(root, "src/unrelated.ts", "export const value = 1;\n");
    await initializeGit(root);

    const result = await ground(
      root,
      "please investigate src/network/client.ts failing requests",
    );

    expect(result.manifest.inventory_source).toBe("git");
    expect(result.manifest.pinned_refs).toContain("repo://AGENTS.md");
    expect(result.manifest.selected_sources[0]?.path).toBe("AGENTS.md");
    expect(
      result.manifest.selected_sources.findIndex(
        (source) => source.path === "src/network/client.ts",
      ),
    ).toBeLessThan(
      result.manifest.selected_sources.findIndex(
        (source) => source.path === "src/unrelated.ts",
      ),
    );
    expect(
      result.documents.find(
        (document) => document.path === "src/network/client.ts",
      )?.content,
    ).toContain("/api/projects");
    expect(JSON.stringify(result.trace_summary)).not.toContain("/api/projects");
  });

  it("matches request terms on path-token boundaries", async () => {
    const root = await temporaryDirectory("telic-context-token-ranking-");
    await write(root, "AGENTS.md", "Rules\n");
    await write(root, "src/api/client.ts", "export const api = true;\n");
    await write(
      root,
      "src/capitalization.ts",
      "export const capitalization = true;\n",
    );
    await initializeGit(root);

    const result = await groundRepository({
      run_id: "run-token-ranking",
      repository_root: root,
      request: "investigate the api failure",
      budget: { max_files: 2 },
    });

    expect(result.documents.map((document) => document.path)).toEqual([
      "AGENTS.md",
      "src/api/client.ts",
    ]);
  });

  it("caps unpinned zero-relevance fallback context", async () => {
    const root = await temporaryDirectory("telic-context-relevance-cap-");
    await write(root, "AGENTS.md", "Rules\n");
    await write(root, "src/api/client.ts", "export const api = true;\n");
    for (let index = 0; index < 30; index += 1) {
      await write(
        root,
        `generated/report-${String(index).padStart(2, "0")}.json`,
        JSON.stringify({ index }),
      );
    }
    await initializeGit(root);

    const result = await ground(root, "investigate the api failure");
    const fallbackSources = result.manifest.selected_sources.filter(
      (source) => source.score === 0 && !source.pinned,
    );

    expect(fallbackSources).toHaveLength(8);
    expect(result.manifest.excluded_candidates).toContainEqual({
      reason: "low_relevance",
      count: 22,
    });
    expect(result.manifest.warnings).toContain(
      "Unpinned zero-relevance context was capped at 8 files.",
    );
  });

  it("does not treat every file under packages as project metadata", async () => {
    const root = await temporaryDirectory("telic-context-package-boundary-");
    await write(root, "AGENTS.md", "Rules\n");
    await write(root, "package.json", '{"name":"fixture"}\n');
    await write(root, "src/api/client.ts", "export const api = true;\n");
    for (let index = 0; index < 20; index += 1) {
      await write(
        root,
        `packages/package-${String(index).padStart(2, "0")}/src/controller.ts`,
        `export const value = ${String(index)};\n`,
      );
    }
    await initializeGit(root);

    const result = await ground(root, "investigate the api failure");
    const packageSources = result.manifest.selected_sources.filter((source) =>
      source.path.startsWith("packages/"),
    );

    expect(packageSources).toHaveLength(8);
    expect(packageSources.every((source) => source.score === 0)).toBe(true);
    expect(result.manifest.excluded_candidates).toContainEqual({
      reason: "low_relevance",
      count: 12,
    });
  });

  it("excludes secret-like files without leaking their contents", async () => {
    const root = await temporaryDirectory("telic-context-secrets-");
    await write(root, "AGENTS.md", "Rules\n");
    await write(root, ".env.local", "SUPER_SECRET=do-not-log\n");
    await write(root, ".envrc", "ENVRC_SECRET=do-not-log-either\n");
    await write(root, "credentials.json", '{"token":"credential-marker"}\n');
    await write(root, "secrets/cloud.txt", "nested-secret-marker\n");
    await write(root, "private.pem", "private-key-marker\n");
    await write(root, "src/index.ts", "export {};\n");
    await initializeGit(root);

    const result = await ground(root);
    const serialized = JSON.stringify({
      manifest: result.manifest,
      trace: result.trace_summary,
    });

    expect(result.manifest.excluded_candidates).toContainEqual({
      reason: "secret_like_file",
      count: 5,
    });
    expect(result.documents.map((document) => document.path)).toEqual([
      "AGENTS.md",
      "src/index.ts",
    ]);
    expect(serialized).not.toContain("do-not-log");
    expect(serialized).not.toContain("credential-marker");
    expect(serialized).not.toContain("private-key-marker");
    expect(serialized).not.toContain("nested-secret-marker");
  });

  it("rejects symlink escapes and never reads the external target", async () => {
    const root = await temporaryDirectory("telic-context-symlink-");
    const outside = await temporaryDirectory("telic-context-outside-");
    await write(root, "AGENTS.md", "Rules\n");
    await write(outside, "outside.txt", "outside-content-marker\n");
    await symlink(join(outside, "outside.txt"), join(root, "escaped.txt"));
    await initializeGit(root);

    const result = await ground(root, "read escaped.txt");

    expect(result.manifest.excluded_candidates).toContainEqual({
      reason: "symlink_escape",
      count: 1,
    });
    expect(
      result.documents.some((document) => document.path === "escaped.txt"),
    ).toBe(false);
    expect(JSON.stringify(result)).not.toContain("outside-content-marker");
  });

  it("rejects explicit active paths that escape lexically or through a symlink", async () => {
    const root = await temporaryDirectory("telic-context-active-");
    const outside = await temporaryDirectory("telic-context-active-outside-");
    await write(root, "AGENTS.md", "Rules\n");
    await write(outside, "outside.ts", "export const outside = true;\n");
    await symlink(join(outside, "outside.ts"), join(root, "outside-link.ts"));

    await expect(
      groundRepository({
        run_id: "run-test",
        repository_root: root,
        request: "inspect",
        active_paths: ["../outside.ts"],
      }),
    ).rejects.toThrow(
      `Active path "../outside.ts" is outside Telic's repository root ${JSON.stringify(await realpath(root))}`,
    );
    await expect(
      groundRepository({
        run_id: "run-test",
        repository_root: root,
        request: "inspect",
        active_paths: ["outside-link.ts"],
      }),
    ).rejects.toThrow(
      "Remove it from active_paths or start a run with TELIC_REPOSITORY_ROOT set to the containing project.",
    );
  });

  it("enforces file, per-file, total-byte, binary, and duplicate budgets", async () => {
    const root = await temporaryDirectory("telic-context-budgets-");
    await write(root, "AGENTS.md", "R\n");
    await write(root, "src/a.ts", "same\n");
    await write(root, "src/b.ts", "same\n");
    await write(root, "src/binary.dat", new Uint8Array([0, 1, 2, 3]));
    await write(root, "src/large.ts", "x".repeat(40));
    await write(root, "src/medium.ts", "medium-text\n");
    await initializeGit(root);

    const result = await groundRepository({
      run_id: "run-budget",
      repository_root: root,
      request: "src a b medium large binary",
      budget: {
        max_files: 3,
        max_file_bytes: 16,
        max_total_bytes: 12,
        max_inventory_files: 20,
      },
    });
    const reasons = new Map(
      result.manifest.excluded_candidates.map(({ reason, count }) => [
        reason,
        count,
      ]),
    );

    expect(result.manifest.budget.selected_files).toBeLessThanOrEqual(3);
    expect(result.manifest.budget.selected_bytes).toBeLessThanOrEqual(12);
    expect(reasons.get("file_too_large")).toBe(1);
    expect(reasons.get("binary_file")).toBe(1);
    expect(reasons.get("duplicate_content")).toBe(1);
    expect(reasons.get("total_bytes_budget")).toBeGreaterThanOrEqual(1);
  });

  it("is deterministic for the same repository state and request", async () => {
    const root = await temporaryDirectory("telic-context-deterministic-");
    await write(root, "AGENTS.md", "Rules\n");
    await write(root, "zeta.ts", "export const zeta = true;\n");
    await write(root, "alpha.ts", "export const alpha = true;\n");
    await initializeGit(root);

    const first = await ground(root, "alpha zeta");
    const second = await ground(root, "alpha zeta");

    expect(second.manifest).toEqual(first.manifest);
    expect(second.documents).toEqual(first.documents);
    expect(
      first.manifest.selected_sources.map((source) => source.path),
    ).toEqual(["AGENTS.md", "alpha.ts", "zeta.ts"]);
  });

  it("preserves instruction and active-path candidates when the inventory is truncated", async () => {
    const root = await temporaryDirectory("telic-context-inventory-budget-");
    await write(root, "AGENTS.md", "Rules\n");
    await write(root, ".aaa.txt", "first lexical file\n");
    await write(root, ".bbb.txt", "second lexical file\n");
    await write(root, "src/active.ts", "export const active = true;\n");
    await initializeGit(root);

    const result = await groundRepository({
      run_id: "run-inventory-budget",
      repository_root: root,
      request: "inspect the active file",
      active_paths: ["src/active.ts"],
      budget: { max_inventory_files: 2 },
    });

    expect(
      result.manifest.selected_sources.map((source) => source.path),
    ).toEqual(["src/active.ts", "AGENTS.md"]);
    expect(result.manifest.excluded_candidates).toContainEqual({
      reason: "inventory_budget",
      count: 2,
    });
  });

  it("falls back to ripgrep or the filesystem outside Git", async () => {
    const root = await temporaryDirectory("telic-context-fallback-");
    await write(root, "AGENTS.md", "Rules\n");
    await write(root, "src/index.ts", "export {};\n");

    const result = await ground(root);

    expect(["ripgrep", "filesystem"]).toContain(
      result.manifest.inventory_source,
    );
    expect(result.documents.map((document) => document.path)).toEqual([
      "AGENTS.md",
      "src/index.ts",
    ]);
    expect(result.manifest.warnings.length).toBeGreaterThan(0);
  });
});
