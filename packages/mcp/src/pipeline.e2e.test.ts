import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Worker } from "node:worker_threads";

import { afterEach, describe, expect, it } from "vitest";

import {
  NO_PERMISSIONS,
  VALID_ARTIFACT_BODIES,
} from "../../protocol/test/test-helpers.js";
import { TelicService } from "./service.js";

const services: TelicService[] = [];

type SupportingWorkerResult =
  | { kind: "result"; ok: true; artifact: unknown }
  | { kind: "result"; ok: false; error: string };

function supportingWorkerMessage<T>(worker: Worker, kind: string): Promise<T> {
  return new Promise<T>((resolvePromise, rejectPromise) => {
    const onMessage = (message: { kind?: unknown }): void => {
      if (message.kind !== kind) return;
      cleanup();
      resolvePromise(message as T);
    };
    const onError = (error: Error): void => {
      cleanup();
      rejectPromise(error);
    };
    const onExit = (code: number): void => {
      cleanup();
      rejectPromise(
        new Error(
          `Supporting worker exited with code ${String(code)} before ${kind}`,
        ),
      );
    };
    const cleanup = (): void => {
      worker.off("message", onMessage);
      worker.off("error", onError);
      worker.off("exit", onExit);
    };
    worker.on("message", onMessage);
    worker.on("error", onError);
    worker.on("exit", onExit);
  });
}

async function runBlockedServiceWorkers(
  harness: Awaited<ReturnType<typeof groundedHarness>>,
  submissions: readonly {
    type: string;
    producer: string;
    body: Record<string, unknown>;
  }[],
): Promise<SupportingWorkerResult[]> {
  const workerUrl = new URL(
    "../../../test/helpers/supporting-artifact-worker.ts",
    import.meta.url,
  );
  const workers = submissions.map(
    (submission) =>
      new Worker(workerUrl, {
        workerData: {
          kind: "service",
          repositoryRoot: harness.service.repositoryRoot,
          stateDirectory: harness.service.stateDirectory,
          artifact: {
            id: submission.body.id,
            runId: harness.started.run.runId,
            type: submission.type,
            schemaVersion: "1.0",
            producer: submission.producer,
            body: submission.body,
          },
        },
        execArgv: ["--import", "tsx"],
      }),
  );
  await Promise.all(
    workers.map(async (worker) => supportingWorkerMessage(worker, "ready")),
  );
  const blocker = new DatabaseSync(harness.service.ledger.databasePath);
  blocker.exec("PRAGMA busy_timeout = 5000; BEGIN IMMEDIATE;");
  let locked = true;
  try {
    const starting = workers.map(async (worker) =>
      supportingWorkerMessage(worker, "starting"),
    );
    const results = workers.map(async (worker) =>
      supportingWorkerMessage<SupportingWorkerResult>(worker, "result"),
    );
    for (const worker of workers) worker.postMessage("go");
    await Promise.all(starting);
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
    blocker.exec("COMMIT");
    locked = false;
    return await Promise.all(results);
  } finally {
    if (locked) blocker.exec("ROLLBACK");
    blocker.close();
  }
}

afterEach(() => {
  for (const service of services.splice(0)) service.close();
});

function bindTemplate(
  value: unknown,
  runId: string,
  requestId: string,
): unknown {
  if (typeof value === "string") {
    return value
      .replaceAll("run-01", runId)
      .replaceAll(
        `artifact://${runId}/user-message-01`,
        `artifact://${runId}/${requestId}`,
      )
      .replaceAll(
        `artifact://${runId}/browser-response-01`,
        `artifact://${runId}/evidence-01`,
      )
      .replaceAll(
        `artifact://${runId}/action-ledger-01`,
        `artifact://${runId}/evidence-01`,
      )
      .replaceAll(`trace://${runId}/event-0042`, `trace://${runId}`);
  }
  if (Array.isArray(value))
    return value.map((item) => bindTemplate(item, runId, requestId));
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [
        key,
        bindTemplate(child, runId, requestId),
      ]),
    );
  }
  return value;
}

