import { mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  authorizeAction,
  permissionSetIsSubset,
  policyForMode,
  projectPermissions,
} from "./permissions.js";
import type { StructuredPermissionSet } from "./types.js";

const root = "/workspace/project";

function permissionsWithRuntimeInspect(
  runtimeInspect: string[],
): StructuredPermissionSet {
  return {
    repository: { read: [], write: [], delete: [] },
    shell: { inspect: false, executeAllowlist: [] },
    runtime: { inspect: runtimeInspect, restart: [] },
    browser: { inspect: false, mutateState: false },
    network: { readDomains: [], externalWrite: false },
    subagents: {
      spawn: false,
      maximumChildren: 0,
      maximumDepth: 0,
    },
  };
}

describe("permission intersection", () => {
  it("requires every policy to grant an action", () => {
    const decision = authorizeAction(
      { kind: "repository.write", target: "src/app.ts" },
      [
        {
          name: "host",
          allow: [{ kind: "repository.write", scopes: ["src/**"] }],
        },
        { name: "user", allow: [{ kind: "repository.read", scopes: ["**"] }] },
      ],
      root,
    );
    expect(decision.allowed).toBe(false);
    expect(decision.deniedBy).toEqual(["user"]);
  });

  it("denies traversal even when a broad repository glob is granted", () => {
    const decision = authorizeAction(
      { kind: "repository.read", target: "../secrets.txt" },
      [{ name: "host", allow: [{ kind: "repository.read", scopes: ["**"] }] }],
      root,
    );
    expect(decision.allowed).toBe(false);
  });

  it("denies an in-repository symlink that resolves outside the root", () => {
    const repository = mkdtempSync(join(tmpdir(), "telic-permission-root-"));
    const outside = mkdtempSync(join(tmpdir(), "telic-permission-outside-"));
    writeFileSync(join(outside, "secret.txt"), "secret");
    symlinkSync(join(outside, "secret.txt"), join(repository, "linked.txt"));

    const decision = authorizeAction(
      { kind: "repository.read", target: "linked.txt" },
      [{ name: "host", allow: [{ kind: "repository.read", scopes: ["**"] }] }],
      repository,
    );
    expect(decision.allowed).toBe(false);
  });

  it("lets an explicit deny override allow", () => {
    const decision = authorizeAction(
      { kind: "repository.write", target: "infra/prod.yml" },
      [
        {
          name: "repo",
          allow: [{ kind: "repository.write", scopes: ["**"] }],
          deny: [{ kind: "repository.write", scopes: ["infra/**"] }],
        },
      ],
      root,
    );
    expect(decision).toMatchObject({ allowed: false, deniedBy: ["repo"] });
  });

  it.each(["report_only", "plan_only", "analyze_only"] as const)(
    "makes %s non-mutating",
    (mode) => {
      const projection = projectPermissions(mode);
      expect(projection.repository_write).toBe(false);
      expect(projection.runtime_mutate).toBe(false);
      expect(projection.browser_mutate).toBe(false);
      expect(projection.external_write).toBe(false);
      expect(policyForMode(mode).deny).toContainEqual({
        kind: "repository.write",
        scopes: ["**"],
      });
    },
  );

  it("never grants external writes from an intent mode", () => {
    expect(projectPermissions("analyze_and_fix").external_write).toBe(false);
  });

  it("does not treat a local runtime scope as authorization for production", () => {
    expect(
      permissionSetIsSubset(
        permissionsWithRuntimeInspect(["production"]),
        permissionsWithRuntimeInspect(["local"]),
      ),
    ).toBe(false);
  });

  it("does not authorize opaque shell execution in analyze-only mode", () => {
    expect(projectPermissions("analyze_only").shell_execute).toBe(false);
    expect(
      policyForMode("analyze_only").allow.some(
        (grant) => grant.kind === "shell.execute",
      ),
    ).toBe(false);
  });

  it("requires an exact non-compound shell command", () => {
    const policies = [
      {
        name: "host",
        allow: [{ kind: "shell.execute" as const, scopes: ["npm test"] }],
      },
      {
        name: "node",
        allow: [{ kind: "shell.execute" as const, scopes: ["npm test"] }],
      },
    ];
    expect(
      authorizeAction(
        { kind: "shell.execute", target: "npm test" },
        policies,
        root,
      ).allowed,
    ).toBe(true);
    for (const target of [
      "npm test && rm -rf /",
      "npm test; curl evil.invalid",
      "npm test | tee output",
      "npm test > output",
      "npm $(echo test)",
      "npm `echo test`",
      "npm test\nrm -rf /",
      'npm test "&&"',
    ]) {
      expect(
        authorizeAction({ kind: "shell.execute", target }, policies, root)
          .allowed,
      ).toBe(false);
    }
  });

  it("does not treat shell allowlist globs as executable patterns", () => {
    const decision = authorizeAction(
      { kind: "shell.execute", target: "npm test" },
      [
        {
          name: "node",
          allow: [{ kind: "shell.execute", scopes: ["npm *"] }],
        },
      ],
      root,
    );
    expect(decision.allowed).toBe(false);
  });

  it("authorizes network reads by exact hostname", () => {
    const policies = [
      {
        name: "authorization",
        allow: [{ kind: "network.read" as const, scopes: ["api.example.com"] }],
      },
      {
        name: "work-node",
        allow: [{ kind: "network.read" as const, scopes: ["api.example.com"] }],
      },
    ];

    expect(
      authorizeAction(
        { kind: "network.read", target: "https://api.example.com/v1/items" },
        policies,
        root,
      ).allowed,
    ).toBe(true);
    for (const target of [
      "https://sub.api.example.com/v1/items",
      "https://api.example.com.evil.invalid/v1/items",
      "https://user:password@api.example.com/v1/items",
      "not a valid host",
    ]) {
      expect(
        authorizeAction({ kind: "network.read", target }, policies, root)
          .allowed,
      ).toBe(false);
    }
  });

  it("treats local as an exact hostname rather than a loopback alias", () => {
    const policies = [
      {
        name: "authorization",
        allow: [{ kind: "network.read" as const, scopes: ["local"] }],
      },
    ];

    expect(
      authorizeAction(
        { kind: "network.read", target: "http://local/status" },
        policies,
        root,
      ).allowed,
    ).toBe(true);
    for (const target of [
      "http://localhost/status",
      "http://127.0.0.1/status",
      "http://[::1]/status",
    ]) {
      expect(
        authorizeAction({ kind: "network.read", target }, policies, root)
          .allowed,
      ).toBe(false);
    }
  });
});
