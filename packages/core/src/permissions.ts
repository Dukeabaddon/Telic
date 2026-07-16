import { existsSync, realpathSync } from "node:fs";
import { isIP } from "node:net";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { matchesGlob } from "node:path";

import type {
  IntentMode,
  PermissionProjection,
  StructuredPermissionSet,
} from "./types.js";

export const actionKinds = [
  "repository.read",
  "repository.write",
  "repository.delete",
  "shell.inspect",
  "shell.execute",
  "runtime.inspect",
  "runtime.mutate",
  "browser.inspect",
  "browser.mutate",
  "network.read",
  "external.write",
  "subagent.spawn",
] as const;

export type ActionKind = (typeof actionKinds)[number];

export interface PermissionGrant {
  kind: ActionKind;
  scopes?: string[];
}

export interface PermissionPolicy {
  name: string;
  allow: PermissionGrant[];
  deny?: PermissionGrant[];
}

export interface ActionRequest {
  kind: ActionKind;
  target?: string;
}

export interface PermissionDecision {
  allowed: boolean;
  deniedBy: string[];
  summary: string;
}

export function shellCommandIsSafe(command: string): boolean {
  return !/[;&|><`\n\r]|\$\(/u.test(command);
}

const safeShellInspectionTargets = new Set([
  "git.status",
  "git.diff",
  "git.log",
  "network.listen",
  "process.list",
  "runtime.logs",
]);

export function shellInspectionTargetIsSafe(target: string): boolean {
  return safeShellInspectionTargets.has(target);
}

export function normalizeNetworkReadDomain(value: string): string | null {
  const candidate = value.trim().toLowerCase();
  if (candidate.length === 0 || candidate.length > 253) return null;
  const unbracketed =
    candidate.startsWith("[") && candidate.endsWith("]")
      ? candidate.slice(1, -1)
      : candidate;
  if (isIP(unbracketed) !== 0) return unbracketed;
  if (candidate === "localhost") return candidate;
  if (candidate.includes("://") || /[/?#@:*]/u.test(candidate)) return null;
  const labels = candidate.split(".");
  if (
    labels.some(
      (label) =>
        label.length === 0 ||
        label.length > 63 ||
        !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/u.test(label),
    )
  ) {
    return null;
  }
  return candidate;
}

function networkTargetHostname(target: string): string | null {
  try {
    const parsed = new URL(
      target.includes("://") ? target : `http://${target}`,
    );
    if (
      (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
      parsed.username.length > 0 ||
      parsed.password.length > 0
    ) {
      return null;
    }
    return normalizeNetworkReadDomain(parsed.hostname);
  } catch {
    return null;
  }
}

function safeRelativeTarget(
  repositoryRoot: string,
  target: string,
): string | null {
  const absoluteTarget = isAbsolute(target)
    ? resolve(target)
    : resolve(repositoryRoot, target);
  const relativeTarget = relative(resolve(repositoryRoot), absoluteTarget);
  if (
    relativeTarget === "" ||
    (!relativeTarget.startsWith("..") && !isAbsolute(relativeTarget))
  ) {
    if (existsSync(repositoryRoot)) {
      const canonicalRoot = realpathSync(repositoryRoot);
      let existingAncestor = absoluteTarget;
      while (!existsSync(existingAncestor)) {
        const parent = dirname(existingAncestor);
        if (parent === existingAncestor) return null;
        existingAncestor = parent;
      }
      const canonicalTarget = realpathSync(existingAncestor);
      const canonicalRelative = relative(canonicalRoot, canonicalTarget);
      if (
        canonicalRelative === ".." ||
        canonicalRelative.startsWith(`..${sep}`) ||
        isAbsolute(canonicalRelative)
      ) {
        return null;
      }
    }
    return relativeTarget === "" ? "." : relativeTarget.replaceAll("\\", "/");
  }
  return null;
}

function grantMatches(
  grant: PermissionGrant,
  request: ActionRequest,
  repositoryRoot: string,
): boolean {
  if (grant.kind !== request.kind) return false;
  if (!grant.scopes || grant.scopes.length === 0) return true;
  if (request.target === undefined) return false;
  if (request.kind === "shell.execute" && !shellCommandIsSafe(request.target)) {
    return false;
  }

  const target = request.kind.startsWith("repository.")
    ? safeRelativeTarget(repositoryRoot, request.target)
    : request.target;
  if (target === null) return false;

  if (request.kind === "network.read") {
    const hostname = networkTargetHostname(target);
    if (hostname === null) return false;
    return grant.scopes.some((scope) => {
      if (scope === "**") return true;
      return normalizeNetworkReadDomain(scope) === hostname;
    });
  }

  return grant.scopes.some((scope) => {
    if (scope === "**") return true;
    if (request.kind === "shell.execute") return target === scope;
    return matchesGlob(target, scope);
  });
}

/** Convert the wire permission set into an action-authorization policy. */
export function policyFromPermissionSet(
  name: string,
  permissions: StructuredPermissionSet,
): PermissionPolicy {
  const allow: PermissionGrant[] = [];
  const scoped = (kind: ActionKind, scopes: readonly string[]) => {
    if (scopes.length > 0) allow.push({ kind, scopes: [...scopes] });
  };

  scoped("repository.read", permissions.repository.read);
  scoped("repository.write", permissions.repository.write);
  scoped("repository.delete", permissions.repository.delete);
  if (permissions.shell.inspect) allow.push({ kind: "shell.inspect" });
  scoped("shell.execute", permissions.shell.executeAllowlist);
  scoped("runtime.inspect", permissions.runtime.inspect);
  scoped("runtime.mutate", permissions.runtime.restart);
  if (permissions.browser.inspect) allow.push({ kind: "browser.inspect" });
  if (permissions.browser.mutateState) allow.push({ kind: "browser.mutate" });
  scoped("network.read", permissions.network.readDomains);
  if (permissions.network.externalWrite) allow.push({ kind: "external.write" });
  if (permissions.subagents.spawn) allow.push({ kind: "subagent.spawn" });

  return { name, allow };
}

