import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("../", import.meta.url));

function json(path: string): Record<string, any> {
  return JSON.parse(readFileSync(join(root, path), "utf8")) as Record<
    string,
    any
  >;
}

describe("public release assets", () => {
  it("keeps the npm package and Codex plugin on the same release version", () => {
    const npmPackage = json("packages/telic/package.json");
    const plugin = json("plugins/telic/.codex-plugin/plugin.json");
    expect(npmPackage.version).toBe("0.1.1");
    expect(plugin.version).toBe(npmPackage.version);
  });

  it("ships Telic and bundled dependency notices in every runtime distribution", () => {
    const npmPackage = json("packages/telic/package.json");
    expect(npmPackage.files).toEqual(
      expect.arrayContaining(["LICENSE", "THIRD_PARTY_NOTICES.md"]),
    );
    const legalPaths = [
      "packages/telic/LICENSE",
      "packages/telic/THIRD_PARTY_NOTICES.md",
      "plugins/telic/LICENSE",
      "plugins/telic/THIRD_PARTY_NOTICES.md",
    ];
    for (const path of legalPaths) {
      expect(existsSync(join(root, path))).toBe(true);
    }
    expect(readFileSync(join(root, "packages/telic/LICENSE"), "utf8")).toBe(
      readFileSync(join(root, "LICENSE"), "utf8"),
    );
    expect(readFileSync(join(root, "plugins/telic/LICENSE"), "utf8")).toBe(
      readFileSync(join(root, "LICENSE"), "utf8"),
    );
    const notices = readFileSync(
      join(root, "packages/telic/THIRD_PARTY_NOTICES.md"),
      "utf8",
    );
    expect(
      readFileSync(join(root, "plugins/telic/THIRD_PARTY_NOTICES.md"), "utf8"),
    ).toBe(notices);
    for (const dependency of [
      "@modelcontextprotocol/sdk",
      "ajv",
      "ajv-formats",
      "fast-deep-equal",
      "fast-uri",
      "json-schema-traverse",
      "zod",
      "zod-to-json-schema",
    ]) {
      expect(notices).toContain(dependency);
    }
  });
});