async function groundedHarness(
  mode: "report_only" | "analyze_only" | "analyze_and_fix" = "analyze_only",
  hostCapabilities = [
    "repository.read",
    "shell.inspect",
    "browser.inspect",
    "runtime.inspect",
  ],
) {
  const root = mkdtempSync(join(tmpdir(), "telic-pipeline-"));
  writeFileSync(join(root, "AGENTS.md"), "# Rules\nPreserve authorization.\n");
  mkdirSync(join(root, "apps/web/src"), { recursive: true });
  mkdirSync(join(root, "apps/api"), { recursive: true });
  writeFileSync(
    join(root, "apps/web/src/api.ts"),
    "export const path = '/api';\n",
  );
  writeFileSync(join(root, "apps/api/cors.ts"), "export const cors = true;\n");
  const service = new TelicService({
    repositoryRoot: root,
    stateDirectory: mkdtempSync(join(tmpdir(), "telic-pipeline-state-")),
  });
  services.push(service);
  const started = service.startRun({
    originalRequest: "Investigate the project communication failure.",
    mode,
    hostName: "codex",
    hostCapabilities,
    authorizationGranted: hostCapabilities,
  });
  await service.groundContext({ runId: started.run.runId });
  const request = service
    .getRun(started.run.runId)
    .artifacts.find((artifact) => artifact.type === "UserMessage")!;
  const body = (type: keyof typeof VALID_ARTIFACT_BODIES) =>
    bindTemplate(
      structuredClone(VALID_ARTIFACT_BODIES[type]),
      started.run.runId,
      request.id,
    ) as Record<string, any>;
  const submit = (
    type: string,
    producer: string,
    artifactBody: Record<string, any>,
    sourceRefs?: string[],
  ) =>
    service.submitArtifact({
      id: artifactBody.id as string,
      runId: started.run.runId,
      type,
      schemaVersion: "1.0",
      producer,
      body: artifactBody,
      ...(sourceRefs ? { sourceRefs } : {}),
    });
  return { service, started, body, submit };
}

function advanceToExecutor(
  harness: Awaited<ReturnType<typeof groundedHarness>>,
) {
  harness.submit(
    "ProblemFrame",
    "scenario_author",
    harness.body("ProblemFrame"),
  );
  harness.submit("TaskContract", "task_compiler", harness.body("TaskContract"));
  harness.submit(
    "PromptReview",
    "scenario_author",
    harness.body("PromptReview"),
  );
  return harness.submit(
    "WorkPlan",
    "quality_controller",
    harness.body("WorkPlan"),
  );
}

