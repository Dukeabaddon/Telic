import { existsSync } from "node:fs";
import { realpathSync } from "node:fs";
import { resolve } from "node:path";

import {
  evaluateBrokerAction,
  permissionsFromEnvelope,
  readActiveSession,
  SqliteLedger,
} from "@telic/core";
import { defaultStateDirectory } from "@telic/mcp";

export interface HookPermissionResponse {
  permission: "allow" | "deny" | "ask";
  user_message?: string;
  agent_message?: string;
}

export interface BrokerGateRequest {
  repositoryRoot: string;
  hookInput: Record<string, unknown>;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

export function mapHookInputToToolCall(
  hookInput: Record<string, unknown>,
): { capability: string; target?: string } | null {
  if (typeof hookInput.command === "string" && hookInput.command.length > 0) {
    return { capability: "shell.execute", target: hookInput.command };
  }
  const toolName = String(hookInput.tool_name ?? hookInput.toolName ?? "");
  const toolInput = asRecord(hookInput.tool_input ?? hookInput.toolInput) ?? {};
  if (
    toolName === "Write" ||
    toolName === "StrReplace" ||
    toolName === "ApplyPatch" ||
    toolName === "EditNotebook"
  ) {
    const target = String(
      toolInput.path ?? toolInput.file_path ?? toolInput.target_notebook ?? "",
    );
    return target ? { capability: "repository.write", target } : null;
  }
  if (toolName === "Delete") {
    const target = String(toolInput.path ?? "");
    return target ? { capability: "repository.delete", target } : null;
  }
  if (toolName === "Shell") {
    const target = String(toolInput.command ?? "");
    return target ? { capability: "shell.execute", target } : null;
  }
  return null;
}

export function evaluateBrokerGate(
  request: BrokerGateRequest,
): HookPermissionResponse {
  const repositoryRoot = realpathSync(resolve(request.repositoryRoot));
  const stateDirectory = process.env.TELIC_STATE_DIR
    ? resolve(process.env.TELIC_STATE_DIR)
    : defaultStateDirectory(repositoryRoot);
  const session = readActiveSession(stateDirectory);
  if (!session || session.repositoryRoot !== repositoryRoot) {
    return { permission: "allow" };
  }
  if (!existsSync(resolve(stateDirectory, "ledger.sqlite3"))) {
    return { permission: "allow" };
  }
  const mapped = mapHookInputToToolCall(request.hookInput);
  if (!mapped) {
    return { permission: "allow" };
  }

  const ledger = new SqliteLedger(stateDirectory);
  try {
    const run = ledger.getRun(session.runId);
    if (!run || run.status !== "running" || run.version !== session.runVersion) {
      return { permission: "allow" };
    }
    const envelopeRecord = ledger.findLatestArtifact(session.runId, "RunEnvelope");
    const envelopeBody = envelopeRecord
      ? ledger.getArtifact(session.runId, envelopeRecord.id)?.body
      : null;
    const decision = evaluateBrokerAction(
      {
        repositoryRoot,
        mode: run.requestedMode,
        permissions: permissionsFromEnvelope(run.requestedMode, envelopeBody),
        ...(envelopeRecord
          ? {
              policyRefs: [
                `artifact://${session.runId}/${envelopeRecord.id}`,
              ],
            }
          : {}),
      },
      {
        capability: mapped.capability,
        ...(mapped.target !== undefined ? { target: mapped.target } : {}),
        runId: session.runId,
        actionId: session.actionId,
      },
    );
    ledger.appendTraceEvent(session.runId, {
      actor: "host",
      eventType: "broker_decision",
      phase: run.phase,
      inputRefs: envelopeRecord
        ? [`artifact://${session.runId}/${envelopeRecord.id}`]
        : [],
      permissionDecision: decision.permissionDecision,
      decisionSummary: decision.allowed
        ? `Hook broker allowed ${mapped.capability}.`
        : `Hook broker denied ${mapped.capability}: ${decision.reasonCode}.`,
    });
    if (decision.allowed) {
      return { permission: "allow" };
    }
    return {
      permission: "deny",
      user_message: `Telic denied ${mapped.capability} for this run (${decision.reasonCode}).`,
      agent_message: `Telic broker denied ${mapped.capability} (${decision.reasonCode}). Do not bypass; adjust the plan or escalate permissions.`,
    };
  } finally {
    ledger.close();
  }
}
