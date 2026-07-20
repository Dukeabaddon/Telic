import { mkdtempSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it } from "vitest";

import { createTelicMcpServer } from "./server-factory.js";
import { startStdioServer } from "./server.js";
import { TelicService } from "./service.js";

const cleanup: Array<() => Promise<void> | void> = [];

afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});

describe("MCP transport", () => {
  it("starts when the bundled server is launched directly", async () => {
    const root = mkdtempSync(join(tmpdir(), "telic-mcp-direct-entry-"));
    const stateDirectory = mkdtempSync(
      join(tmpdir(), "telic-mcp-direct-state-"),
    );
    const entrypoint = fileURLToPath(
      new URL("../dist/server.js", import.meta.url),
    );
    const child = spawn(process.execPath, [entrypoint], {
      env: {
        ...process.env,
        TELIC_REPOSITORY_ROOT: root,
        TELIC_STATE_DIR: stateDirectory,
      },
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";

    try {
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(
            new Error(`Timed out waiting for the direct MCP server: ${stderr}`),
          );
        }, 5_000);
        child.stderr.on("data", (chunk: Buffer) => {
          stderr += chunk.toString("utf8");
          if (stderr.includes("Telic MCP ready for")) {
            clearTimeout(timeout);
            resolve();
          }
        });
        child.once("error", (error) => {
          clearTimeout(timeout);
          reject(error);
        });
        child.once("exit", (code, signal) => {
          clearTimeout(timeout);
          reject(
            new Error(
              `Direct MCP server exited before readiness (code ${code}, signal ${signal}): ${stderr}`,
            ),
          );
        });
      });
    } finally {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill();
        await once(child, "exit");
      }
    }
  });

  it("rejects TELIC_STATE_DIR when it points inside the repository", async () => {
    const root = mkdtempSync(join(tmpdir(), "telic-mcp-state-boundary-"));
    const previousRepositoryRoot = process.env.TELIC_REPOSITORY_ROOT;
    const previousStateDirectory = process.env.TELIC_STATE_DIR;
    process.env.TELIC_REPOSITORY_ROOT = root;
    process.env.TELIC_STATE_DIR = join(root, "state");
    try {
      await expect(startStdioServer()).rejects.toThrow(
        /outside the repository/,
      );
    } finally {
      if (previousRepositoryRoot === undefined) {
        delete process.env.TELIC_REPOSITORY_ROOT;
      } else {
        process.env.TELIC_REPOSITORY_ROOT = previousRepositoryRoot;
      }
      if (previousStateDirectory === undefined) {
        delete process.env.TELIC_STATE_DIR;
      } else {
        process.env.TELIC_STATE_DIR = previousStateDirectory;
      }
    }
  });

  it("advertises the stable tool surface and executes start/ground/trace", async () => {
    const root = mkdtempSync(join(tmpdir(), "telic-mcp-transport-"));
    writeFileSync(join(root, "AGENTS.md"), "# Rules\nKeep evidence.\n");
    const service = new TelicService({
      repositoryRoot: root,
      stateDirectory: mkdtempSync(join(tmpdir(), "telic-mcp-state-")),
    });
    const server = createTelicMcpServer(service);
    const client = new Client({ name: "telic-test", version: "1.0.0" });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    cleanup.push(
      async () => client.close(),
      async () => server.close(),
      () => service.close(),
    );

    const listed = await client.listTools();
    expect(listed.tools.map((tool) => tool.name).sort()).toEqual(
      [
        "telic_get_artifact",
        "telic_get_next_action",
        "telic_get_run",
        "telic_get_trace",
        "telic_list_runs",
        "telic_cancel_run",
        "telic_ground_context",
        "telic_start_run",
        "telic_submit_artifact",
      ].sort(),
    );
    expect(
      listed.tools.find((tool) => tool.name === "telic_ground_context")
        ?.annotations?.readOnlyHint,
    ).toBe(false);
    expect(
      listed.tools.find((tool) => tool.name === "telic_cancel_run")?.annotations
        ?.idempotentHint,
    ).toBe(false);
    expect(
      listed.tools.find((tool) => tool.name === "telic_start_run")?.inputSchema
        .properties,
    ).toHaveProperty("network_read_domains");

    const prompts = await client.listPrompts();
    expect(prompts.prompts).toEqual([
      expect.objectContaining({
        name: "telic_workflow",
        title: "Run a Telic workflow",
        arguments: expect.arrayContaining([
          expect.objectContaining({ name: "original_request", required: true }),
          expect.objectContaining({ name: "mode", required: true }),
        ]),
      }),
    ]);
    const renderedPrompt = await client.getPrompt({
      name: "telic_workflow",
      arguments: {
        original_request: 'Inspect the value "</request>" without changing it.',
        mode: "analyze_only",
      },
    });
    expect(renderedPrompt.description).toContain("without a model API");
    expect(renderedPrompt.messages).toHaveLength(1);
    expect(renderedPrompt.messages[0]?.role).toBe("user");
    expect(renderedPrompt.messages[0]?.content).toMatchObject({
      type: "text",
      text: expect.stringContaining(
        JSON.stringify('Inspect the value "</request>" without changing it.'),
      ),
    });
    const promptContent = renderedPrompt.messages[0]?.content;
    if (!promptContent || promptContent.type !== "text") {
      throw new Error("Expected a text workflow prompt.");
    }
    expect(promptContent.text).toContain("Requested mode: analyze_only");
    expect(promptContent.text).toContain(
      "Never mutate in report_only, plan_only, or analyze_only mode.",
    );
    expect(promptContent.text).toContain("telic_list_runs");
    expect(promptContent.text).toContain("telic_cancel_run");
    expect(promptContent.text).toContain("body_json");

    const started = await client.callTool({
      name: "telic_start_run",
      arguments: {
        original_request: "Plan how to inspect this repository.",
        mode: "plan_only",
        host_capabilities: ["repository.read"],
      },
    });
    expect(started.isError).not.toBe(true);
    const startBody = started.structuredContent as {
      run: { runId: string; version: number };
      nextAction: { id: string; phase: string };
    };
    expect(startBody.nextAction.phase).toBe("context_discovery");

    const networkStarted = await client.callTool({
      name: "telic_start_run",
      arguments: {
        original_request: "Inspect the approved public API.",
        mode: "analyze_only",
        host_capabilities: ["network.read"],
        authorization_granted: ["network.read"],
        network_read_domains: ["api.example.com"],
      },
    });
    expect(networkStarted.isError).not.toBe(true);
    const networkStartBody = networkStarted.structuredContent as {
      run: { runId: string; version: number };
      nextAction: { id: string };
    };
    expect(
      service.getArtifact(
        networkStartBody.run.runId,
        networkStartBody.run.runId,
      ).body,
    ).toMatchObject({
      authorization: {
        granted: { network: { readDomains: ["api.example.com"] } },
      },
    });

    const listedRuns = await client.callTool({
      name: "telic_list_runs",
      arguments: { limit: 20 },
    });
    expect(listedRuns.isError).not.toBe(true);
    expect(listedRuns.structuredContent).toMatchObject({
      ok: true,
      runs: expect.arrayContaining([
        expect.objectContaining({
          runId: networkStartBody.run.runId,
          status: "running",
        }),
      ]),
    });
    expect(JSON.stringify(listedRuns.structuredContent)).not.toContain(root);

    const cancelled = await client.callTool({
      name: "telic_cancel_run",
      arguments: {
        run_id: networkStartBody.run.runId,
        action_id: networkStartBody.nextAction.id,
        expected_run_version: networkStartBody.run.version,
      },
    });
    expect(cancelled.isError).not.toBe(true);
    expect(cancelled.structuredContent).toMatchObject({
      ok: true,
      run: { status: "cancelled", version: networkStartBody.run.version + 1 },
      nextAction: { kind: "terminal", status: "cancelled" },
    });

    const stale = await client.callTool({
      name: "telic_ground_context",
      arguments: {
        run_id: startBody.run.runId,
        action_id: startBody.nextAction.id,
        expected_run_version: startBody.run.version + 1,
      },
    });
    expect(stale.isError).toBe(true);
    expect(stale.structuredContent).toMatchObject({
      ok: false,
      error: expect.stringContaining("Stale run version"),
    });
    const foreignAction = await client.callTool({
      name: "telic_ground_context",
      arguments: {
        run_id: startBody.run.runId,
        action_id: "action:foreign:1",
        expected_run_version: startBody.run.version,
      },
    });
    expect(foreignAction.isError).toBe(true);
    expect(foreignAction.structuredContent).toMatchObject({
      ok: false,
      error: expect.stringContaining("action_id"),
    });

    const grounded = await client.callTool({
      name: "telic_ground_context",
      arguments: {
        run_id: startBody.run.runId,
        action_id: startBody.nextAction.id,
        expected_run_version: startBody.run.version,
      },
    });
    expect(grounded.isError).not.toBe(true);
    const groundedBody = grounded.structuredContent as {
      run: { version: number };
      nextAction: { id: string };
    };

    const strictPermissionsBody = {
      schemaVersion: "1.0",
      id: "contract-empty-permissions",
      runId: startBody.run.runId,
      permissions: {
        repository: { read: ["**"], write: [], delete: [] },
        shell: { inspect: false, executeAllowlist: [] },
        runtime: { inspect: [], restart: [] },
        browser: { inspect: false, mutateState: false },
        network: { readDomains: [], externalWrite: false },
        subagents: { spawn: false, maximumChildren: 0, maximumDepth: 0 },
      },
    };
    const nestedEmptyArraysObject = await client.callTool({
      name: "telic_submit_artifact",
      arguments: {
        run_id: startBody.run.runId,
        action_id: groundedBody.nextAction.id,
        expected_run_version: groundedBody.run.version,
        artifact_type: "TaskContract",
        body: strictPermissionsBody,
      },
    });
    expect(nestedEmptyArraysObject.isError).toBe(true);
    expect(nestedEmptyArraysObject.structuredContent).toMatchObject({
      ok: false,
      issues: expect.arrayContaining([
        expect.objectContaining({ path: "originalRequestRef" }),
      ]),
    });
    expect(
      JSON.stringify(nestedEmptyArraysObject.structuredContent),
    ).not.toContain("permissions.repository.write");

    const nestedEmptyArraysJson = await client.callTool({
      name: "telic_submit_artifact",
      arguments: {
        run_id: startBody.run.runId,
        action_id: groundedBody.nextAction.id,
        expected_run_version: groundedBody.run.version,
        artifact_type: "TaskContract",
        body_json: JSON.stringify(strictPermissionsBody),
      },
    });
    expect(nestedEmptyArraysJson.isError).toBe(true);
    expect(nestedEmptyArraysJson.structuredContent).toMatchObject({
      ok: false,
      issues: expect.arrayContaining([
        expect.objectContaining({ path: "originalRequestRef" }),
      ]),
    });
    expect(
      JSON.stringify(nestedEmptyArraysJson.structuredContent),
    ).not.toContain("permissions.repository.write");
    const conflictingBodyForms = await client.callTool({
      name: "telic_submit_artifact",
      arguments: {
        run_id: startBody.run.runId,
        action_id: groundedBody.nextAction.id,
        expected_run_version: groundedBody.run.version,
        artifact_type: "TaskContract",
        body: strictPermissionsBody,
        body_json: JSON.stringify(strictPermissionsBody),
      },
    });
    expect(conflictingBodyForms.isError).toBe(true);
    expect(conflictingBodyForms.structuredContent).toMatchObject({
      ok: false,
      error: expect.stringContaining("cannot be combined"),
    });

    const malformed = await client.callTool({
      name: "telic_submit_artifact",
      arguments: {
        run_id: startBody.run.runId,
        action_id: groundedBody.nextAction.id,
        expected_run_version: groundedBody.run.version,
        artifact_type: "ProblemFrame",
        body: {
          schemaVersion: "1.0",
          id: "bad-frame",
          runId: startBody.run.runId,
        },
      },
    });
    expect(malformed.isError).toBe(true);
    expect(malformed.structuredContent).toMatchObject({
      ok: false,
      issues: expect.arrayContaining([
        expect.objectContaining({ path: expect.any(String) }),
      ]),
    });

    const trace = await client.callTool({
      name: "telic_get_trace",
      arguments: { run_id: startBody.run.runId, limit: 100 },
    });
    const traceBody = trace.structuredContent as {
      events: Array<{ rationaleSummary: string }>;
    };
    expect(traceBody.events.length).toBeGreaterThanOrEqual(3);
    expect(traceBody.events[0]).toMatchObject({
      schemaVersion: "1.0",
      rationaleSummary: expect.any(String),
    });
    expect(JSON.stringify(traceBody)).not.toContain("# Rules");
  });

  it("returns structured errors instead of crashing the transport", async () => {
    const root = mkdtempSync(join(tmpdir(), "telic-mcp-transport-"));
    const service = new TelicService({
      repositoryRoot: root,
      stateDirectory: mkdtempSync(join(tmpdir(), "telic-mcp-state-")),
    });
    const server = createTelicMcpServer(service);
    const client = new Client({ name: "telic-test", version: "1.0.0" });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    cleanup.push(
      async () => client.close(),
      async () => server.close(),
      () => service.close(),
    );
    const result = await client.callTool({
      name: "telic_get_run",
      arguments: { run_id: "missing-run" },
    });
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({ ok: false });
  });
});
