import type { Metadata } from "next";
import {
  ArrowRight,
  Check,
  ExternalLink,
  GitBranch,
  PackageCheck,
  RefreshCcw,
  TerminalSquare,
} from "lucide-react";

import { InstallTabs } from "@/components/install-tabs";
import { SectionHeading } from "@/components/section-heading";
import { TrackedLink } from "@/components/tracked-link";
import { hosts, siteConfig } from "@/lib/site";

export const metadata: Metadata = {
  title: "Install",
  description:
    "Install Telic for Codex or connect its local MCP workflow to another compatible coding host.",
  alternates: { canonical: "/install" },
};

export default function InstallPage() {
  return (
    <main className="page-main" id="main-content">
      <header className="page-intro shell" data-scroll-reveal-static="">
        <p className="eyebrow">Install Telic</p>
        <h1>Bring the workflow to your coding host.</h1>
        <p>
          Start with the complete Codex plugin, use a source adapter, or connect
          the published local MCP package to a compatible workflow driver.
        </p>
      </header>

      <section className="section-compact shell prerequisites">
        <div className="prerequisite-label">Before you start</div>
        <div className="prerequisite-grid">
          {[
            [TerminalSquare, "Node.js", ">= 24.15.0"],
            [GitBranch, "Git", "Current release"],
            [PackageCheck, "npm", "Included with Node.js"],
          ].map(([Icon, title, detail]) => {
            const RequirementIcon = Icon as typeof TerminalSquare;
            return (
              <div className="prerequisite-card" key={String(title)}>
                <RequirementIcon aria-hidden="true" />
                <div>
                  <strong>{String(title)}</strong>
                  <span>{String(detail)}</span>
                </div>
                <Check aria-hidden="true" />
              </div>
            );
          })}
        </div>
      </section>

      <section className="section shell install-section">
        <SectionHeading
          eyebrow="Choose your setup"
          title="Codex first. Portable by design."
          description="Codex is the reference plugin. Other hosts use experimental source adapters with host-specific configuration."
        />
        <InstallTabs />
      </section>

      <section className="section verify-section section-divider">
        <div className="shell">
          <SectionHeading
            eyebrow="Verify before the first run"
            title="Connected is not the same as activated."
            description="A complete setup needs the local MCP tools and a workflow driver that follows Telic’s next actions."
          />
          <ol className="verify-steps">
            {[
              [
                "Install",
                "Add the plugin or project overlay without overwriting existing host configuration.",
              ],
              [
                "Reload",
                "Restart the coding host or reload its workspace after MCP configuration changes.",
              ],
              [
                "Confirm",
                "Verify that the telic MCP server and its workflow skill or agent are both visible.",
              ],
              [
                "Activate",
                "Start explicitly with Telic: <your request> and state the narrowest mode you need.",
              ],
            ].map(([title, description], index) => (
              <li key={title}>
                <span>{String(index + 1).padStart(2, "0")}</span>
                <div>
                  <h3>{title}</h3>
                  <p>{description}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="section shell compatibility-section">
        <div className="compatibility-card">
          <div>
            <p className="eyebrow">Host packages</p>
            <h2>One protocol, different setup surfaces.</h2>
            <p>
              Telic includes a Codex reference plugin and experimental source
              adapters for the hosts below. Configuration and lifecycle behavior
              remain host-specific.
            </p>
          </div>
          <div className="compatibility-hosts">
            {hosts.map((host, index) => (
              <span key={host}>
                <i>{host.slice(0, 2).toUpperCase()}</i>
                {host}
                <small>{index === 0 ? "Reference" : "Source"}</small>
              </span>
            ))}
          </div>
        </div>
        <div className="install-links">
          <TrackedLink
            className="button button-secondary"
            eventName="docs_clicked"
            href={`${siteConfig.github}/blob/main/docs/INSTALLATION.md`}
            target="_blank"
            rel="noreferrer"
          >
            Full installation reference <ExternalLink aria-hidden="true" />
          </TrackedLink>
          <TrackedLink
            className="button button-secondary"
            eventName="adapter_docs_clicked"
            href={`${siteConfig.github}/blob/main/docs/ADAPTERS.md`}
            target="_blank"
            rel="noreferrer"
          >
            Adapter details <ArrowRight aria-hidden="true" />
          </TrackedLink>
        </div>
      </section>

      <section className="section page-cta-section">
        <div className="shell page-cta">
          <div>
            <p className="eyebrow">Trouble connecting?</p>
            <h2>Check the runtime, skill, and project root.</h2>
          </div>
          <TrackedLink
            className="button button-primary"
            eventName="github_issues_clicked"
            href={siteConfig.issues}
            target="_blank"
            rel="noreferrer"
          >
            Open GitHub Issues <RefreshCcw aria-hidden="true" />
          </TrackedLink>
        </div>
      </section>
    </main>
  );
}
