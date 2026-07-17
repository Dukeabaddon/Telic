import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import { parseContextManifest, parseNextAction } from "@telic/protocol";

import { TelicService } from "./service.js";

const services: TelicService[] = [];

function repository(): string {
  const root = mkdtempSync(join(tmpdir(), "telic-mcp-repo-"));
  mkdirSync(join(root, "src"));
  writeFileSync(
    join(root, "AGENTS.md"),
    "# Rules\nRun tests before reporting completion.\n",
  );
  writeFileSync(
    join(root, "src", "client.ts"),
    "export const apiUrl = '/api/projects';\n",
  );
  writeFileSync(join(root, ".env.local"), "SUPER_SECRET=must-not-leak\n");
  return root;
}

function service(root = repository()): TelicService {
  const created = new TelicService({
    repositoryRoot: root,
    stateDirectory: mkdtempSync(join(tmpdir(), "telic-mcp-state-")),
  });
  services.push(created);
  return created;
}

afterEach(() => {
  for (const active of services.splice(0)) active.close();
});

describe("TelicService integration", () => {
  it("rejects state storage inside the grounded repository", () => {
    const root = repository();
    const nestedState = join(root, "custom-state");
    expect(
      () =>
        new TelicService({
          repositoryRoot: root,
          stateDirectory: nestedState,
        }),
    ).toThrow(/outside the repository/);
    expect(existsSync(nestedState)).toBe(false);
  });

  it("rejects an external state path whose symlinked ancestor resolves into the repository", () => {
    const root = repository();
    const parent = mkdtempSync(join(tmpdir(), "telic-state-parent-"));
    const link = join(parent, "repository-link");
    symlinkSync(root, link, "dir");
    expect(
      () =>
        new TelicService({
          repositoryRoot: root,
          stateDirectory: join(link, "state"),
        }),
    ).toThrow(/outside the repository/);
  });

  it("rejects state storage that contains the grounded repository", () => {
    const parent = mkdtempSync(join(tmpdir(), "telic-state-ancestor-"));
    const root = join(parent, "repository");
    mkdirSync(join(root, "src"), { recursive: true });
    writeFileSync(join(root, "AGENTS.md"), "# Rules\n");
    writeFileSync(join(root, "src", "index.ts"), "export {};\n");

    expect(
      () =>
        new TelicService({
          repositoryRoot: root,
          stateDirectory: parent,
        }),
    ).toThrow(/must not contain it/);
    expect(existsSync(join(parent, "ledger.sqlite3"))).toBe(false);
  });

  it("grounds selected sources once and advances with canonical artifacts", async () => {
    const active = service();
    const started = active.startRun({
      originalRequest:
        "Investigate why the React client cannot retrieve projects.",
      mode: "analyze_only",
      hostCapabilities: ["repository.read", "runtime.inspect"],
      authorizationGranted: ["repository.read", "runtime.inspect"],
    });
    expect(() => parseNextAction(started.nextAction)).not.toThrow();

    const grounded = await active.groundContext({ runId: started.run.runId });
    expect(() => parseContextManifest(grounded.manifest)).not.toThrow();
    expect(
      grounded.manifest.candidates.some((candidate) =>
        candidate.locations.includes(".env.local"),
      ),
    ).toBe(false);
    expect(grounded.nextAction?.phase).toBe("agent_1_frame");

    const contextDocuments = active
      .getRun(started.run.runId)
      .artifacts.filter((artifact) => artifact.type === "ContextDocument");
    expect(contextDocuments.length).toBeGreaterThan(0);
    expect(grounded.manifest.derivedRefs).toHaveLength(contextDocuments.length);
    expect(JSON.stringify(active.getTrace(started.run.runId))).not.toContain(
      "must-not-leak",
    );
    const manifestEvent = active
      .getTrace(started.run.runId)
      .find((event) =>
        event.outputRefs.includes(
          `artifact://${started.run.runId}/${grounded.manifest.id}`,
        ),
      );
    expect(manifestEvent?.inputRefs).toEqual(
      expect.arrayContaining(grounded.manifest.derivedRefs),
    );
  });

  it("lists redacted run summaries and returns a resumable next action", () => {
    const active = service();
    const started = active.startRun({
      originalRequest: "Plan a bounded repository inspection.",
      mode: "plan_only",
      hostCapabilities: ["repository.read"],
      authorizationGranted: ["repository.read"],
    });

    expect(active.listRuns()).toEqual([
      expect.objectContaining({
        runId: started.run.runId,
        status: "running",
        phase: "context_grounding",
      }),
    ]);
    expect(JSON.stringify(active.listRuns())).not.toContain(
      active.repositoryRoot,
    );
    expect(active.getRun(started.run.runId)).toMatchObject({
      nextAction: {
        id: started.nextAction.id,
        kind: "phase",
        phase: "context_discovery",
      },
    });

    expect(() =>
      active.cancelRun(
        started.run.runId,
        started.nextAction.id,
        started.run.version + 1,
      ),
    ).toThrow(/Stale run version/);
    expect(
      active.cancelRun(
        started.run.runId,
        started.nextAction.id,
        started.run.version,
      ),
    ).toMatchObject({
      run: { status: "cancelled" },
      nextAction: { kind: "terminal", status: "cancelled" },
    });
  });

  it("performs no new repository discovery in report-only mode", async () => {
    const active = service();
    const started = active.startRun({
      originalRequest: "Summarize the supplied result only.",
      mode: "report_only",
      hostCapabilities: ["repository.read"],
      authorizationGranted: ["repository.read"],
    });
    const grounded = await active.groundContext({ runId: started.run.runId });
    expect(grounded.manifest.candidates).toEqual([]);
    expect(grounded.manifest.warnings.join(" ")).toContain(
      "skipped new repository discovery",
    );
    if (grounded.nextAction.kind !== "phase") throw new Error("phase expected");
    expect(grounded.nextAction?.effectivePermissions.repository.read).toEqual(
      [],
    );
  });

  it("rejects controller-owned and malformed host artifacts", () => {
    const active = service();
    const started = active.startRun({
      originalRequest: "Inspect this repository.",
      mode: "plan_only",
      hostCapabilities: ["repository.read"],
    });
    expect(() =>
      active.submitArtifact({
        id: "context-1",
        runId: started.run.runId,
        type: "ContextManifest",
        schemaVersion: "1.0",
        producer: "host",
        body: {},
      }),
    ).toThrow(/controller-owned/);
    expect(() =>
      active.submitArtifact({
        id: "frame-1",
        runId: started.run.runId,
        type: "ProblemFrame",
        schemaVersion: "1.0",
        producer: "host",
        body: { id: "frame-1" },
      }),
    ).toThrow();
  });
});
