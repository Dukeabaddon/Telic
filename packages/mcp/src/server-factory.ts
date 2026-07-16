import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod/v4";

import { errorResult, successResult } from "./result.js";
import { TelicService } from "./service.js";

function compactBudget(input: {
  max_files?: number | undefined;
  max_file_bytes?: number | undefined;
  max_total_bytes?: number | undefined;
  max_inventory_files?: number | undefined;
}) {
  return {
    ...(input.max_files === undefined ? {} : { max_files: input.max_files }),
    ...(input.max_file_bytes === undefined
      ? {}
      : { max_file_bytes: input.max_file_bytes }),
    ...(input.max_total_bytes === undefined
      ? {}
      : { max_total_bytes: input.max_total_bytes }),
    ...(input.max_inventory_files === undefined
      ? {}
      : { max_inventory_files: input.max_inventory_files }),
  };
}

const id = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
const referenceUri = z
  .string()
  .min(1)
  .max(2048)
  .regex(/^(artifact|trace|repo):\/\/[A-Za-z0-9._~!$&'()*+,;=:@%/-]+$/);
const mode = z.enum([
  "report_only",
  "plan_only",
  "analyze_only",
  "fix_only",
  "analyze_and_fix",
]);
const capability = z.enum([
  "repository.read",
  "repository.write",
  "repository.delete",
  "shell.inspect",
  "shell.execute",
  "runtime.inspect",
  "runtime.restart",
  "browser.inspect",
  "browser.mutate",
  "network.read",
  "external.write",
  "subagent.spawn",
]);
const artifactType = z.enum([
  "ClarificationRequest",
  "ProblemFrame",
  "ScenarioSpec",
  "TaskContract",
  "PromptReview",
  "WorkPlan",
  "WorkResult",
  "QualityReview",
  "ReleaseAudit",
  "UserReport",
  "Evidence",
]);

const producerByArtifactType: Record<z.infer<typeof artifactType>, string> = {
  ClarificationRequest: "controller",
  ProblemFrame: "scenario_author",
  ScenarioSpec: "scenario_author",
  TaskContract: "task_compiler",
  PromptReview: "scenario_author",
  WorkPlan: "quality_controller",
  WorkResult: "executor",
  QualityReview: "quality_controller",
  ReleaseAudit: "release_auditor",
  UserReport: "release_auditor",
  Evidence: "executor",
};

function registerPrompts(server: McpServer): void {
  server.registerPrompt(
    "telic_workflow",
    {
      title: "Run a Telic workflow",
      description:
        "Drive the host-neutral Telic artifact workflow for one immutable user request.",
      argsSchema: {
        original_request: z
          .string()
          .min(1)
          .max(32_768)
          .describe("The exact user request to preserve as immutable input."),
        mode: mode.describe(
          "The requested authority mode. Missing permission remains denial.",
        ),
      },
    },
    ({ original_request, mode: requestedMode }) => ({
      description:
        "Host-side instructions for driving Telic without a model API in the MCP server.",
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `Drive this request through the Telic MCP workflow.

Exact original request (JSON string):
${JSON.stringify(original_request)}

Requested mode: ${requestedMode}

Workflow contract:
1. Call telic_start_run once. Pass the exact original_request and requested mode. Report the real host name, available capabilities, and only authority the user actually granted. For network.read, pass only explicitly approved exact hostnames in network_read_domains. Never infer missing permission.
2. Follow the returned nextAction. For context_discovery, call telic_ground_context with the current run_id, action_id, and expected_run_version.
3. For each phase action, inspect its bounded inputRefs with telic_get_artifact as needed. Produce exactly its required output type and schema, then call telic_submit_artifact with the current action and run version. Use telic_get_next_action only to refresh the controller state.
4. Do not skip, reorder, or invent phases. Submit optional supporting artifacts only when the current action permits them. Keep evidence and source references attached to claims.
5. Honor effectivePermissions independently for every host-native tool call. Telic validates submitted artifacts but cannot intercept tools used directly by the host. Never mutate in report_only, plan_only, or analyze_only mode.
6. If the controller returns a clarification action, ask exactly that bounded question and submit the selected choice. If it returns a terminal action, retrieve the referenced UserReport and present its evidence-backed result.
7. Expose concise decisions, scores, provenance, and rationale summaries. Never request, reveal, or store hidden chain-of-thought.

The Telic server is a deterministic controller and ledger. It does not call a model. You are responsible for authoring each requested artifact from the supplied schemas and evidence.`,
          },
        },
      ],
    }),
  );
}

