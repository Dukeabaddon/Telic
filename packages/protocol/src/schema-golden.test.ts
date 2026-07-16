import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  ArtifactBodySchemas,
  ArtifactEnvelopeSchema,
  ContextManifestWireSchema,
  PromptReviewSchema,
  QualityReviewSchema,
  RunEnvelopeSchema,
  TaskContractSchema,
  WorkPlanSchema,
  normalizeContextManifestWire,
  parseArtifactBody,
  parseArtifactEnvelope,
  safeParseArtifactEnvelope,
} from "./index.js";
import { HASH, VALID_ARTIFACT_BODIES } from "../test/test-helpers.js";

const FIXTURE_DIRECTORY = new URL(
  "../../../test/fixtures/protocol/",
  import.meta.url,
);

function fixture(name: string): unknown {
  return JSON.parse(readFileSync(new URL(name, FIXTURE_DIRECTORY), "utf8"));
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

describe("golden protocol artifacts", () => {
  it("accepts the versioned RunEnvelope fixture", () => {
    expect(
      RunEnvelopeSchema.parse(fixture("valid-run-envelope.json")),
    ).toMatchObject({
      schemaVersion: "1.0",
      runId: "run-01",
      requestedMode: "analyze_only",
    });
  });

  it("accepts the versioned TaskContract fixture", () => {
    expect(
      TaskContractSchema.parse(fixture("valid-task-contract.json")),
    ).toMatchObject({
      schemaVersion: "1.0",
      id: "contract-01",
      intentMode: "analyze_only",
    });
  });

  it("accepts a bounded first prompt revision", () => {
    expect(
      PromptReviewSchema.parse(fixture("valid-prompt-review-revise.json")),
    ).toMatchObject({ decision: "revise", revisionNumber: 0 });
  });

  it("accepts the serial WorkPlan fixture", () => {
    expect(
      WorkPlanSchema.parse(fixture("valid-work-plan-serial.json")),
    ).toMatchObject({ executionMode: "serial" });
  });

  it("rejects an unsupported parallel WorkPlan fixture", () => {
    expect(
      WorkPlanSchema.safeParse(fixture("invalid-work-plan-parallel.json"))
        .success,
    ).toBe(false);
  });

  it("accepts an evidence-gated analyze-and-fix progression", () => {
    expect(
      QualityReviewSchema.parse(
        fixture("valid-quality-review-proceed-to-fix.json"),
      ),
    ).toMatchObject({
      decision: "proceed_to_fix",
      diagnosisGate: {
        status: "supported",
        withinApprovedScope: true,
        permissionsSufficient: true,
      },
    });
  });

  it.each(Object.entries(VALID_ARTIFACT_BODIES))(
    "validates the %s artifact body",
    (artifactType, body) => {
      const schema =
        ArtifactBodySchemas[artifactType as keyof typeof ArtifactBodySchemas];
      expect(schema.safeParse(body).success).toBe(true);
      expect(
        parseArtifactBody(
          artifactType as keyof typeof ArtifactBodySchemas,
          body,
        ),
      ).toEqual(body);
    },
  );

  it("normalizes the context package's strict snake_case wire manifest", () => {
    const wire = {
      schema_version: "1.0",
      id: "context-wire-01",
      run_id: "run-01",
      repository_fingerprint: {
        head_commit: null,
        dirty_worktree_hash: HASH,
      },
      pinned_refs: ["repo://AGENTS.md"],
      selected_sources: [
        {
          ref: "repo://AGENTS.md",
          path: "AGENTS.md",
          reason: "Applicable repository instruction source pinned by policy.",
          content_hash: HASH,
          size_bytes: 120,
          score: 1_000_000,
          pinned: true,
        },
      ],
      derived_refs: [],
      excluded_candidates: [{ reason: "secret_like_file", count: 2 }],
      inventory_source: "git",
      warnings: [],
      budget: {
        max_files: 20,
        max_file_bytes: 65_536,
        max_total_bytes: 131_072,
        max_inventory_files: 5_000,
        candidate_files: 3,
        selected_files: 1,
        selected_bytes: 120,
        estimated_tokens: 30,
      },
    };

    expect(ContextManifestWireSchema.safeParse(wire).success).toBe(true);
    expect(normalizeContextManifestWire(wire)).toMatchObject({
      schemaVersion: "1.0",
      id: "context-wire-01",
      inventorySource: "git",
      excludedCandidateSummaries: [{ reason: "secret_like_file", count: 2 }],
      candidates: [
        {
          decision: "selected",
          ref: "repo://AGENTS.md",
          path: "AGENTS.md",
          pinned: true,
        },
      ],
    });
  });

  it("accepts low-relevance context exclusions", () => {
    expect(
      ContextManifestWireSchema.parse(
        fixture("valid-context-manifest-low-relevance.json"),
      ).excluded_candidates,
    ).toEqual([{ reason: "low_relevance", count: 4 }]);
  });

  it("rejects unknown context exclusion reasons", () => {
    expect(
      ContextManifestWireSchema.safeParse(
        fixture("invalid-context-manifest-exclusion.json"),
      ).success,
    ).toBe(false);
  });

  it("validates a discriminated immutable ArtifactEnvelope", () => {
    const body = VALID_ARTIFACT_BODIES.TaskContract;
    const envelope = {
      schemaVersion: "1.0",
      id: body.id,
      runId: body.runId,
      producer: "task_compiler",
      createdAt: "2026-07-15T10:03:00Z",
      sha256: HASH,
      sourceRefs: [body.problemFrameRef],
      redaction: "none",
      bodyBytes: JSON.stringify(body).length,
      immutable: true,
      artifactType: "TaskContract",
      body,
    };

    expect(ArtifactEnvelopeSchema.safeParse(envelope).success).toBe(true);
    expect(parseArtifactEnvelope(envelope).artifactType).toBe("TaskContract");
    expect(safeParseArtifactEnvelope(envelope).success).toBe(true);
  });

  it("rejects an envelope whose discriminator and body type disagree", () => {
    const body = VALID_ARTIFACT_BODIES.WorkResult;
    const envelope = {
      schemaVersion: "1.0",
      id: body.id,
      runId: body.runId,
      producer: "executor",
      createdAt: "2026-07-15T10:03:00Z",
      sha256: HASH,
      sourceRefs: [],
      redaction: "none",
      bodyBytes: 10,
      immutable: true,
      artifactType: "TaskContract",
      body,
    };

    expect(ArtifactEnvelopeSchema.safeParse(envelope).success).toBe(false);
  });

  it("rejects an envelope whose run or artifact id disagrees with its body", () => {
    const body = VALID_ARTIFACT_BODIES.UserReport;
    const envelope = {
      schemaVersion: "1.0",
      id: "different-id",
      runId: "different-run",
      producer: "release_auditor",
      createdAt: "2026-07-15T10:03:00Z",
      sha256: HASH,
      sourceRefs: [],
      redaction: "none",
      bodyBytes: 10,
      immutable: true,
      artifactType: "UserReport",
      body,
    };

    expect(ArtifactEnvelopeSchema.safeParse(envelope).success).toBe(false);
  });

  it("does not mutate parsed caller input", () => {
    const input = fixture("valid-run-envelope.json");
    const before = clone(input);
    RunEnvelopeSchema.parse(input);
    expect(input).toEqual(before);
  });

  it("rejects a context wire manifest with a false byte total", () => {
    const wire = {
      schema_version: "1.0",
      id: "context-wire-01",
      run_id: "run-01",
      repository_fingerprint: {
        head_commit: null,
        dirty_worktree_hash: HASH,
      },
      pinned_refs: [],
      selected_sources: [
        {
          ref: "repo://a.ts",
          path: "a.ts",
          reason: "Request-relevant source.",
          content_hash: HASH,
          size_bytes: 10,
          score: 1,
          pinned: false,
        },
      ],
      derived_refs: [],
      excluded_candidates: [],
      inventory_source: "git",
      warnings: [],
      budget: {
        max_files: 1,
        max_file_bytes: 100,
        max_total_bytes: 100,
        max_inventory_files: 100,
        candidate_files: 1,
        selected_files: 1,
        selected_bytes: 9,
        estimated_tokens: 3,
      },
    };
    expect(ContextManifestWireSchema.safeParse(wire).success).toBe(false);
  });

  it("rejects the invalid remediation fixture", () => {
    expect(
      QualityReviewSchema.safeParse(
        fixture("invalid-remediation-without-work-order.json"),
      ).success,
    ).toBe(false);
  });

  it("rejects progression without a typed diagnosis gate", () => {
    expect(
      QualityReviewSchema.safeParse(
        fixture("invalid-quality-review-proceed-without-diagnosis-gate.json"),
      ).success,
    ).toBe(false);
  });
});
