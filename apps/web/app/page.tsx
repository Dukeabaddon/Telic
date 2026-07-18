import {
  ArrowRight,
  Check,
  ChevronRight,
  FileSearch,
  Code2,
  GitFork,
  Network,
  Repeat2,
  ShieldCheck,
  Terminal,
} from "lucide-react";

import { DemoFrame } from "@/components/demo-frame";
import { RoleExplorer } from "@/components/role-explorer";
import { SectionHeading } from "@/components/section-heading";
import { TrackedLink } from "@/components/tracked-link";
import { comparisonRows, hosts, proofPoints, siteConfig } from "@/lib/site";

const jsonLd = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: "Telic",
  applicationCategory: "DeveloperApplication",
  operatingSystem: "Linux, macOS",
  description: siteConfig.description,
  url: siteConfig.url,
  downloadUrl: siteConfig.github,
  license: `${siteConfig.github}/blob/main/LICENSE`,
  softwareRequirements: "Node.js 24.15.0 or later",
};

export default function HomePage() {
  return (
    <main className="page-main" id="main-content">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <section className="hero shell">
        <div className="hero-copy">
          <div className="hero-badge">Local MCP workflow · Open source</div>
          <h1>
            The workflow spine for <span>coding agents.</span>
          </h1>
          <p className="hero-lede">
            Turn rough requests into repository-grounded, permission-aware,
            evidence-linked workflows—without adding another model API.
          </p>
          <div className="hero-actions">
            <TrackedLink
              className="button button-primary"
              eventName="install_cta_clicked"
              href="/install"
            >
              Install Telic
              <ArrowRight aria-hidden="true" />
            </TrackedLink>
            <TrackedLink
              className="button button-secondary"
              eventName="github_clicked"
              href={siteConfig.github}
              target="_blank"
              rel="noreferrer"
            >
              <GitFork aria-hidden="true" />
              View on GitHub
            </TrackedLink>
          </div>
          <p className="hero-signature">
            Prompt <i /> Restructure <i /> Evaluate <i /> Act <i /> Verify <i />
            Report
          </p>
        </div>

        <div className="hero-visual" aria-label="Telic workflow preview">
          <div className="hero-console">
            <div className="console-bar">
              <div>
                <span />
                <span />
                <span />
              </div>
              <p>telic / run_7f2a</p>
              <span className="console-mode">ANALYZE_ONLY</span>
            </div>
            <div className="console-prompt">
              <span>&gt;</span>
              <p>
                Every customer gets the same recommendation. Is the ranking
                broken, or is the data biased?
              </p>
            </div>
            <div className="console-flow">
              {[
                [Check, "Repository context", "8 files selected", "done"],
                [Check, "Problem framed", "facts · unknowns · scope", "done"],
                [
                  Check,
                  "Task compiled",
                  "permissions · evidence · done",
                  "done",
                ],
                [FileSearch, "Evidence review", "src/ranking.ts", "active"],
                [
                  ShieldCheck,
                  "Release audit",
                  "waiting for evidence",
                  "waiting",
                ],
              ].map(([Icon, title, detail, state]) => {
                const StepIcon = Icon as typeof Check;
                return (
                  <div
                    className={`console-step console-step-${state}`}
                    key={String(title)}
                  >
                    <StepIcon aria-hidden="true" />
                    <div>
                      <strong>{String(title)}</strong>
                      <span>{String(detail)}</span>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="console-footer">
              <span>Mode locked</span>
              <strong>0 files changed</strong>
            </div>
          </div>
        </div>
      </section>

      <section className="section-compact proof-section section-divider">
        <div className="shell proof-grid">
          {proofPoints.map((point) => (
            <article className="proof-card" key={point.title}>
              <div className="proof-icon">
                <point.icon aria-hidden="true" />
                <span>{point.marker}</span>
              </div>
              <h2>{point.title}</h2>
              <p>{point.description}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="section shell" id="demo-preview">
        <div className="demo-section-heading">
          <SectionHeading
            eyebrow="See the handoffs"
            title={
              <>
                From a vague prompt
                <br />
                to an honest answer.
              </>
            }
            description="Telic turns one rough request into a visible sequence of context, requirements, review, evidence, and reporting."
          />
          <TrackedLink
            className="text-link"
            eventName="how_it_works_clicked"
            href="/how-it-works"
          >
            See how it works
            <ArrowRight aria-hidden="true" />
          </TrackedLink>
        </div>
        <DemoFrame compact />
        <div className="demo-proof-row">
          <span>
            <Terminal aria-hidden="true" /> Uses your coding host
          </span>
          <span>
            <Network aria-hidden="true" /> No Telic cloud
          </span>
          <span>
            <ShieldCheck aria-hidden="true" /> Evidence stays linked
          </span>
        </div>
      </section>

      <section className="section role-section section-divider">
        <div className="shell">
          <SectionHeading
            eyebrow="Five logical roles"
            title="One workflow. Clear responsibilities."
            description="Each handoff has a typed input and output. The roles can run serially through your host’s active model—five responsibilities, not five paid models."
          />
          <RoleExplorer />
        </div>
      </section>

      <section className="section shell comparison-section">
        <SectionHeading
          eyebrow="The difference"
          title="A coding session with a workflow spine."
          description="Telic strengthens high-stakes and ambiguous work without replacing the coding agent you already use."
        />
        <div
          className="comparison-table"
          role="table"
          aria-label="Typical coding agent session compared with Telic"
        >
          <div className="comparison-header" role="row">
            <div role="columnheader">Typical session</div>
            <div role="columnheader">With Telic</div>
          </div>
          {comparisonRows.map(([before, after]) => (
            <div className="comparison-row" role="row" key={before}>
              <div role="cell">
                <ChevronRight aria-hidden="true" />
                <span>{before}</span>
              </div>
              <div role="cell">
                <Check aria-hidden="true" />
                <strong>{after}</strong>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="section feature-section section-divider">
        <div className="shell">
          <SectionHeading
            eyebrow="Local by design"
            title="Control around the model work."
            description="Your coding host performs the semantic work. Telic’s deterministic runtime manages workflow state, artifact validation, and evidence lineage."
          />
          <div className="feature-grid">
            {[
              [
                Code2,
                "Typed handoffs",
                "Every phase creates a strict, inspectable artifact instead of relying on hidden agent memory.",
              ],
              [
                ShieldCheck,
                "Permission boundaries",
                "Requested mode and effective authority stay visible across the workflow.",
              ],
              [
                Repeat2,
                "Bounded quality loops",
                "One revision and one shared remediation strengthen the work without creating an endless loop.",
              ],
              [
                Terminal,
                "Local MCP runtime",
                "A local STDIO server stores workflow state and calls no model API of its own.",
              ],
            ].map(([Icon, title, description]) => {
              const FeatureIcon = Icon as typeof Code2;
              return (
                <article className="feature-card" key={String(title)}>
                  <FeatureIcon aria-hidden="true" />
                  <h3>{String(title)}</h3>
                  <p>{String(description)}</p>
                </article>
              );
            })}
          </div>
        </div>
      </section>

      <section className="section shell hosts-section">
        <div className="hosts-copy">
          <p className="eyebrow">Meet your host where it works</p>
          <h2>One protocol. Host-native entry points.</h2>
          <p>
            Start with the Codex reference plugin, or use the experimental
            source adapters for other coding hosts.
          </p>
          <TrackedLink
            className="text-link"
            eventName="install_cta_clicked"
            href="/install"
          >
            Choose your setup <ArrowRight aria-hidden="true" />
          </TrackedLink>
        </div>
        <div className="host-grid" aria-label="Available host packages">
          {hosts.map((host, index) => (
            <div className="host-card" key={host}>
              <span>{host.slice(0, 2).toUpperCase()}</span>
              <strong>{host}</strong>
              <small>
                {index === 0 ? "Reference plugin" : "Source adapter"}
              </small>
            </div>
          ))}
        </div>
      </section>

      <section className="section final-cta-section">
        <div className="shell">
          <div className="final-cta">
            <div>
              <p className="eyebrow">Start with the request you have</p>
              <h2>Rough prompt in. Evidence-linked workflow out.</h2>
            </div>
            <div className="final-cta-actions">
              <TrackedLink
                className="button button-primary"
                eventName="install_cta_clicked"
                href="/install"
              >
                Install Telic <ArrowRight aria-hidden="true" />
              </TrackedLink>
              <TrackedLink
                className="button button-secondary"
                eventName="github_clicked"
                href={siteConfig.github}
                target="_blank"
                rel="noreferrer"
              >
                <GitFork aria-hidden="true" /> GitHub
              </TrackedLink>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