export function authorizeAction(
  request: ActionRequest,
  policies: PermissionPolicy[],
  repositoryRoot: string,
): PermissionDecision {
  if (policies.length === 0) {
    return {
      allowed: false,
      deniedBy: ["no_policy"],
      summary: "Denied: no policy grants exist.",
    };
  }

  const deniedBy: string[] = [];
  for (const policy of policies) {
    const denied = (policy.deny ?? []).some((grant) =>
      grantMatches(grant, request, repositoryRoot),
    );
    const allowed = policy.allow.some((grant) =>
      grantMatches(grant, request, repositoryRoot),
    );
    if (denied || !allowed) deniedBy.push(policy.name);
  }

  return deniedBy.length === 0
    ? {
        allowed: true,
        deniedBy: [],
        summary: `Allowed by all ${policies.length} policies.`,
      }
    : {
        allowed: false,
        deniedBy,
        summary: `Denied by permission intersection: ${deniedBy.join(", ")}.`,
      };
}

const readRepository: PermissionGrant = {
  kind: "repository.read",
  scopes: ["**"],
};

export function policyForMode(mode: IntentMode): PermissionPolicy {
  const allow: PermissionGrant[] = [];

  if (mode !== "report_only") allow.push(readRepository);
  if (mode === "analyze_only" || mode === "analyze_and_fix") {
    allow.push(
      { kind: "shell.inspect" },
      { kind: "runtime.inspect" },
      { kind: "browser.inspect" },
      { kind: "network.read" },
    );
  }
  if (mode === "fix_only" || mode === "analyze_and_fix") {
    allow.push(
      { kind: "repository.write", scopes: ["**"] },
      { kind: "repository.delete", scopes: ["**"] },
      { kind: "shell.inspect" },
      { kind: "shell.execute" },
      { kind: "runtime.inspect" },
    );
  }
  if (mode !== "report_only") {
    allow.push({ kind: "subagent.spawn" });
  }

  return {
    name: `intent_mode:${mode}`,
    allow,
    deny:
      mode === "report_only" || mode === "plan_only" || mode === "analyze_only"
        ? [
            { kind: "repository.write", scopes: ["**"] },
            { kind: "repository.delete", scopes: ["**"] },
            { kind: "runtime.mutate" },
            { kind: "browser.mutate" },
            { kind: "external.write" },
          ]
        : [{ kind: "external.write" }],
  };
}

function modeAllows(mode: IntentMode, kind: ActionKind): boolean {
  const policy = policyForMode(mode);
  return policy.allow.some((grant) => grant.kind === kind);
}

function scopeCovered(scope: string, allowed: readonly string[]): boolean {
  return allowed.some((parent) => {
    if (parent === "**" || parent === scope) return true;
    if (parent.endsWith("/**")) {
      const prefix = parent.slice(0, -3);
      return scope === prefix || scope.startsWith(`${prefix}/`);
    }
    return false;
  });
}

function scopesAreSubset(
  requested: readonly string[],
  allowed: readonly string[],
): boolean {
  return requested.every((scope) => scopeCovered(scope, allowed));
}

/** Conservative, deterministic permission-set containment check. */
export function permissionSetIsSubset(
  requested: StructuredPermissionSet,
  allowed: StructuredPermissionSet,
): boolean {
  return (
    scopesAreSubset(requested.repository.read, allowed.repository.read) &&
    scopesAreSubset(requested.repository.write, allowed.repository.write) &&
    scopesAreSubset(requested.repository.delete, allowed.repository.delete) &&
    (!requested.shell.inspect || allowed.shell.inspect) &&
    scopesAreSubset(
      requested.shell.executeAllowlist,
      allowed.shell.executeAllowlist,
    ) &&
    scopesAreSubset(requested.runtime.inspect, allowed.runtime.inspect) &&
    scopesAreSubset(requested.runtime.restart, allowed.runtime.restart) &&
    (!requested.browser.inspect || allowed.browser.inspect) &&
    (!requested.browser.mutateState || allowed.browser.mutateState) &&
    scopesAreSubset(
      requested.network.readDomains,
      allowed.network.readDomains,
    ) &&
    (!requested.network.externalWrite || allowed.network.externalWrite) &&
    (!requested.subagents.spawn || allowed.subagents.spawn) &&
    requested.subagents.maximumChildren <= allowed.subagents.maximumChildren &&
    requested.subagents.maximumDepth <= allowed.subagents.maximumDepth
  );
}

export function projectPermissions(mode: IntentMode): PermissionProjection {
  return {
    repository_read: modeAllows(mode, "repository.read"),
    repository_write: modeAllows(mode, "repository.write"),
    repository_delete: modeAllows(mode, "repository.delete"),
    shell_inspect: modeAllows(mode, "shell.inspect"),
    shell_execute: modeAllows(mode, "shell.execute"),
    runtime_inspect: modeAllows(mode, "runtime.inspect"),
    runtime_mutate: modeAllows(mode, "runtime.mutate"),
    browser_inspect: modeAllows(mode, "browser.inspect"),
    browser_mutate: modeAllows(mode, "browser.mutate"),
    network_read: modeAllows(mode, "network.read"),
    external_write: modeAllows(mode, "external.write"),
    subagent_spawn: modeAllows(mode, "subagent.spawn"),
  };
}
