import {
  authorizeAction,
  emptyPermissionSet,
  intersectStructuredPermissions,
  normalizeNetworkReadDomain,
  policyForMode,
  policyFromPermissionSet,
  projectPermissions,
  type ActionKind,
  type ActionRequest,
  type PermissionPolicy,
} from "./permissions.js";
import type {
  IntentMode,
  StructuredPermissionSet,
  TracePermissionDecision,
} from "./types.js";

export type BrokerReasonCode =
  | "allowed"
  | "capability_not_granted"
  | "invalid_action_kind"
  | "policy_denied"
  | "no_policy";

export interface BrokerActionRequest {
  capability: string;
  target?: string;
  kind?: ActionKind;
  runId: string;
  actionId: string;
}

export interface BrokerDecision {
  allowed: boolean;
  reasonCode: BrokerReasonCode;
  summary: string;
  permissionDecision: TracePermissionDecision;
}

export interface BrokerContext {
  repositoryRoot: string;
  mode: IntentMode;
  permissions: StructuredPermissionSet;
  policyRefs?: string[];
}

/** Derive effective permissions from a RunEnvelope authorization block. */
export function permissionsFromEnvelope(
  mode: IntentMode,
  envelope: unknown,
): StructuredPermissionSet {
  const ceiling = projectPermissions(mode);
  if (
    typeof envelope !== "object" ||
    envelope === null ||
    !("authorization" in envelope)
  ) {
    return emptyPermissionSet();
  }
  const authorization = (envelope as { authorization: unknown }).authorization;
  if (
    typeof authorization !== "object" ||
    authorization === null ||
    !("granted" in authorization) ||
    !("denied" in authorization)
  ) {
    return emptyPermissionSet();
  }
  return intersectStructuredPermissions(
    ceiling,
    authorization.granted as StructuredPermissionSet,
    authorization.denied as StructuredPermissionSet,
  );
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

function tracePermissionDecision(
  capability: string,
  target: string | undefined,
  allowed: boolean,
  policyRefs: string[],
  rationaleSummary: string,
): TracePermissionDecision {
  const rawTarget = target ?? "unknown";
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

function brokerPolicies(
  mode: IntentMode,
  permissions: StructuredPermissionSet,
): PermissionPolicy[] {
  return [
    policyForMode(mode),
    policyFromPermissionSet("run_envelope", permissions),
  ];
}

export function evaluateBrokerAction(
  context: BrokerContext,
  request: BrokerActionRequest,
): BrokerDecision {
  const policyRefs = context.policyRefs ?? [];
  const kind = request.kind ?? actionKindForCapability(request.capability);
  if (!kind) {
    const permissionDecision = tracePermissionDecision(
      request.capability,
      request.target,
      false,
      policyRefs,
      "Denied: capability is not broker-backed.",
    );
    return {
      allowed: false,
      reasonCode: "capability_not_granted",
      summary: permissionDecision.rationaleSummary,
      permissionDecision,
    };
  }

  const actionRequest: ActionRequest = {
    kind,
    ...(request.target !== undefined ? { target: request.target } : {}),
  };
  const decision = authorizeAction(
    actionRequest,
    brokerPolicies(context.mode, context.permissions),
    context.repositoryRoot,
  );

  let reasonCode: BrokerReasonCode;
  if (decision.allowed) {
    reasonCode = "allowed";
  } else if (decision.deniedBy.includes("no_policy")) {
    reasonCode = "no_policy";
  } else {
    reasonCode = "policy_denied";
  }

  const permissionDecision = tracePermissionDecision(
    request.capability,
    request.target,
    decision.allowed,
    policyRefs,
    decision.summary,
  );

  return {
    allowed: decision.allowed,
    reasonCode,
    summary: decision.summary,
    permissionDecision,
  };
}
