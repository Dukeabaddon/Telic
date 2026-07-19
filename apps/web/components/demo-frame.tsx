import { Check, FileSearch, ShieldCheck } from "lucide-react";

export function DemoFrame({ compact = false }: { readonly compact?: boolean }) {
  return (
    <div className={`demo-frame${compact ? " demo-frame-compact" : ""}`}>
      <div className="demo-chrome">
        <span />
        <span />
        <span />
        <p>Telic · recommendation-bias · analyze_only</p>
        <span className="demo-placeholder-badge">Guided preview</span>
      </div>
      <div className="demo-body">
        <aside
          className="demo-sidebar"
          aria-label="Workflow progress"
          tabIndex={0}
        >
          {[
            [Check, "Context", "complete"],
            [Check, "Problem frame", "complete"],
            [Check, "Task contract", "complete"],
            [FileSearch, "Evidence review", "active"],
            [ShieldCheck, "Report", "pending"],
          ].map(([Icon, label, state]) => {
            const StageIcon = Icon as typeof Check;
            return (
              <div
                className={`demo-stage demo-stage-${state}`}
                key={String(label)}
              >
                <StageIcon aria-hidden="true" />
                <span>{String(label)}</span>
              </div>
            );
          })}
        </aside>
        <div className="demo-main">
          <div className="demo-prompt">
            <span>User request</span>
            <p>
              Telic: Is the profession recommendation algorithm flawed, and are
              the school recommendations appropriate for each profession?
              Analyze only. Do not change files.
            </p>
          </div>
          <div className="demo-evidence-card">
            <div className="demo-evidence-heading">
              <FileSearch aria-hidden="true" />
              <div>
                <span>Repository evidence</span>
                <strong>src/ranking.ts</strong>
              </div>
              <span className="status-chip status-chip-success">Inspected</span>
            </div>
            <pre aria-label="Example ranking code" tabIndex={0}>
              <code>
                <span>return</span> schools.length === 0 ? [] : [schools[0]];
              </code>
            </pre>
          </div>
          <div className="demo-result-row">
            <div>
              <span>Mode</span>
              <strong>analyze_only</strong>
            </div>
            <div>
              <span>Files changed</span>
              <strong>0</strong>
            </div>
            <div>
              <span>Runtime claim</span>
              <strong>Unverified</strong>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
