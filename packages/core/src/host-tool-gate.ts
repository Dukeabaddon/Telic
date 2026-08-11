import {
  evaluateBrokerAction,
  permissionsFromEnvelope,
  type BrokerActionRequest,
  type BrokerContext,
  type BrokerDecision,
  type BrokerReasonCode,
} from "./tool-broker.js";
import type { IntentMode, TracePermissionDecision } from "./types.js";

export interface RunEnvelopeContext {
  repositoryRoot: string;
  mode: IntentMode;
  envelope: unknown;
  policyRefs?: string[];
}

export interface ToolCallDescriptor {
  capability: string;
  target?: string;
  runId: string;
  actionId: string;
}

export interface HostToolGateDecision {
  allowed: boolean;
  reasonCode: BrokerReasonCode;
  permissionDecision: TracePermissionDecision;
}

/** Gate a host-native tool call against run envelope permissions. */
export function gateHostToolCall(
  context: RunEnvelopeContext,
  toolCall: ToolCallDescriptor,
): HostToolGateDecision {
  const brokerContext: BrokerContext = {
    repositoryRoot: context.repositoryRoot,
    mode: context.mode,
    permissions: permissionsFromEnvelope(context.mode, context.envelope),
    ...(context.policyRefs ? { policyRefs: context.policyRefs } : {}),
  };
  const request: BrokerActionRequest = {
    capability: toolCall.capability,
    ...(toolCall.target !== undefined ? { target: toolCall.target } : {}),
    runId: toolCall.runId,
    actionId: toolCall.actionId,
  };
  const decision: BrokerDecision = evaluateBrokerAction(brokerContext, request);
  return {
    allowed: decision.allowed,
    reasonCode: decision.reasonCode,
    permissionDecision: decision.permissionDecision,
  };
}
