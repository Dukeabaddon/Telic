import {
  authorizeAction,
  normalizeNetworkReadDomain,
  policyForMode,
  policyFromPermissionSet,
  type ActionKind,
} from "../permissions.js";
import type { RunRecord, TracePermissionDecision } from "../types.js";
import type { WorkNodeProjection } from "./work-plan-validator.js";

export class PermissionAuthorizationError extends Error {
  constructor(
    message: string,
    readonly permissionDecision: TracePermissionDecision,
    readonly inputRefs: string[],
  ) {
    super(message);
    this.name = "PermissionAuthorizationError";
  }
}

export function tracePermissionDecision(
  action: Record<string, unknown>,
  allowed: boolean,
  policyRefs: string[],
  rationaleSummary: string,
): TracePermissionDecision {
  const capability =
    typeof action.capability === "string" ? action.capability : "unknown";
  const rawTarget =
    typeof action.target === "string" ? action.target : "unknown";
  let scope = rawTarget;
  if (
    (capability === "network.read" || capability === "external.write") &&
    rawTarget !== "unknown"
  ) {
    try {
      const parsed = new URL(
        rawTarget.includes("://") ? rawTarget : `http://${rawTarget}`,
      );
      scope =
        normalizeNetworkReadDomain(parsed.hostname) ?? "invalid_network_target";
    } catch {
      scope = "invalid_network_target";
    }
  }
  return {
    decision: allowed ? "allow" : "deny",
    capability,
    scope,
    policyRefs,
    rationaleSummary,
  };
}

function actionKindForCapability(capability: string): ActionKind | null {
  if (capability === "runtime.restart") return "runtime.mutate";
  const known: ActionKind[] = [
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
  ];
  return known.includes(capability as ActionKind)
    ? (capability as ActionKind)
    : null;
}

function permissionSet(
  value: unknown,
  label: string,
): import("../types.js").StructuredPermissionSet {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be a structured permission set`);
  }
  return value as import("../types.js").StructuredPermissionSet;
}

export interface WorkResultPermissionEvent {
  actor: string;
  eventType: string;
  phase: RunRecord["phase"];
  inputRefs: string[];
  permissionDecision: TracePermissionDecision;
  decisionSummary: string;
}

export function buildWorkResultPermissionEvents(
  run: RunRecord,
  body: Record<string, unknown>,
  pendingNode: WorkNodeProjection | null,
  policyRefs: string[],
): WorkResultPermissionEvent[] {
  if (!pendingNode) return [];
  const nodePermissions = permissionSet(
    pendingNode.permissions,
    `Work node ${pendingNode.id} permissions`,
  );
  const policies = [
    policyForMode(run.requestedMode),
    policyFromPermissionSet(`work_node:${pendingNode.id}`, nodePermissions),
  ];
  const actions = Array.isArray(body.actions)
    ? (body.actions as Array<Record<string, unknown>>)
    : [];
  return actions
    .filter(
      (action) =>
        action.status === "completed" ||
        action.status === "failed" ||
        action.status === "denied",
    )
    .map((action) => {
      const kind =
        typeof action.capability === "string"
          ? actionKindForCapability(action.capability)
          : null;
      const allowedTool =
        typeof action.capability === "string" &&
        (pendingNode.allowedTools ?? []).includes(action.capability);
      const decision =
        kind && allowedTool
          ? authorizeAction(
              {
                kind,
                ...(typeof action.target === "string"
                  ? { target: action.target }
                  : {}),
              },
              policies,
              run.repositoryRoot,
            )
          : {
              allowed: false,
              summary: `Denied: capability is outside work node ${pendingNode.id}.`,
            };
      const permissionDecision = tracePermissionDecision(
        action,
        decision.allowed,
        policyRefs,
        decision.summary,
      );
      return {
        actor: "controller",
        eventType: "permission_checked",
        phase: run.phase,
        inputRefs: policyRefs,
        permissionDecision,
        decisionSummary: `${permissionDecision.decision === "allow" ? "Allowed" : "Denied"} ${permissionDecision.capability} for ${permissionDecision.scope}.`,
      };
    });
}