function registerTools(server: McpServer, service: TelicService): void {
  server.registerTool(
    "telic_start_run",
    {
      title: "Start Telic run",
      description:
        "Store the immutable request and create a permission-bounded Telic run. This does not call a model.",
      inputSchema: {
        original_request: z.string().min(1).max(32_768),
        mode,
        host_name: z.string().min(1).max(128).default("mcp-host"),
        native_subagents: z
          .enum(["available", "unavailable", "unknown"])
          .default("unknown"),
        host_capabilities: z
          .array(capability)
          .max(256)
          .default(["repository.read"]),
        authorization_granted: z.array(capability).max(256).optional(),
        authorization_denied: z.array(capability).max(256).default([]),
        shell_execute_allowlist: z
          .array(z.string().min(1).max(2_048))
          .max(256)
          .default([]),
        network_read_domains: z
          .array(z.string().min(1).max(253))
          .max(256)
          .default([]),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async (input) => {
      try {
        return successResult({
          ok: true,
          ...service.startRun({
            originalRequest: input.original_request,
            mode: input.mode,
            hostName: input.host_name,
            nativeSubagents: input.native_subagents,
            hostCapabilities: input.host_capabilities,
            ...(input.authorization_granted
              ? { authorizationGranted: input.authorization_granted }
              : {}),
            authorizationDenied: input.authorization_denied,
            shellExecuteAllowlist: input.shell_execute_allowlist,
            networkReadDomains: input.network_read_domains,
          }),
        });
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "telic_ground_context",
    {
      title: "Ground repository context",
      description:
        "Select bounded, secret-aware repository sources, store exact text once, and submit a trace-safe ContextManifest.",
      inputSchema: {
        run_id: id,
        action_id: id,
        expected_run_version: z.number().int().min(1),
        active_paths: z.array(z.string().min(1).max(1024)).max(256).optional(),
        budget: z
          .object({
            max_files: z.number().int().min(1).max(256).optional(),
            max_file_bytes: z
              .number()
              .int()
              .min(1)
              .max(2 * 1024 * 1024)
              .optional(),
            max_total_bytes: z
              .number()
              .int()
              .min(1)
              .max(16 * 1024 * 1024)
              .optional(),
            max_inventory_files: z
              .number()
              .int()
              .min(1)
              .max(100_000)
              .optional(),
          })
          .strict()
          .optional(),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async (input) => {
      try {
        service.assertActionToken(
          input.run_id,
          input.action_id,
          input.expected_run_version,
        );
        return successResult({
          ok: true,
          ...(await service.groundContext({
            runId: input.run_id,
            ...(input.active_paths ? { activePaths: input.active_paths } : {}),
            ...(input.budget ? { budget: compactBudget(input.budget) } : {}),
          })),
        });
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "telic_get_next_action",
    {
      title: "Get next Telic action",
      description:
        "Return the single legal next phase, bounded inputs, output schema, permissions, and budgets.",
      inputSchema: { run_id: id },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ run_id }) => {
      try {
        return successResult({
          ok: true,
          nextAction: service.controller.getNextAction(run_id),
        });
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "telic_submit_artifact",
    {
      title: "Submit Telic phase artifact",
      description:
        "Validate and append one canonical phase artifact, or supply a user clarification response. Exactly one path must be used.",
      inputSchema: {
        run_id: id,
        action_id: id,
        expected_run_version: z.number().int().min(1),
        artifact_type: artifactType.optional(),
        body: z.record(z.string(), z.unknown()).optional(),
        source_refs: z.array(referenceUri).max(256).default([]),
        clarification_response: z.string().min(1).max(32_768).optional(),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async (input) => {
      try {
        service.assertActionToken(
          input.run_id,
          input.action_id,
          input.expected_run_version,
        );
        if (input.clarification_response !== undefined) {
          if (input.artifact_type !== undefined || input.body !== undefined) {
            throw new Error(
              "Clarification response cannot be combined with an artifact submission",
            );
          }
          return successResult({
            ok: true,
            ...service.answerClarification(
              input.run_id,
              input.clarification_response,
            ),
          });
        }
        if (!input.artifact_type || !input.body) {
          throw new Error(
            "artifact_type and body are required for an artifact submission",
          );
        }
        const bodyId = input.body.id;
        const bodyRunId = input.body.runId;
        if (typeof bodyId !== "string" || typeof bodyRunId !== "string") {
          throw new Error(
            "Artifact body must include canonical id and runId fields",
          );
        }
        if (bodyRunId !== input.run_id)
          throw new Error("Artifact body runId does not match run_id");
        const currentAction = service.controller.getNextAction(input.run_id);
        if (currentAction.kind !== "phase") {
          throw new Error("Run is not accepting a phase artifact");
        }
        return successResult({
          ok: true,
          ...service.submitArtifact({
            id: bodyId,
            runId: input.run_id,
            type: input.artifact_type,
            schemaVersion: "1.0",
            producer:
              input.artifact_type === "ClarificationRequest"
                ? currentAction.logicalRole
                : producerByArtifactType[input.artifact_type],
            body: input.body,
            sourceRefs: input.source_refs,
          }),
        });
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "telic_get_run",
    {
      title: "Inspect Telic run",
      description:
        "Return current deterministic state and immutable artifact metadata without source bodies.",
      inputSchema: { run_id: id },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ run_id }) => {
      try {
        return successResult({ ok: true, ...service.getRun(run_id) });
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "telic_get_artifact",
    {
      title: "Read Telic artifact",
      description:
        "Read one immutable artifact and verify its content digest before returning it.",
      inputSchema: { run_id: id, artifact_id: id },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ run_id, artifact_id }) => {
      try {
        return successResult({
          ok: true,
          artifact: service.getArtifact(run_id, artifact_id),
        });
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "telic_get_trace",
    {
      title: "Inspect Telic trace",
      description:
        "Return bounded state-transition summaries, validated artifact lineage, and budgets. Permission decisions appear only when explicitly recorded; hidden chain-of-thought is never returned.",
      inputSchema: {
        run_id: id,
        after_sequence: z.number().int().min(0).default(0),
        limit: z.number().int().min(1).max(500).default(100),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ run_id, after_sequence, limit }) => {
      try {
        const page = service.getTrace(run_id, after_sequence, limit + 1);
        const events = page.slice(0, limit);
        return successResult({
          ok: true,
          events,
          hasMore: page.length > limit,
        });
      } catch (error) {
        return errorResult(error);
      }
    },
  );
}

export function createTelicMcpServer(service: TelicService): McpServer {
  const server = new McpServer({ name: "telic", version: "0.1.1" });
  registerPrompts(server);
  registerTools(server, service);
  return server;
}
