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
  ContextInputError,
  containsLikelySecret,
  groundRepository,
  isInstructionPath,
  isPathContained,
  isProbablyBinary,
  isSecretLikePath,
  makeRepoRef,
  normalizeRepositoryPath,
} from "../src/index.js";
import { readBoundedTextFile } from "../src/ground.js";

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

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map(async (directory) => await rm(directory, { recursive: true })),
  );
});

describe("repository path helpers", () => {
  it("does not follow a symlink when opening a previously selected file", async () => {
    const root = await temporaryDirectory("telic-context-no-follow-");
    const outside = await temporaryDirectory("telic-context-outside-");
    const target = join(root, "src/candidate.ts");
    const secret = join(outside, "secret.txt");
    await write(outside, "secret.txt", "outside-only-content\n");
    await mkdir(join(root, "src"), { recursive: true });
    await symlink(secret, target);

    await expect(readBoundedTextFile(target, 1024)).rejects.toThrow();
  });

  it("normalizes only safe repository-relative paths", () => {
    expect(normalizeRepositoryPath("./src//index.ts")).toBe("src/index.ts");
    expect(normalizeRepositoryPath("../outside.ts")).toBeNull();
    expect(normalizeRepositoryPath("/absolute.ts")).toBeNull();
    expect(normalizeRepositoryPath("bad\\name.ts")).toBeNull();
    expect(normalizeRepositoryPath("a".repeat(1_025))).toBeNull();
  });

  it("recognizes instruction and secret-like paths conservatively", () => {
    expect(isInstructionPath("AGENTS.md")).toBe(true);
    expect(isInstructionPath(".roo/rules/testing.md")).toBe(true);
    expect(isInstructionPath("src/index.ts")).toBe(false);
    expect(isSecretLikePath(".envrc")).toBe(true);
    expect(isSecretLikePath("config/credentials/aws.txt")).toBe(true);
    expect(isSecretLikePath("keys/id_ed25519.pub")).toBe(true);
    expect(isSecretLikePath("src/environment.ts")).toBe(false);
  });

  it("detects likely credential content without matching ordinary prose", () => {
    expect(containsLikelySecret("const apiKey = 'sk_live_1234567890';")).toBe(
      true,
    );
    expect(containsLikelySecret("aws=AKIAIOSFODNN7EXAMPLE")).toBe(true);
    expect(
      containsLikelySecret(
        "-----BEGIN PRIVATE KEY-----\nnot-a-real-key\n-----END PRIVATE KEY-----",
      ),
    ).toBe(true);
    expect(
      containsLikelySecret("Tokens are bounded and secrets must be redacted."),
    ).toBe(false);
    expect(containsLikelySecret("token = '<redacted>'")).toBe(false);
  });

  it("builds encoded repository refs and detects binary prefixes", () => {
    expect(makeRepoRef("src/file name.ts")).toBe("repo://src/file%20name.ts");
    expect(isProbablyBinary(new Uint8Array())).toBe(false);
    expect(isProbablyBinary(new Uint8Array([65, 66, 67]))).toBe(false);
    expect(isProbablyBinary(new Uint8Array([65, 0, 67]))).toBe(true);
    expect(isProbablyBinary(new Uint8Array([1, 2, 3, 65]))).toBe(true);
  });

  it("does not confuse sibling path prefixes with containment", () => {
    expect(isPathContained("/tmp/repo", "/tmp/repo/src/index.ts")).toBe(true);
    expect(isPathContained("/tmp/repo", "/tmp/repository/secret.txt")).toBe(
      false,
    );
  });
});

