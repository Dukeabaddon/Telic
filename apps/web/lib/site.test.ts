import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  hosts,
  installGuides,
  roles,
  siteConfig,
  workflowStages,
} from "./site.js";

describe("Telic website content", () => {
  it("keeps the public visual system monochrome", () => {
    const files = [
      "apps/web/app/globals.css",
      "apps/web/app/opengraph-image.tsx",
    ];
    const source = files
      .map((file) => readFileSync(resolve(process.cwd(), file), "utf8"))
      .join("\n")
      .toLowerCase();

    expect(source).not.toMatch(/gradient|#63e4ee|#7c83ff|#22d3ee|#5ddb9a/u);
    expect(source).not.toMatch(/99,\s*228,\s*238|124,\s*131,\s*255/u);
    expect(source).toContain("manrope variable");
    expect(source).toContain("ibm plex mono");
    expect(
      readFileSync(resolve(process.cwd(), "apps/web/app/icon.png")).length,
    ).toBeGreaterThan(0);
  });

  it("keeps navigation destinations secure and public", () => {
    expect(siteConfig.github).toBe("https://github.com/Dukeabaddon/Telic");
    expect(siteConfig.npm).toBe("https://www.npmjs.com/package/telic-mcp");
    expect(siteConfig.url).toMatch(/^https:\/\//u);
  });

  it("uses unique ordered workflow and role identifiers", () => {
    expect(new Set(workflowStages.map((stage) => stage.id)).size).toBe(
      workflowStages.length,
    );
    expect(new Set(roles.map((role) => role.id)).size).toBe(roles.length);
    expect(workflowStages).toHaveLength(8);
    expect(roles).toHaveLength(5);
  });

  it("keeps Codex distinct from source adapters", () => {
    expect(hosts[0]).toBe("Codex");
    expect(installGuides[0]).toMatchObject({
      id: "codex",
      status: "Reference plugin",
    });
    expect(
      installGuides
        .filter((guide) => ["kiro", "claude", "cursor"].includes(guide.id))
        .every((guide) => guide.status === "Source adapter"),
    ).toBe(true);
  });

  it("does not present the npm doctor command as complete installation", () => {
    const portable = installGuides.find((guide) => guide.id === "portable");
    expect(portable?.commands).toContain("telic-mcp doctor");
    expect(portable?.technicalFallback).toContain(
      "not a complete host installation",
    );
  });

  it("shows Windows-safe setup for portable MCP and Cursor", () => {
    const portable = installGuides.find((guide) => guide.id === "portable");
    const cursor = installGuides.find((guide) => guide.id === "cursor");
    expect(portable?.windowsCommands).toContain("C:\\\\Users\\\\you");
    expect(cursor?.windowsCommands).toContain("Copy-Item");
  });

  it("keeps every install guide actionable", () => {
    for (const guide of installGuides) {
      expect(guide.commands.trim().length).toBeGreaterThan(20);
      expect(guide.next.trim().length).toBeGreaterThan(20);
    }
  });

  it("uses the current controlled Build Week presentation", () => {
    const source = readFileSync(
      resolve(process.cwd(), "apps/web/components/demo-video.tsx"),
      "utf8",
    );

    expect(source).toContain("telic-build-week-presentation.mp4");
    expect(source).toContain("telic-build-week-presentation-poster.webp");
    expect(source).toContain("controls");
    expect(source).not.toContain("autoPlay");
    expect(source).not.toContain("loop");
  });
});
