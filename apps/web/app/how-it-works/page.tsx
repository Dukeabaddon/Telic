import type { Metadata } from "next";
import {
  ArrowRight,
  Braces,
  FileCheck2,
  FileSearch,
  Fingerprint,
  LockKeyhole,
  Route,
  ShieldCheck,
} from "lucide-react";

import { DemoVideo } from "@/components/demo-video";
import { RoleExplorer } from "@/components/role-explorer";
import { SectionHeading } from "@/components/section-heading";
import { TrackedLink } from "@/components/tracked-link";
import { WorkflowExplorer } from "@/components/workflow-explorer";

export const metadata: Metadata = {
  title: "How it works",
  description:
    "See how Telic turns rough coding requests into repository-grounded contracts, bounded work, and evidence-linked reports.",
  alternates: { canonical: "/how-it-works" },
};

export default function HowItWorksPage() {
  return (
    <main className="page-main" id="main-content">
      <header className="page-intro shell page-intro-with-media">
        <p className="eyebrow">Inside the workflow</p>
        <h1>Structure around the model work.</h1>
        <p>
          Your coding host still reasons and acts. Telic gives that work a
          deterministic sequence of context, contracts, permissions, evidence,
          and review.
        </p>
      </header>

      <section
        className="section-compact shell walkthrough-section"
        aria-label="Product walkthrough"
        data-scroll-reveal-static=""
      >
        <DemoVideo />
      </section>

      <section className="section shell workflow-lead-section">
        <SectionHeading
          eyebrow="The workflow spine"
          title="One sequence. Eight inspectable stages."
          description="Each stage has a typed input and output. Telic moves from a rough prompt through context, contracts, action, verification, and an honest report—without expanding authority on its own."
        />
      </section>

      <section className="section-compact shell workflow-explorer-section">
        <WorkflowExplorer />
      </section>

      <section className="section artifact-section section-divider">
        <div className="shell">
          <SectionHeading
            eyebrow="Inspectable handoffs"
            title="Each stage leaves an artifact."
            description="The next role receives references to bounded inputs instead of relying on an invisible conversation between agents."
          />
          <div className="artifact-chain" aria-label="Telic artifact chain">
            {[
              [
                FileSearch,
                "Context manifest",
                "Selected repository sources and provenance",
              ],
              [
                Fingerprint,
                "Problem frame",
                "Facts, unknowns, scope, and risks",
              ],
              [
                Braces,
                "Task contract",
                "Permissions, evidence, and done conditions",
              ],
              [Route, "Work plan", "Ordered actions and stop conditions"],
              [
                FileCheck2,
                "Evidence",
                "Observable repository or runtime results",
              ],
              [
                ShieldCheck,
                "User report",
                "Audited claims and unresolved risk",
              ],
            ].map(([Icon, title, description], index) => {
              const ArtifactIcon = Icon as typeof FileSearch;
              return (
                <article className="artifact-card" key={String(title)}>
                  <div>
                    <ArtifactIcon aria-hidden="true" />
                    <span>{String(index + 1).padStart(2, "0")}</span>
                  </div>
                  <h2>{String(title)}</h2>
                  <p>{String(description)}</p>
                </article>
              );
            })}
          </div>
        </div>
      </section>

      <section className="section shell authority-section">
        <div className="authority-copy">
          <p className="eyebrow">Authority stays visible</p>
          <h2>The requested mode follows every handoff.</h2>
          <p>
            Telic validates its own artifacts against the active mode and
            permission contract. Native host actions still remain subject to the
            host’s sandbox and user approvals.
          </p>
          <div className="authority-rule">
            <LockKeyhole aria-hidden="true" />
            <strong>Missing permission is denial.</strong>
          </div>
        </div>
        <div className="mode-list">
          {[
            ["report_only", "Explain supplied facts or existing results"],
            ["plan_only", "Create a plan without executing it"],
            ["analyze_only", "Investigate without changing files or runtime"],
            ["fix_only", "Apply a known correction inside approved scope"],
            ["analyze_and_fix", "Diagnose, gate, then fix an evidenced cause"],
          ].map(([mode, description]) => (
            <div className="mode-row" key={mode}>
              <code>{mode}</code>
              <span>{description}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="section role-section section-divider">
        <div className="shell">
          <SectionHeading
            eyebrow="Five logical roles"
            title="Clear ownership at every gate."
            description="Roles are responsibilities with strict inputs and outputs. The same host model can perform them serially."
          />
          <RoleExplorer />
        </div>
      </section>

      <section className="section page-cta-section">
        <div className="shell page-cta">
          <div>
            <p className="eyebrow">Ready to try the flow?</p>
            <h2>Choose your coding host.</h2>
          </div>
          <TrackedLink
            className="button button-primary"
            eventName="install_cta_clicked"
            href="/install"
          >
            Open installation guide <ArrowRight aria-hidden="true" />
          </TrackedLink>
        </div>
      </section>
    </main>
  );
}
