import { permissionSetIsSubset } from "../permissions.js";
import type {
  IntentMode,
  RunRecord,
  StructuredPermissionSet,
} from "../types.js";

export const MAX_TOOL_CALLS_PER_RUN = 4_000;

export interface WorkNodeProjection {
  id: string;
  dependsOn: string[];
  inputRefs?: string[];
  contextRefs?: string[];
  allowedTools?: string[];
  requiredCapabilities?: string[];
  acceptanceCriteria?: string[];
  permissions?: StructuredPermissionSet;
  budgets?: {
    maximumToolCalls?: number;
    maximumChildren?: number;
  };
}

export interface WorkPlanProjection {
  id: string;
  nodes: WorkNodeProjection[];
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function permissionSet(value: unknown, label: string): StructuredPermissionSet {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be a structured permission set`);
  }
  return value as StructuredPermissionSet;
}

function permissionAllowsCapability(
  permissions: StructuredPermissionSet,
  capability: string,
): boolean {
  switch (capability) {
    case "repository.read":
      return permissions.repository.read.length > 0;
    case "repository.write":
      return permissions.repository.write.length > 0;
    case "repository.delete":
      return permissions.repository.delete.length > 0;
    case "shell.inspect":
      return permissions.shell.inspect;
    case "shell.execute":
      return permissions.shell.executeAllowlist.length > 0;
    case "runtime.inspect":
      return permissions.runtime.inspect.length > 0;
    case "runtime.restart":
      return permissions.runtime.restart.length > 0;
    case "browser.inspect":
      return permissions.browser.inspect;
    case "browser.mutate":
      return permissions.browser.mutateState;
    case "network.read":
      return permissions.network.readDomains.length > 0;
    case "external.write":
      return permissions.network.externalWrite;
    case "subagent.spawn":
      return (
        permissions.subagents.spawn && permissions.subagents.maximumChildren > 0
      );
    default:
      return false;
  }
}

function equalStringSets(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return (
    left.length === right.length &&
    new Set(left).size === left.length &&
    left.every((item) => right.includes(item))
  );
}

const potentiallyMutatingPlanCapabilities = new Set([
  "repository.write",
  "repository.delete",
  "runtime.restart",
  "runtime.mutate",
  "browser.mutate",
  "external.write",
  "shell.execute",
  "subagent.spawn",
]);

export interface ScopedWorkOrderOptions {
  label: string;
  criterionField: "targetCriterionIds" | "failedCriterionIds";
  allowedCriteria: readonly string[];
  contractPermissions: StructuredPermissionSet;
  authorizedPermissions: StructuredPermissionSet;
  eligibleSourceRefs: ReadonlySet<string>;
  requireAllCriteria?: boolean;
  requireExecutableCapability?: boolean;
}

export function assertScopedWorkOrder(
  orderValue: unknown,
  options: ScopedWorkOrderOptions,
): void {
  if (
    typeof orderValue !== "object" ||
    orderValue === null ||
    Array.isArray(orderValue)
  ) {
    throw new Error(`${options.label} must be a typed scoped work order`);
  }
  const order = orderValue as Record<string, unknown>;
  const criterionIds = stringArray(order[options.criterionField]);
  if (
    criterionIds.length === 0 ||
    new Set(criterionIds).size !== criterionIds.length ||
    criterionIds.some(
      (criterion) => !options.allowedCriteria.includes(criterion),
    )
  ) {
    throw new Error(`${options.label} contains invalid contract criteria`);
  }
  if (
    options.requireAllCriteria === true &&
    !equalStringSets(criterionIds, options.allowedCriteria)
  ) {
    throw new Error(
      `${options.label} must cover every authorized criterion exactly once`,
    );
  }
  const permissions = permissionSet(
    order.permissions,
    `${options.label} permissions`,
  );
  if (
    !permissionSetIsSubset(permissions, options.contractPermissions) ||
    !permissionSetIsSubset(permissions, options.authorizedPermissions)
  ) {
    throw new Error(`${options.label} permissions exceed authorization`);
  }
  const capabilities = stringArray(order.allowedCapabilities);
  if (
    options.requireExecutableCapability === true &&
    capabilities.length === 0
  ) {
    throw new Error(
      `${options.label} requires at least one executable capability`,
    );
  }
  if (
    capabilities.some(
      (capability) => !permissionAllowsCapability(permissions, capability),
    )
  ) {
    throw new Error(`${options.label} capabilities are not permission-backed`);
  }
  if (
    !stringArray(order.sourceRefs).some((reference) =>
      options.eligibleSourceRefs.has(reference),
    )
  ) {
    throw new Error(`${options.label} lacks current supporting evidence`);
  }
}

export interface WorkPlanValidationContext {
  run: RunRecord;
  submissionId: string;
  body: Record<string, unknown>;
  envelope: Record<string, unknown>;
  latestRef: (runId: string, type: string) => string;
  latestContractBody: Record<string, unknown>;
  analysisFixUnlocked: (runId: string) => boolean;
  listArtifacts: (runId: string) => Array<{ id: string; type: string }>;
  getArtifactBody: (runId: string, artifactId: string) => unknown;
  explicitPermissionProjection: (
    mode: IntentMode,
    envelope: unknown,
  ) => StructuredPermissionSet;
}

export function assertWorkPlanSubmission(ctx: WorkPlanValidationContext): void {
  const { run, submissionId, body, envelope } = ctx;
  const contractRef = ctx.latestRef(run.runId, "TaskContract");
  if (body.taskContractRef !== contractRef) {
    throw new Error("WorkPlan must target the current TaskContract");
  }
  if (body.planValidation !== "valid") {
    throw new Error("Only a validated WorkPlan may enter execution or review");
  }
  if (body.executionMode !== "serial") {
    throw new Error(
      "The current controller supports deterministic serial WorkPlans only",
    );
  }
  const contract = ctx.latestContractBody;
  const contractPermissions = permissionSet(
    contract.permissions,
    "TaskContract permissions",
  );
  const criterionRecords = Array.isArray(contract.acceptanceCriteria)
    ? contract.acceptanceCriteria.filter(
        (criterion): criterion is Record<string, unknown> =>
          typeof criterion === "object" && criterion !== null,
      )
    : [];
  const criteria = new Set(
    criterionRecords
      .map((criterion) => criterion.id)
      .filter((id): id is string => typeof id === "string"),
  );
  const criterionStages = new Map(
    criterionRecords
      .filter(
        (criterion) =>
          typeof criterion.id === "string" &&
          typeof criterion.stage === "string",
      )
      .map((criterion) => [criterion.id as string, criterion.stage as string]),
  );
  const nodes = Array.isArray(body.nodes)
    ? (body.nodes as unknown as WorkNodeProjection[])
    : [];
  const globalBudgets =
    typeof body.globalBudgets === "object" && body.globalBudgets !== null
      ? (body.globalBudgets as Record<string, unknown>)
      : {};
  const requestedToolCalls = nodes.reduce((sum, node) => {
    const budgets = (
      node as unknown as { budgets?: { maximumToolCalls?: unknown } }
    ).budgets;
    return (
      sum +
      (typeof budgets?.maximumToolCalls === "number"
        ? budgets.maximumToolCalls
        : 0)
    );
  }, 0);
  if (
    typeof globalBudgets.maximumToolCalls !== "number" ||
    requestedToolCalls > globalBudgets.maximumToolCalls
  ) {
    throw new Error("WorkPlan node tool budgets exceed the global budget");
  }
  const priorPlanToolCalls = ctx
    .listArtifacts(run.runId)
    .filter(
      (artifact) =>
        artifact.type === "WorkPlan" && artifact.id !== submissionId,
    )
    .reduce((sum, artifact) => {
      const prior = ctx.getArtifactBody(run.runId, artifact.id);
      const priorNodes =
        typeof prior === "object" &&
        prior !== null &&
        "nodes" in prior &&
        Array.isArray(prior.nodes)
          ? (prior.nodes as Array<Record<string, unknown>>)
          : [];
      return (
        sum +
        priorNodes.reduce((nodeSum, node) => {
          const budgets = node.budgets;
          return (
            nodeSum +
            (typeof budgets === "object" &&
            budgets !== null &&
            "maximumToolCalls" in budgets &&
            typeof budgets.maximumToolCalls === "number"
              ? budgets.maximumToolCalls
              : 0)
          );
        }, 0)
      );
    }, 0);
  if (priorPlanToolCalls + requestedToolCalls > MAX_TOOL_CALLS_PER_RUN) {
    throw new Error(
      `WorkPlan exceeds the cumulative run tool-call budget of ${String(MAX_TOOL_CALLS_PER_RUN)}`,
    );
  }
  const envelopeBudgets =
    typeof envelope.budgets === "object" && envelope.budgets !== null
      ? (envelope.budgets as Record<string, unknown>)
      : {};
  if (
    typeof globalBudgets.maximumParallelWorkers !== "number" ||
    typeof globalBudgets.maximumSubagentDepth !== "number" ||
    globalBudgets.maximumParallelWorkers >
      (typeof envelopeBudgets.maximumParallelWorkers === "number"
        ? envelopeBudgets.maximumParallelWorkers
        : 1) ||
    globalBudgets.maximumSubagentDepth >
      (typeof envelopeBudgets.maximumSubagentDepth === "number"
        ? envelopeBudgets.maximumSubagentDepth
        : 0)
  ) {
    throw new Error("WorkPlan concurrency exceeds immutable host budgets");
  }
  const latestControlRecord = [...ctx.listArtifacts(run.runId)]
    .reverse()
    .find(
      (artifact) =>
        artifact.type === "QualityReview" || artifact.type === "ReleaseAudit",
    );
  const latestControl = latestControlRecord
    ? ctx.getArtifactBody(run.runId, latestControlRecord.id)
    : null;
  const remediationControl =
    typeof latestControl === "object" &&
    latestControl !== null &&
    (latestControl as { decision?: unknown }).decision === "remediate"
      ? (latestControl as Record<string, unknown>)
      : null;
  const correctionControl =
    latestControlRecord?.type === "QualityReview" &&
    typeof latestControl === "object" &&
    latestControl !== null &&
    (latestControl as { decision?: unknown }).decision === "proceed_to_fix"
      ? (latestControl as Record<string, unknown>)
      : null;
  const planCeiling =
    run.requestedMode === "analyze_and_fix" &&
    !ctx.analysisFixUnlocked(run.runId) &&
    correctionControl === null
      ? ctx.explicitPermissionProjection("analyze_only", envelope)
      : contractPermissions;
  let scopedCriteria: string[] | null = null;
  if ((remediationControl || correctionControl) && latestControlRecord) {
    const workOrder = correctionControl
      ? typeof correctionControl.diagnosisGate === "object" &&
        correctionControl.diagnosisGate !== null
        ? (correctionControl.diagnosisGate as Record<string, unknown>)
            .correctionWorkOrder
        : null
      : latestControlRecord.type === "QualityReview"
        ? remediationControl!.remediationWorkOrder
        : remediationControl!.remediationDefect;
    if (typeof workOrder !== "object" || workOrder === null) {
      throw new Error("Scoped replanning is missing its typed work order");
    }
    const projectedOrder = workOrder as Record<string, unknown>;
    scopedCriteria = correctionControl
      ? stringArray(projectedOrder.targetCriterionIds)
      : stringArray(projectedOrder.failedCriterionIds);
    const controllingRef = `artifact://${run.runId}/${latestControlRecord.id}`;
    if (
      nodes.some(
        (node) => !stringArray(node.inputRefs).includes(controllingRef),
      )
    ) {
      throw new Error(
        "Every scoped node must reference its controlling review or audit",
      );
    }
    if (
      typeof projectedOrder.maximumToolCalls !== "number" ||
      typeof globalBudgets.maximumToolCalls !== "number" ||
      globalBudgets.maximumToolCalls > projectedOrder.maximumToolCalls
    ) {
      throw new Error("Scoped WorkPlan exceeds its work-order tool budget");
    }
    const allowedCapabilities = new Set(
      stringArray(projectedOrder.allowedCapabilities),
    );
    if (
      nodes.some((node) =>
        (node.allowedTools ?? []).some(
          (capability) => !allowedCapabilities.has(capability),
        ),
      )
    ) {
      throw new Error(
        "Scoped WorkPlan uses capabilities outside its work order",
      );
    }
    const scopedPermissions = permissionSet(
      projectedOrder.permissions,
      "Scoped work-order permissions",
    );
    for (const node of nodes) {
      if (
        !permissionSetIsSubset(
          permissionSet(node.permissions, `Work node ${node.id} permissions`),
          scopedPermissions,
        )
      ) {
        throw new Error(`Work node ${node.id} exceeds scoped permissions`);
      }
    }
  }
  const coveredCriteria = new Set<string>();
  for (const node of nodes) {
    const nodePermissions = permissionSet(
      node.permissions,
      `Work node ${node.id} permissions`,
    );
    if (!permissionSetIsSubset(nodePermissions, contractPermissions)) {
      throw new Error(
        `Work node ${node.id} permissions exceed the TaskContract`,
      );
    }
    if (!permissionSetIsSubset(nodePermissions, planCeiling)) {
      throw new Error(
        `Work node ${node.id} attempts mutation before the diagnosis review gate`,
      );
    }
    if (
      (node.budgets?.maximumChildren ?? 0) >
      nodePermissions.subagents.maximumChildren
    ) {
      throw new Error(
        `Work node ${node.id} child budget exceeds its subagent permission`,
      );
    }
    if (
      nodePermissions.subagents.maximumDepth >
        (globalBudgets.maximumSubagentDepth as number) ||
      (nodePermissions.subagents.spawn &&
        (globalBudgets.maximumSubagentDepth as number) === 0)
    ) {
      throw new Error(
        `Work node ${node.id} subagent depth exceeds the WorkPlan or host budget`,
      );
    }
    for (const capability of node.allowedTools ?? []) {
      if (!permissionAllowsCapability(nodePermissions, capability)) {
        throw new Error(
          `Work node ${node.id} tool ${capability} is not permission-backed`,
        );
      }
    }
    const requiredCapabilities = node.requiredCapabilities ?? [];
    const uniqueRequiredCapabilities = new Set(requiredCapabilities);
    if (uniqueRequiredCapabilities.size !== requiredCapabilities.length) {
      throw new Error(
        `Work node ${node.id} required capabilities must be unique`,
      );
    }
    if (
      run.requestedMode !== "report_only" &&
      run.requestedMode !== "plan_only" &&
      requiredCapabilities.length === 0
    ) {
      throw new Error(
        `Executable work node ${node.id} requires at least one completion capability`,
      );
    }
    if (
      requiredCapabilities.some(
        (capability) => !(node.allowedTools ?? []).includes(capability),
      )
    ) {
      throw new Error(
        `Work node ${node.id} requires a capability outside its allowed tools`,
      );
    }
    if (
      (node.budgets?.maximumToolCalls ?? 0) < uniqueRequiredCapabilities.size
    ) {
      throw new Error(
        `Work node ${node.id} tool budget cannot satisfy its required capabilities`,
      );
    }
    if (
      uniqueRequiredCapabilities.has("subagent.spawn") &&
      (node.budgets?.maximumChildren ?? 0) < 1
    ) {
      throw new Error(
        `Work node ${node.id} requires a child budget for subagent.spawn`,
      );
    }
    for (const criterion of node.acceptanceCriteria ?? []) {
      if (!criteria.has(criterion)) {
        throw new Error(
          `Work node ${node.id} invents acceptance criterion ${criterion}`,
        );
      }
      if (scopedCriteria && !scopedCriteria.includes(criterion)) {
        throw new Error(
          `Scoped node ${node.id} exceeds its authorized criteria`,
        );
      }
      if (
        run.requestedMode === "analyze_and_fix" &&
        !ctx.analysisFixUnlocked(run.runId) &&
        correctionControl === null &&
        criterionStages.get(criterion) !== "diagnosis"
      ) {
        throw new Error(
          `Initial diagnosis node ${node.id} cannot claim completion criterion ${criterion}`,
        );
      }
      coveredCriteria.add(criterion);
    }
  }
  const initialDiagnosisCriteria = criterionRecords
    .filter((criterion) => criterion.stage === "diagnosis")
    .map((criterion) => criterion.id)
    .filter((id): id is string => typeof id === "string");
  const requiredPlanCriteria =
    scopedCriteria ??
    (run.requestedMode === "analyze_and_fix" &&
    !ctx.analysisFixUnlocked(run.runId)
      ? initialDiagnosisCriteria
      : [...criteria]);
  if (
    requiredPlanCriteria.length > 0 &&
    !requiredPlanCriteria.every((criterion) => coveredCriteria.has(criterion))
  ) {
    throw new Error(
      scopedCriteria
        ? "Scoped WorkPlan must cover every authorized criterion"
        : "WorkPlan must cover every TaskContract acceptance criterion",
    );
  }
  const requiredVerificationStage =
    run.requestedMode === "analyze_and_fix"
      ? correctionControl !== null || ctx.analysisFixUnlocked(run.runId)
        ? "completion"
        : "diagnosis"
      : null;
  const requiredVerifications = Array.isArray(contract.verificationRequirements)
    ? (contract.verificationRequirements as Array<Record<string, unknown>>)
        .filter((requirement) => requirement.required === true)
        .filter(
          (requirement) =>
            requiredVerificationStage === null ||
            requirement.stage === requiredVerificationStage,
        )
    : [];
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const ancestorIdsByNode = new Map<string, Set<string>>();
  for (const node of nodes) {
    const pending = [...node.dependsOn];
    const ancestors = new Set<string>();
    while (pending.length > 0) {
      const current = pending.pop()!;
      if (ancestors.has(current)) continue;
      ancestors.add(current);
      pending.push(...(nodesById.get(current)?.dependsOn ?? []));
    }
    ancestorIdsByNode.set(node.id, ancestors);
  }
  const mutatingNodes = nodes.filter((node) =>
    (node.allowedTools ?? []).some((capability) =>
      potentiallyMutatingPlanCapabilities.has(capability),
    ),
  );
  for (const requirement of requiredVerifications) {
    const capability = requirement.capability;
    const stage = requirement.stage;
    const verificationNodes =
      typeof capability === "string" &&
      typeof stage === "string" &&
      nodes.filter(
        (node) =>
          (node.requiredCapabilities ?? []).includes(capability) &&
          (node.acceptanceCriteria ?? []).some(
            (criterion) => criterionStages.get(criterion) === stage,
          ),
      );
    if (!verificationNodes || verificationNodes.length === 0) {
      throw new Error(
        `Required verification ${String(requirement.id)} using ${String(capability)} is not scheduled by a same-stage WorkPlan node`,
      );
    }
    if (stage === "completion") {
      for (const verificationNode of verificationNodes) {
        for (const mutatingNode of mutatingNodes) {
          if (
            verificationNode.id !== mutatingNode.id &&
            !ancestorIdsByNode.get(verificationNode.id)?.has(mutatingNode.id)
          ) {
            throw new Error(
              `Completion verification ${String(requirement.id)} must run after mutating node ${mutatingNode.id}`,
            );
          }
        }
      }
    }
  }
}