describe("serial Telic pipeline", () => {
  it("advances from raw request to an independently audited evidence report", async () => {
    const root = mkdtempSync(join(tmpdir(), "telic-pipeline-"));
    writeFileSync(
      join(root, "AGENTS.md"),
      "# Rules\nDo not mutate in analysis-only mode.\n",
    );
    mkdirSync(join(root, "apps/web/src"), { recursive: true });
    mkdirSync(join(root, "apps/api"), { recursive: true });
    writeFileSync(
      join(root, "apps/web/src/api.ts"),
      "export const projectsPath = '/api/projects';\n",
    );
    writeFileSync(
      join(root, "apps/api/cors.ts"),
      "export const allowedOrigins = ['http://localhost:5173'];\n",
    );
    const service = new TelicService({
      repositoryRoot: root,
      stateDirectory: mkdtempSync(join(tmpdir(), "telic-pipeline-state-")),
    });
    services.push(service);
    const started = service.startRun({
      originalRequest:
        "Investigate why the React client cannot retrieve project data.",
      mode: "analyze_only",
      hostName: "codex",
      hostCapabilities: [
        "repository.read",
        "shell.inspect",
        "browser.inspect",
        "runtime.inspect",
      ],
      authorizationGranted: [
        "repository.read",
        "shell.inspect",
        "browser.inspect",
        "runtime.inspect",
      ],
    });
    await service.groundContext({ runId: started.run.runId });

    const request = service
      .getRun(started.run.runId)
      .artifacts.find((artifact) => artifact.type === "UserMessage");
    expect(request).toBeDefined();
    const body = (type: keyof typeof VALID_ARTIFACT_BODIES) =>
      bindTemplate(
        structuredClone(VALID_ARTIFACT_BODIES[type]),
        started.run.runId,
        request!.id,
      );
    const submit = (type: string, producer: string, artifactBody: unknown) =>
      service.submitArtifact({
        id: (artifactBody as { id: string }).id,
        runId: started.run.runId,
        type,
        schemaVersion: "1.0",
        producer,
        body: artifactBody,
      });

    expect(
      submit("ProblemFrame", "scenario_author", body("ProblemFrame")).nextAction
        ?.phase,
    ).toBe("agent_2_compile");
    expect(
      submit("ScenarioSpec", "scenario_author", body("ScenarioSpec")).nextAction
        ?.phase,
    ).toBe("agent_2_compile");
    expect(
      submit("TaskContract", "task_compiler", body("TaskContract")).nextAction
        ?.phase,
    ).toBe("agent_1_review");
    expect(
      submit("PromptReview", "scenario_author", body("PromptReview")).nextAction
        ?.phase,
    ).toBe("agent_3_plan");
    expect(
      submit("WorkPlan", "quality_controller", body("WorkPlan")).nextAction
        ?.phase,
    ).toBe("agent_4_execute");
    const executorAction = service.controller.getNextAction(started.run.runId);
    if (executorAction.kind !== "phase") throw new Error("phase expected");
    expect(executorAction.additionalOutputSchemas).toHaveProperty("Evidence");
    expect(executorAction.requiredOutputType).toBe("WorkResult");

    const evidence = {
      schemaVersion: "1.0",
      id: "evidence-01",
      runId: started.run.runId,
      kind: "browser",
      capturedAt: "2026-07-15T10:05:00Z",
      summary: "The API rejected the local browser origin during preflight.",
      contentType: "application/json",
      encoding: "utf8",
      content: '{"status":403,"boundary":"cors-preflight"}',
      sourceRefs: [],
      redactions: [],
      rationaleSummary: "Captured directly from the browser network response.",
    };
    expect(submit("Evidence", "executor", evidence).nextAction?.phase).toBe(
      "agent_4_execute",
    );
    expect(
      submit("WorkResult", "executor", body("WorkResult")).nextAction?.phase,
    ).toBe("agent_3_quality_review");
    expect(
      submit("QualityReview", "quality_controller", body("QualityReview"))
        .nextAction?.phase,
    ).toBe("agent_5_release_audit");
    expect(
      submit("ReleaseAudit", "release_auditor", body("ReleaseAudit")).nextAction
        ?.phase,
    ).toBe("user_report");
    const completed = submit(
      "UserReport",
      "release_auditor",
      body("UserReport"),
    );

    expect(completed.run.status).toBe("completed");
    expect(completed.nextAction).toMatchObject({
      kind: "terminal",
      status: "completed",
    });
    expect(completed.run.budgets).toEqual({
      promptRevisionsRemaining: 1,
      postExecutionRemediationsRemaining: 1,
    });
    expect(
      service
        .getRun(started.run.runId)
        .artifacts.map((artifact) => artifact.type),
    ).toEqual(
      expect.arrayContaining([
        "ProblemFrame",
        "ScenarioSpec",
        "TaskContract",
        "PromptReview",
        "WorkPlan",
        "Evidence",
        "WorkResult",
        "QualityReview",
        "ReleaseAudit",
        "UserReport",
      ]),
    );
    const trace = service.getTrace(started.run.runId);
    expect(trace.at(-1)?.rationaleSummary).toContain("completed");
    const qualityEvent = trace.find((event) =>
      event.outputRefs.some((ref) => ref.endsWith("/quality-review-01")),
    );
    expect(qualityEvent?.inputRefs).toEqual(
      expect.arrayContaining([
        `artifact://${started.run.runId}/contract-01`,
        `artifact://${started.run.runId}/plan-01`,
        `artifact://${started.run.runId}/result-01`,
      ]),
    );
  });

  it("rejects mode drift, producer forgery, and ungrounded repository evidence", async () => {
    const first = await groundedHarness();
    const drifted = first.body("ProblemFrame");
    drifted.intentMode = "analyze_and_fix";
    expect(() =>
      first.submit("ProblemFrame", "scenario_author", drifted),
    ).toThrow(/immutable run mode/);

    const second = await groundedHarness();
    expect(() =>
      second.submit(
        "ProblemFrame",
        "task_compiler",
        second.body("ProblemFrame"),
      ),
    ).toThrow(/producer/);

    const third = await groundedHarness();
    const fabricated = third.body("ProblemFrame");
    fabricated.knownFacts[0].sourceRef = "repo://nonexistent/fabricated.txt";
    expect(() =>
      third.submit("ProblemFrame", "scenario_author", fabricated),
    ).toThrow(/not selected/);
  });

  it("deduplicates source lineage before enforcing the unique-reference limit", async () => {
    const duplicateHeavy = await groundedHarness();
    duplicateHeavy.submit(
      "ProblemFrame",
      "scenario_author",
      duplicateHeavy.body("ProblemFrame"),
    );
    const contract = duplicateHeavy.body("TaskContract");
    contract.contextRefs = Array.from(
      { length: 256 },
      () => "repo://apps/web/src/api.ts",
    );
    contract.ruleRefs = ["repo://AGENTS.md"];
    duplicateHeavy.submit("TaskContract", "task_compiler", contract);
    expect(
      duplicateHeavy.service.getArtifact(
        duplicateHeavy.started.run.runId,
        contract.id,
      ).sourceRefs,
    ).toEqual(
      expect.arrayContaining([
        "repo://apps/web/src/api.ts",
        "repo://AGENTS.md",
      ]),
    );

    const overflowing = await groundedHarness();
    overflowing.submit(
      "ProblemFrame",
      "scenario_author",
      overflowing.body("ProblemFrame"),
    );
    const overflowingContract = overflowing.body("TaskContract");
    overflowingContract.contextRefs = Array.from(
      { length: 255 },
      (_, index) => `repo://generated/path-${String(index)}.ts`,
    );
    expect(() =>
      overflowing.submit("TaskContract", "task_compiler", overflowingContract),
    ).toThrow(/sourceRefs exceed the 256 item limit/);
  });

  it("makes ScenarioSpec replay idempotent and enforces one presentation per frame", async () => {
    const harness = await groundedHarness();
    harness.submit(
      "ProblemFrame",
      "scenario_author",
      harness.body("ProblemFrame"),
    );
    const scenario = harness.body("ScenarioSpec");
    const first = harness.submit("ScenarioSpec", "scenario_author", scenario);
    const replay = harness.submit(
      "ScenarioSpec",
      "scenario_author",
      structuredClone(scenario),
    );
    expect(replay.artifact).toEqual(first.artifact);

    expect(() =>
      harness.submit("ScenarioSpec", "scenario_author", {
        ...structuredClone(scenario),
        rationaleSummary: "A conflicting presentation body.",
      }),
    ).toThrow(/conflicts with immutable artifact/);
    expect(() =>
      harness.submit("ScenarioSpec", "scenario_author", {
        ...structuredClone(scenario),
        id: "scenario-02",
      }),
    ).toThrow(/Only one ScenarioSpec/);
    expect(
      harness.service
        .getRun(harness.started.run.runId)
        .artifacts.filter((artifact) => artifact.type === "ScenarioSpec"),
    ).toHaveLength(1);
  });

  it("enforces the ScenarioSpec quota atomically across services", async () => {
    const harness = await groundedHarness();
    harness.submit(
      "ProblemFrame",
      "scenario_author",
      harness.body("ProblemFrame"),
    );
    const first = harness.body("ScenarioSpec");
    first.id = "concurrent-scenario-01";
    const second = structuredClone(first);
    second.id = "concurrent-scenario-02";
    const results = await runBlockedServiceWorkers(harness, [
      { type: "ScenarioSpec", producer: "scenario_author", body: first },
      { type: "ScenarioSpec", producer: "scenario_author", body: second },
    ]);

    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(
      results.find(
        (result) => !result.ok && /Only one ScenarioSpec/.test(result.error),
      ),
    ).toBeDefined();
    expect(
      harness.service
        .getRun(harness.started.run.runId)
        .artifacts.filter((artifact) => artifact.type === "ScenarioSpec"),
    ).toHaveLength(1);
  });

  it("resumes clarification without replacing the immutable original request", async () => {
    const harness = await groundedHarness();
    const request = harness.body("ClarificationRequest");
    request.evidenceInspected = ["repo://AGENTS.md"];
    const paused = harness.submit(
      "ClarificationRequest",
      "scenario_author",
      request,
    );
    expect(paused.nextAction.kind).toBe("clarification");
    const resumed = harness.service.answerClarification(
      harness.started.run.runId,
      "local-only",
    );
    expect(resumed.nextAction).toMatchObject({
      kind: "phase",
      phase: "agent_1_frame",
    });
    if (resumed.nextAction.kind !== "phase") throw new Error("phase expected");
    expect(
      resumed.nextAction.inputRefs.filter((ref) => ref.includes("artifact://")),
    ).toHaveLength(5);
    const clarificationAnswer = harness.service
      .getRun(harness.started.run.runId)
      .artifacts.filter((artifact) => artifact.type === "UserMessage")
      .find((artifact) =>
        artifact.sourceRefs.includes(
          `artifact://${harness.started.run.runId}/${request.id}`,
        ),
      );
    if (!clarificationAnswer) throw new Error("clarification answer expected");
    expect(() =>
      harness.submit(
        "ProblemFrame",
        "scenario_author",
        harness.body("ProblemFrame"),
        [
          `artifact://${harness.started.run.runId}/${request.id}`,
          `artifact://${harness.started.run.runId}/${clarificationAnswer.id}`,
        ],
      ),
    ).not.toThrow();
  });

  it("keeps report-only out of executor phases", async () => {
    const harness = await groundedHarness("report_only", []);
    const frame = harness.body("ProblemFrame");
    frame.intentMode = "report_only";
    frame.applicableRuleRefs = [];
    harness.submit("ProblemFrame", "scenario_author", frame);

    const contract = harness.body("TaskContract");
    contract.intentMode = "report_only";
    contract.contextRefs = [];
    contract.ruleRefs = [];
    contract.permissions = structuredClone(NO_PERMISSIONS);
    contract.verificationRequirements = [];
    harness.submit("TaskContract", "task_compiler", contract);
    harness.submit(
      "PromptReview",
      "scenario_author",
      harness.body("PromptReview"),
    );

    const plan = harness.body("WorkPlan");
    plan.nodes[0].allowedTools = [];
    plan.nodes[0].requiredCapabilities = [];
    plan.nodes[0].contextRefs = [];
    plan.nodes[0].permissions = structuredClone(NO_PERMISSIONS);
    const planned = harness.submit("WorkPlan", "quality_controller", plan);
    expect(planned.nextAction).toMatchObject({
      kind: "phase",
      phase: "agent_3_quality_review",
      workNodeId: null,
    });
  });

  it("executes every dependency-ready WorkPlan node before review", async () => {
    const harness = await groundedHarness();
    harness.submit(
      "ProblemFrame",
      "scenario_author",
      harness.body("ProblemFrame"),
    );
    harness.submit(
      "TaskContract",
      "task_compiler",
      harness.body("TaskContract"),
    );
    harness.submit(
      "PromptReview",
      "scenario_author",
      harness.body("PromptReview"),
    );
    const plan = harness.body("WorkPlan");
    plan.nodes.push({
      ...structuredClone(plan.nodes[0]),
      id: "verify",
      dependsOn: ["investigate"],
      objective: "Independently verify the observed boundary.",
    });
    plan.globalBudgets.maximumToolCalls = 24;
    harness.submit("WorkPlan", "quality_controller", plan);
    harness.submit("Evidence", "executor", {
      schemaVersion: "1.0",
      id: "evidence-01",
      runId: harness.started.run.runId,
      kind: "browser",
      capturedAt: "2026-07-15T10:05:00Z",
      summary: "Captured a rejected local preflight response.",
      contentType: "application/json",
      encoding: "utf8",
      content: '{"status":403}',
      sourceRefs: [],
      redactions: [],
      rationaleSummary: "Direct local browser evidence.",
    });
    const first = harness.submit(
      "WorkResult",
      "executor",
      harness.body("WorkResult"),
    );
    expect(first.nextAction).toMatchObject({
      phase: "agent_4_execute",
      workNodeId: "verify",
    });
    const secondResult = harness.body("WorkResult");
    secondResult.id = "result-02";
    secondResult.nodeId = "verify";
    secondResult.actions[0].id = "action-02";
    const second = harness.submit("WorkResult", "executor", secondResult);
    expect(second.nextAction.phase).toBe("agent_3_quality_review");
  });

  it("rejects a claimed mutation in analyze-only mode", async () => {
    const harness = await groundedHarness();
    advanceToExecutor(harness);
    harness.submit("Evidence", "executor", {
      schemaVersion: "1.0",
      id: "evidence-01",
      runId: harness.started.run.runId,
      kind: "browser",
      capturedAt: "2026-07-15T10:05:00Z",
      summary: "Captured local response evidence.",
      contentType: "application/json",
      encoding: "utf8",
      content: '{"status":403}',
      sourceRefs: [],
      redactions: [],
      rationaleSummary: "Direct local evidence.",
    });
    const result = harness.body("WorkResult");
    result.actions[0].mutating = true;
    expect(() => harness.submit("WorkResult", "executor", result)).toThrow(
      /cannot accept mutating work/,
    );
  });

  it("decodes base64 evidence before credential screening", async () => {
    const harness = await groundedHarness();
    advanceToExecutor(harness);
    const syntheticDetectorMarker =
      "api_key = 'fixture_detector_value_123456789'";
    const encodedEvidence = {
      schemaVersion: "1.0",
      id: "encoded-secret",
      runId: harness.started.run.runId,
      kind: "tool_output",
      capturedAt: "2026-07-15T10:05:00Z",
      summary: "Encoded diagnostic output.",
      contentType: "application/octet-stream",
      encoding: "base64",
      content: Buffer.from(syntheticDetectorMarker).toString("base64"),
      sourceRefs: [],
      redactions: [],
      rationaleSummary: "Captured tool output.",
    };

    expect(() =>
      harness.submit("Evidence", "executor", encodedEvidence),
    ).toThrow(/likely credential/);
    expect(() =>
      harness.submit("Evidence", "executor", {
        ...encodedEvidence,
        id: "malformed-base64",
        content: "not@@canonical-base64",
      }),
    ).toThrow(/canonical base64/);
    expect(
      harness.service
        .getRun(harness.started.run.runId)
        .artifacts.filter((artifact) => artifact.type === "Evidence"),
    ).toHaveLength(0);
  });

  it("screens every persisted Evidence string and reference field", async () => {
    const harness = await groundedHarness();
    advanceToExecutor(harness);
    const syntheticDetectorMarker =
      "token = 'fixture_detector_value_123456789'";
    const identifierDetectorMarker = "token:fixture_detector_value_123456789";
    const baseEvidence = {
      schemaVersion: "1.0",
      id: "screened-evidence",
      runId: harness.started.run.runId,
      kind: "tool_output",
      capturedAt: "2026-07-15T10:05:00Z",
      summary: "Bounded diagnostic output.",
      contentType: "text/plain",
      encoding: "utf8",
      content: "No sensitive diagnostic values were retained.",
      sourceRefs: [],
      redactions: ["Sensitive values were removed."],
      rationaleSummary: "Captured from a local diagnostic tool.",
    };
    const variants = [
      { ...baseEvidence, id: identifierDetectorMarker },
      {
        ...baseEvidence,
        id: "screened-summary",
        summary: syntheticDetectorMarker,
      },
      {
        ...baseEvidence,
        id: "screened-content-type",
        contentType: `text/plain; ${syntheticDetectorMarker}`,
      },
      {
        ...baseEvidence,
        id: "screened-source-ref",
        sourceRefs: [`repo://${identifierDetectorMarker}`],
      },
      {
        ...baseEvidence,
        id: "screened-redaction",
        redactions: [syntheticDetectorMarker],
      },
      {
        ...baseEvidence,
        id: "screened-rationale",
        rationaleSummary: syntheticDetectorMarker,
      },
    ];

    for (const evidence of variants) {
      expect(() => harness.submit("Evidence", "executor", evidence)).toThrow(
        /likely credential/,
      );
    }
    expect(
      harness.service
        .getRun(harness.started.run.runId)
        .artifacts.filter((artifact) => artifact.type === "Evidence"),
    ).toHaveLength(0);
  });

  it("makes Evidence replay and its per-plan quota atomic across services", async () => {
    const harness = await groundedHarness();
    advanceToExecutor(harness);
    const evidence = (index: number) => ({
      schemaVersion: "1.0",
      id: `quota-evidence-${String(index).padStart(3, "0")}`,
      runId: harness.started.run.runId,
      kind: "tool_output",
      capturedAt: "2026-07-15T10:05:00Z",
      summary: `Bounded diagnostic observation ${String(index)}.`,
      contentType: "text/plain",
      encoding: "utf8",
      content: `Observation ${String(index)} contains no sensitive values.`,
      sourceRefs: [],
      redactions: ["Sensitive values were removed before capture."],
      rationaleSummary: "Captured from a local diagnostic tool.",
    });
    const firstBody = evidence(1);
    const first = harness.submit("Evidence", "executor", firstBody);
    const replay = harness.submit(
      "Evidence",
      "executor",
      structuredClone(firstBody),
    );
    expect(replay.artifact).toEqual(first.artifact);
    expect(() =>
      harness.submit("Evidence", "executor", {
        ...structuredClone(firstBody),
        content: "A conflicting bounded observation.",
      }),
    ).toThrow(/conflicts with immutable artifact/);

    for (let index = 2; index <= 127; index += 1) {
      harness.submit("Evidence", "executor", evidence(index));
    }
    const concurrentResults = await runBlockedServiceWorkers(harness, [
      { type: "Evidence", producer: "executor", body: evidence(128) },
      { type: "Evidence", producer: "executor", body: evidence(129) },
    ]);
    expect(concurrentResults.filter((result) => result.ok)).toHaveLength(1);
    expect(
      concurrentResults.find(
        (result) =>
          !result.ok &&
          /Evidence quota of 128 per WorkPlan reached/.test(result.error),
      ),
    ).toBeDefined();
    expect(
      harness.service
        .getRun(harness.started.run.runId)
        .artifacts.filter((artifact) => artifact.type === "Evidence"),
    ).toHaveLength(128);
    expect(
      harness.submit("Evidence", "executor", structuredClone(firstBody))
        .artifact,
    ).toEqual(first.artifact);
  }, 20_000);

  it("gates analyze-and-fix mutation behind an evidence review", async () => {
    const capabilities = [
      "repository.read",
      "repository.write",
      "shell.inspect",
      "browser.inspect",
      "runtime.inspect",
    ];
    const harness = await groundedHarness("analyze_and_fix", capabilities);
    const frame = harness.body("ProblemFrame");
    frame.intentMode = "analyze_and_fix";
    frame.nonGoals = [];
    frame.draftAcceptanceCriteria[0].stage = "diagnosis";
    frame.draftAcceptanceCriteria.push({
      id: "AC-2",
      stage: "completion",
      requirement: "Apply and verify the bounded repository correction.",
      evidenceRequired: ["repository_diff_and_post_change_inspection"],
    });
    harness.submit("ProblemFrame", "scenario_author", frame);

    const contract = harness.body("TaskContract");
    contract.intentMode = "analyze_and_fix";
    contract.permissions.repository.write = ["**"];
    contract.nonGoals = [];
    contract.acceptanceCriteria[0].stage = "diagnosis";
    contract.acceptanceCriteria.push({
      id: "AC-2",
      stage: "completion",
      requirement: "Apply and verify the bounded repository correction.",
      evidenceRequired: ["repository_diff_and_post_change_inspection"],
    });
    contract.verificationRequirements[0].stage = "diagnosis";
    contract.verificationRequirements.push({
      id: "VR-COMP",
      stage: "completion",
      description: "Inspect the corrected target after mutation.",
      required: true,
      capability: "repository.read",
      fallback: "Report failed post-change verification honestly.",
    });
    harness.submit("TaskContract", "task_compiler", contract);
    harness.submit(
      "PromptReview",
      "scenario_author",
      harness.body("PromptReview"),
    );

    const premature = harness.body("WorkPlan");
    premature.nodes[0].allowedTools = ["repository.write"];
    premature.nodes[0].requiredCapabilities = ["repository.write"];
    premature.nodes[0].permissions = structuredClone(NO_PERMISSIONS);
    premature.nodes[0].permissions.repository.write = ["**"];
    expect(() =>
      harness.submit("WorkPlan", "quality_controller", premature),
    ).toThrow(/diagnosis review gate/);

    harness.submit("WorkPlan", "quality_controller", harness.body("WorkPlan"));
    harness.submit("Evidence", "executor", {
      schemaVersion: "1.0",
      id: "evidence-01",
      runId: harness.started.run.runId,
      kind: "browser",
      capturedAt: "2026-07-15T10:05:00Z",
      summary: "Captured local response evidence.",
      contentType: "application/json",
      encoding: "utf8",
      content: '{"status":403}',
      sourceRefs: [],
      redactions: [],
      rationaleSummary: "Direct local evidence.",
    });
    harness.submit("WorkResult", "executor", harness.body("WorkResult"));
    const diagnosisReview = harness.body("QualityReview");
    diagnosisReview.decision = "proceed_to_fix";
    diagnosisReview.diagnosisGate = {
      id: "diagnosis-gate-01",
      status: "supported",
      rootCause: "The captured local response supports the diagnosed boundary.",
      directEvidenceRefs: [
        `artifact://${harness.started.run.runId}/evidence-01`,
      ],
      correctionWorkOrder: {
        id: "correction-order-01",
        targetCriterionIds: ["AC-2"],
        objective: "Apply the contract-bounded repository correction.",
        allowedCapabilities: ["repository.write", "repository.read"],
        permissions: {
          ...structuredClone(NO_PERMISSIONS),
          repository: {
            read: ["**"],
            write: ["**"],
            delete: [],
          },
        },
        sourceRefs: [`artifact://${harness.started.run.runId}/evidence-01`],
        maximumToolCalls: 12,
        rationaleSummary:
          "The correction is constrained to the diagnosed criterion and repository writes.",
      },
      withinApprovedScope: true,
      permissionsSufficient: true,
      rationaleSummary:
        "Direct local evidence supports crossing the bounded mutation gate.",
    };
    const gated = harness.submit(
      "QualityReview",
      "quality_controller",
      diagnosisReview,
    );
    expect(gated.nextAction.phase).toBe("agent_3_plan");

    const fixPlan = harness.body("WorkPlan");
    fixPlan.id = "plan-02";
    fixPlan.nodes[0].id = "fix";
    fixPlan.nodes[0].acceptanceCriteria = ["AC-2"];
    fixPlan.nodes[0].inputRefs.push(
      `artifact://${harness.started.run.runId}/${diagnosisReview.id}`,
    );
    fixPlan.nodes[0].allowedTools = ["repository.write", "repository.read"];
    fixPlan.nodes[0].requiredCapabilities = [
      "repository.write",
      "repository.read",
    ];
    fixPlan.nodes[0].permissions = structuredClone(NO_PERMISSIONS);
    fixPlan.nodes[0].permissions.repository.read = ["**"];
    fixPlan.nodes[0].permissions.repository.write = ["**"];
    const fix = harness.submit("WorkPlan", "quality_controller", fixPlan);
    expect(fix.nextAction).toMatchObject({
      phase: "agent_4_execute",
      workNodeId: "fix",
      effectivePermissions: {
        repository: { write: ["**"] },
      },
    });
  });
});
