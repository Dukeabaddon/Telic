import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { runCli, supportsRequiredNodeVersion } from "./index.js";

function capture() {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    stdout,
    stderr,
    io: {
      stdout: (line: string) => stdout.push(line),
      stderr: (line: string) => stderr.push(line),
    },
  };
}

describe("Telic CLI", () => {
  it("uses the same complete Node minimum as package metadata", () => {
    expect(supportsRequiredNodeVersion("24.14.9")).toBe(false);
    expect(supportsRequiredNodeVersion("24.15.0")).toBe(true);
    expect(supportsRequiredNodeVersion("24.15.1")).toBe(true);
    expect(supportsRequiredNodeVersion("25.0.0")).toBe(true);
    expect(supportsRequiredNodeVersion("not-a-version")).toBe(false);
  });

  it("reports local prerequisites without creating a ledger", async () => {
    const repository = mkdtempSync(join(tmpdir(), "telic-cli-"));
    const output = capture();
    expect(
      await runCli(["doctor", "--repo", repository, "--json"], output.io),
    ).toBe(0);
    expect(JSON.parse(output.stdout[0] ?? "{}")).toMatchObject({ ok: true });
    expect(output.stderr).toEqual([]);
  });

  it("fails honestly when a requested ledger does not exist", async () => {
    const repository = mkdtempSync(join(tmpdir(), "telic-cli-"));
    const output = capture();
    expect(
      await runCli(["status", "missing-run", "--repo", repository], output.io),
    ).toBe(1);
    expect(output.stderr.join(" ")).toContain("No Telic ledger exists");
  });

  it("renders help", async () => {
    const output = capture();
    expect(await runCli(["--help"], output.io)).toBe(0);
    expect(output.stdout.join("\n")).toContain("telic doctor");
  });
});
