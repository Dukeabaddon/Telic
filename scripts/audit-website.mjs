#!/usr/bin/env node

import { createRequire } from "node:module";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { chromium } from "playwright-core";

const require = createRequire(import.meta.url);
const axePath = require.resolve("axe-core/axe.min.js");
const baseUrl = process.env.SITE_BASE_URL ?? "http://127.0.0.1:3000";
const browserCandidates = [
  process.env.SITE_BROWSER_PATH,
  "/usr/bin/brave",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
].filter(Boolean);
const executablePath = browserCandidates.find((candidate) =>
  existsSync(candidate),
);

if (!executablePath) {
  throw new Error(
    "No Chromium-compatible browser found. Set SITE_BROWSER_PATH to a local browser executable.",
  );
}

const routes = ["/", "/how-it-works", "/install"];
const viewports = [
  { name: "mobile-320", width: 320, height: 568 },
  { name: "mobile-390", width: 390, height: 844 },
  { name: "tablet-768", width: 768, height: 1024 },
  { name: "desktop-1440", width: 1440, height: 900 },
];
const screenshotDirectory = mkdtempSync(join(tmpdir(), "telic-site-audit-"));
const browser = await chromium.launch({
  executablePath,
  headless: true,
  args: ["--no-sandbox"],
});

const failures = [];
const results = [];

try {
  for (const viewport of viewports) {
    const context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
      colorScheme: "dark",
      reducedMotion: "reduce",
    });
    const page = await context.newPage();

    for (const route of routes) {
      const response = await page.goto(`${baseUrl}${route}`, {
        waitUntil: "networkidle",
      });
      const status = response?.status() ?? 0;
      const metrics = await page.evaluate(() => ({
        documentWidth: document.documentElement.scrollWidth,
        viewportWidth: document.documentElement.clientWidth,
        h1Count: document.querySelectorAll("h1").length,
        title: document.title,
        gradientCount: [...document.querySelectorAll("*")].filter(
          (element) => getComputedStyle(element).backgroundImage !== "none",
        ).length,
      }));

      if (status !== 200)
        failures.push(`${viewport.name} ${route}: HTTP ${status}`);
      if (metrics.documentWidth > metrics.viewportWidth + 1) {
        failures.push(
          `${viewport.name} ${route}: horizontal overflow ${metrics.documentWidth}px > ${metrics.viewportWidth}px`,
        );
      }
      if (metrics.h1Count !== 1) {
        failures.push(
          `${viewport.name} ${route}: expected one h1, found ${metrics.h1Count}`,
        );
      }
      if (!metrics.title.includes("Telic")) {
        failures.push(
          `${viewport.name} ${route}: title does not identify Telic`,
        );
      }
      if (metrics.gradientCount > 0) {
        failures.push(
          `${viewport.name} ${route}: found ${metrics.gradientCount} rendered background gradients`,
        );
      }

      await page.addScriptTag({ path: axePath });
      const axe = await page.evaluate(async () => {
        const outcome = await globalThis.axe.run(document, {
          resultTypes: ["violations"],
        });
        return outcome.violations
          .filter((violation) =>
            ["critical", "serious"].includes(violation.impact),
          )
          .map((violation) => ({
            id: violation.id,
            impact: violation.impact,
            nodes: violation.nodes.length,
            targets: violation.nodes.slice(0, 8).map((node) => ({
              target: node.target.join(" "),
              summary: node.failureSummary,
            })),
          }));
      });
      if (axe.length > 0) {
        failures.push(`${viewport.name} ${route}: axe ${JSON.stringify(axe)}`);
      }

      results.push({ viewport: viewport.name, route, status, ...metrics, axe });
    }

    if (viewport.width <= 390) {
      await page.goto(baseUrl, { waitUntil: "networkidle" });
      const trigger = page.locator(".menu-trigger");
      await trigger.click();
      if ((await trigger.getAttribute("aria-expanded")) !== "true") {
        failures.push(`${viewport.name}: mobile menu did not open`);
      }
      await page.keyboard.press("Escape");
      if ((await trigger.getAttribute("aria-expanded")) !== "false") {
        failures.push(`${viewport.name}: Escape did not close mobile menu`);
      }
    }

    if (viewport.name === "mobile-390" || viewport.name === "desktop-1440") {
      await page.goto(baseUrl, { waitUntil: "networkidle" });
      await page.screenshot({
        fullPage: true,
        path: join(screenshotDirectory, `${viewport.name}-home.png`),
      });
      await page.goto(`${baseUrl}/install`, { waitUntil: "networkidle" });
      await page.screenshot({
        fullPage: true,
        path: join(screenshotDirectory, `${viewport.name}-install.png`),
      });
    }

    await context.close();
  }

  const interactionContext = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    permissions: ["clipboard-read", "clipboard-write"],
  });
  const interactionPage = await interactionContext.newPage();
  await interactionPage.goto(`${baseUrl}/how-it-works`, {
    waitUntil: "networkidle",
  });
  const firstWorkflowTab = interactionPage.locator(".workflow-tab").first();
  await firstWorkflowTab.focus();
  await interactionPage.keyboard.press("ArrowRight");
  if (
    (await interactionPage
      .locator('.workflow-tab[aria-selected="true"]')
      .count()) !== 1
  ) {
    failures.push("workflow explorer did not maintain one selected tab");
  }
  await interactionPage.goto(`${baseUrl}/install`, {
    waitUntil: "networkidle",
  });
  const firstInstallTab = interactionPage
    .locator(".install-tablist button")
    .first();
  await firstInstallTab.focus();
  await interactionPage.keyboard.press("End");
  const selectedInstall = await interactionPage
    .locator('.install-tablist button[aria-selected="true"]')
    .textContent();
  if (selectedInstall?.trim() !== "Portable MCP") {
    failures.push("install tabs did not support the End key");
  }
  const copyButton = interactionPage.locator(".copy-button");
  await copyButton.click();
  await interactionPage.waitForFunction(
    () =>
      document.querySelector(".copy-button")?.textContent?.includes("Copied"),
    undefined,
    { timeout: 1_000 },
  );
  if (!(await copyButton.textContent())?.includes("Copied")) {
    failures.push("install copy button did not show confirmation");
  }
  await interactionContext.close();
} finally {
  await browser.close();
}

console.log(
  JSON.stringify(
    {
      ok: failures.length === 0,
      browser: executablePath,
      screenshots: screenshotDirectory,
      checks: results.length,
      failures,
    },
    null,
    2,
  ),
);

if (failures.length > 0) process.exitCode = 1;