describe("grounding input and fallback boundaries", () => {
  it("excludes likely secrets found in ordinary source files", async () => {
    const root = await temporaryDirectory("telic-context-secret-content-");
    await write(root, "AGENTS.md", "Rules\n");
    await write(
      root,
      "src/config.ts",
      "export const token = 'live_token_123456789';\n",
    );

    const result = await groundRepository({
      run_id: "run-secret-content",
      repository_root: root,
      request: "inspect config",
    });

    expect(result.documents.map((document) => document.path)).not.toContain(
      "src/config.ts",
    );
    expect(result.manifest.excluded_candidates).toContainEqual({
      reason: "secret_content",
      count: 1,
    });
  });

  it("dynamically excludes caller-owned state roots before reading them", async () => {
    const root = await temporaryDirectory("telic-context-state-root-");
    const stateRoot = join(root, "custom-agent-state");
    await write(root, "AGENTS.md", "Rules\n");
    await write(root, "src/index.ts", "export const value = 1;\n");
    await write(
      root,
      "custom-agent-state/blobs/previous.json",
      '{"content":"prior private run state"}\n',
    );

    const result = await groundRepository({
      run_id: "run-state-exclusion",
      repository_root: root,
      request: "inspect previous state and index",
      active_paths: ["custom-agent-state/blobs/previous.json"],
      excluded_roots: [stateRoot],
    });

    expect(result.documents.map((document) => document.path)).not.toContain(
      "custom-agent-state/blobs/previous.json",
    );
    expect(JSON.stringify(result)).not.toContain("prior private run state");
    expect(result.manifest.excluded_candidates).toContainEqual({
      reason: "excluded_directory",
      count: 1,
    });
  });

  it("rejects relative excluded roots", async () => {
    const root = await temporaryDirectory("telic-context-relative-exclusion-");
    await write(root, "src/index.ts", "export {};\n");

    await expect(
      groundRepository({
        run_id: "run-relative-exclusion",
        repository_root: root,
        request: "inspect index",
        excluded_roots: ["relative-state"],
      }),
    ).rejects.toThrow(/absolute directory paths/);
  });

  it("filters excluded roots before the filesystem inventory budget", async () => {
    const root = await temporaryDirectory("telic-context-early-exclusion-");
    const stateRoot = join(root, "aaa-state");
    await write(root, "aaa-state/one.ts", "excluded one\n");
    await write(root, "aaa-state/two.ts", "excluded two\n");
    await write(root, "aaa-state/three.ts", "excluded three\n");
    await write(root, "src/index.ts", "export const selected = true;\n");
    const originalPath = process.env.PATH;
    process.env.PATH = "";
    try {
      const result = await groundRepository({
        run_id: "run-early-exclusion",
        repository_root: root,
        request: "inspect index",
        excluded_roots: [stateRoot],
        budget: { max_inventory_files: 2 },
      });

      expect(result.manifest.inventory_source).toBe("filesystem");
      expect(result.documents.map((document) => document.path)).toContain(
        "src/index.ts",
      );
      expect(
        result.documents.every(
          (document) => !document.path.startsWith("aaa-state/"),
        ),
      ).toBe(true);
    } finally {
      if (originalPath === undefined) {
        delete process.env.PATH;
      } else {
        process.env.PATH = originalPath;
      }
    }
  });

  it("validates identifiers, byte limits, active path count, and budget ceilings", async () => {
    const root = await temporaryDirectory("telic-context-input-");
    await write(root, "AGENTS.md", "Rules\n");
    const base = { repository_root: root, request: "inspect" } as const;

    await expect(
      groundRepository({ ...base, run_id: "bad run" }),
    ).rejects.toBeInstanceOf(ContextInputError);
    await expect(
      groundRepository({
        ...base,
        run_id: "run-input",
        request: "😀".repeat(9_000),
      }),
    ).rejects.toBeInstanceOf(ContextInputError);
    await expect(
      groundRepository({
        ...base,
        run_id: "run-input",
        active_paths: Array.from({ length: 257 }, () => "src/a.ts"),
      }),
    ).rejects.toBeInstanceOf(ContextInputError);
    await expect(
      groundRepository({
        ...base,
        run_id: "run-input",
        budget: { max_files: 257 },
      }),
    ).rejects.toBeInstanceOf(ContextInputError);
    await expect(
      groundRepository({
        ...base,
        run_id: "run-input",
        excluded_roots: Array.from({ length: 17 }, () => root),
      }),
    ).rejects.toBeInstanceOf(ContextInputError);
  });

  it("uses the bounded filesystem fallback when Git and ripgrep are unavailable", async () => {
    const root = await temporaryDirectory("telic-context-filesystem-");
    await write(root, "AGENTS.md", "Rules\n");
    await write(root, "src/index.ts", "export {};\n");
    await write(root, "node_modules/ignored/index.js", "ignored\n");
    const originalPath = process.env.PATH;
    process.env.PATH = "";
    try {
      const result = await groundRepository({
        run_id: "run-filesystem",
        repository_root: root,
        request: "inspect index",
      });
      expect(result.manifest.inventory_source).toBe("filesystem");
      expect(result.documents.map((document) => document.path)).toEqual([
        "AGENTS.md",
        "src/index.ts",
      ]);
    } finally {
      if (originalPath === undefined) {
        delete process.env.PATH;
      } else {
        process.env.PATH = originalPath;
      }
    }
  });

  it("records invalid, excluded, non-regular, invalid-UTF8, and oversized candidates", async () => {
    const root = await temporaryDirectory("telic-context-exclusions-");
    await write(root, "AGENTS.md", "Rules\n");
    await write(root, "bad\\name.ts", "invalid path\n");
    await write(root, "build/generated.ts", "excluded build\n");
    await write(root, "src/invalid.txt", new Uint8Array([0xc3, 0x28]));
    await write(root, "src/large.ts", "x".repeat(100));
    await execFileAsync("git", ["init", "--quiet", root]);
    await execFileAsync("git", ["-C", root, "add", "--all", "--force"]);

    const result = await groundRepository({
      run_id: "run-exclusions",
      repository_root: root,
      request: "inspect all sources",
      active_paths: ["src"],
      budget: { max_file_bytes: 32 },
    });
    const reasons = new Map(
      result.manifest.excluded_candidates.map(({ reason, count }) => [
        reason,
        count,
      ]),
    );

    if (process.platform === "win32") {
      // Windows treats the test backslash as a directory separator, so it
      // cannot represent a repository filename containing a backslash.
      expect(reasons.get("invalid_path") ?? 0).toBe(0);
    } else {
      expect(reasons.get("invalid_path")).toBe(1);
    }
    expect(reasons.get("excluded_directory")).toBe(1);
    expect(reasons.get("non_regular_file")).toBe(1);
    expect(reasons.get("invalid_utf8")).toBe(1);
    expect(reasons.get("file_too_large")).toBe(1);
  });

  it("resolves a nested working directory to the containing Git root", async () => {
    const root = await temporaryDirectory("telic-context-nested-");
    await write(root, "AGENTS.md", "Rules\n");
    await write(root, "apps/web/index.ts", "export {};\n");
    await execFileAsync("git", ["init", "--quiet", root]);
    await execFileAsync("git", ["-C", root, "add", "--all"]);

    const result = await groundRepository({
      run_id: "run-nested",
      repository_root: join(root, "apps/web"),
      request: "inspect web",
    });

    expect(result.repository_root).toBe(await realpath(root));
    expect(result.manifest.pinned_refs).toContain("repo://AGENTS.md");
  });
});
