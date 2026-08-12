import { describe, expect, it } from "vitest";

import { emptyPermissionSet } from "../permissions.js";
import type { RunRecord } from "../types.js";
import {
  assertScopedWorkOrder,
  assertWorkPlanSubmission,
} from "./work-plan-validator.js";

function runRecord(overrides: Partial<RunRecord> = {}): RunRecord {
  return {
    runId: "run-1",
    phase: "agent_3_plan",
    requestedMode: "fix_only",
    repositoryRoot: "/workspace/project",
    budgets: {
      promptRevisionsRemaining: 1,
      postExecutionRemediationsRemaining: 1,
      escalationsRemaining: 1,
    },
    ...overrides,
  } as RunRecord;
}

function contractPermissions() {
  const permissions = emptyPermissionSet();
  permissions.repository.read = ["/workspace/project"];
  permissions.shell.inspect = true;
  return permissions;
}

function validNode(overrides: Record<string, unknown> = {}) {
  const permissions = contractPermissions();
  return {
    id: "node-1",
    dependsOn: [],
    allowedTools: ["repository.read"],
    requiredCapabilities: ["repository.read"],
    acceptanceCriteria: ["criterion-1"],
    permissions,
    budgets: { maximumToolCalls: 1, maximumChildren: 0 },
    ...overrides,
  };
}

describe("assertScopedWorkOrder", () => {
  it("accepts a permission-backed scoped work order", () => {
    const permissions = contractPermissions();
    expect(() =>
      assertScopedWorkOrder(
        {
          targetCriterionIds: ["criterion-1"],
          permissions,
          allowedCapabilities: ["repository.read"],
          sourceRefs: ["artifact://run-1/evidence-1"],
        },
        {
          label: "Test work order",
          criterionField: "targetCriterionIds",
          allowedCriteria: ["criterion-1"],
          contractPermissions: permissions,
          authorizedPermissions: permissions,
          eligibleSourceRefs: new Set(["artifact://run-1/evidence-1"]),
        },
      ),
    ).not.toThrow();
  });

  it("rejects work orders with invalid criteria", () => {
    const permissions = contractPermissions();
    expect(() =>
      assertScopedWorkOrder(
        {
          targetCriterionIds: ["missing"],
          permissions,
          allowedCapabilities: ["repository.read"],
          sourceRefs: ["artifact://run-1/evidence-1"],
        },
        {
          label: "Test work order",
          criterionField: "targetCriterionIds",
          allowedCriteria: ["criterion-1"],
          contractPermissions: permissions,
          authorizedPermissions: permissions,
          eligibleSourceRefs: new Set(["artifact://run-1/evidence-1"]),
        },
      ),
    ).toThrow(/invalid contract criteria/);
  });
});

describe("assertWorkPlanSubmission", () => {
  const contractBody = {
    permissions: contractPermissions(),
    acceptanceCriteria: [{ id: "criterion-1", stage: "completion" }],
    verificationRequirements: [],
  };

  function submit(body: Record<string, unknown>) {
    assertWorkPlanSubmission({
      run: runRecord(),
      submissionId: "plan-1",
      body: {
        taskContractRef: "artifact://run-1/contract-1",
        planValidation: "valid",
        executionMode: "serial",
        globalBudgets: {
          maximumToolCalls: 2,
          maximumParallelWorkers: 1,
          maximumSubagentDepth: 0,
        },
        nodes: [validNode()],
        ...body,
      },
      envelope: {
        budgets: {
          maximumParallelWorkers: 1,
          maximumSubagentDepth: 0,
        },
      },
      latestRef: () => "artifact://run-1/contract-1",
      latestContractBody: contractBody,
      analysisFixUnlocked: () => true,
      listArtifacts: () => [],
      getArtifactBody: () => null,
      explicitPermissionProjection: () => contractPermissions(),
    });
  }

  it("accepts a valid serial WorkPlan", () => {
    expect(() => submit({})).not.toThrow();
  });

  it("rejects WorkPlans that target the wrong TaskContract", () => {
    expect(() =>
      submit({ taskContractRef: "artifact://run-1/other-contract" }),
    ).toThrow(/current TaskContract/);
  });

  it("rejects non-serial execution modes", () => {
    expect(() => submit({ executionMode: "parallel" })).toThrow(/serial/);
  });

  it("rejects WorkPlans that invent acceptance criteria", () => {
    expect(() =>
      submit({
        nodes: [
          validNode({
            acceptanceCriteria: ["unknown-criterion"],
          }),
        ],
      }),
    ).toThrow(/invents acceptance criterion/);
  });
});
