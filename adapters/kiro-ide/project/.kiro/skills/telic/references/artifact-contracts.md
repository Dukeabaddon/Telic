# Artifact contracts

Use these minimum contracts when a Telic next action requests a semantic artifact. Preserve the controller-supplied identifiers, schema version, input references, permissions, and budgets. Do not invent project facts to populate a field.

## Common rules

- Keep the original request immutable and reference it from every fidelity review.
- Store a changed artifact as a new version with source references; never mutate the previous record.
- Attach provenance to facts and evidence references to observations, actions, test results, and completion claims.
- Separate observations from inferences and unknowns.
- Use stable IDs for artifacts, criteria, findings, plan nodes, and evidence.
- Return explicit empty arrays for reviewed-but-empty collections when the schema requires them.
- Never add hidden reasoning fields. Use a short `rationaleSummary` or `decisionSummary`, as required by the runtime schema, linked to evidence.

## Phase contracts

| Phase and role  | Required output | Minimum content                                                                                                                                                                                                              | Decisive gate                                                                       |
| --------------- | --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Agent 1 frame   | `ProblemFrame`  | Original request ref, intent mode, grounded goal, facts with provenance, inferences, unknowns, included/excluded scope, constraints, non-goals, rules, draft acceptance criteria, clarification status                       | No invented fact or silent intent/mode change                                       |
| Agent 2 compile | `TaskContract`  | Frame and request refs, version, objective, mode, scope, constraints, non-goals, context/rule refs, permissions, acceptance criteria with required evidence, outputs, verification, stops, assumptions, unresolved questions | No permission expansion; every required criterion has an evidence path              |
| Agent 1 review  | `PromptReview`  | Target and rubric refs, revision number, source coverage, dimension scores, hard gates, evidence-linked findings, smallest correction, decision                                                                              | Hard gates override score; only one contract revision                               |
| Agent 3 plan    | `WorkPlan`      | Contract ref, serial execution mode, DAG nodes, dependencies, inputs/context, tools, permissions, output types, criteria, stops, per-node and global budgets, validation status                                              | Node permissions never exceed contract; required capabilities have fallback or stop |
| Agent 4 execute | `WorkResult`    | Plan/node refs, status, observations, inferences, actions, changed files, tool events, evidence, tests, criterion coverage, issues, deviations                                                                               | Executor does not grant final acceptance                                            |
| Agent 3 review  | `QualityReview` | Contract/result refs, frozen rubric, per-criterion status and evidence, rule/regression checks, findings, hard gates, score, decision, optional smallest remediation order                                                   | Failed/unverified required criterion or permission breach cannot pass               |
| Agent 5 audit   | `ReleaseAudit`  | Original request, contract, result and quality refs, fidelity checks, mode compliance, claim-evidence matrix, risks, findings, decision, report ref                                                                          | Read-only audit; use the same shared remediation budget                             |
| Release         | `UserReport`    | Run ID, honest terminal status, summary, finding/change/verification refs, risks, permission status, next actions, trace ref                                                                                                 | Every completion claim resolves to contract and evidence                            |

`ScenarioSpec` is optional. Derive it from the `ProblemFrame` only when a human-readable story helps the task. Include its frame reference and source map; do not let it become the source of truth or add scope.

## Controller artifacts

- Let `RunEnvelope` preserve the request reference, working context, actual host capabilities, authorization, policy references, and initial budgets.
- Let `ContextManifest` pin sources, hashes, selection reasons, exclusions, repository fingerprint, and size estimates. Link every derived summary to exact source refs.
- Read `NextAction` as the only legal phase transition. Obey its required output, `requiredOutputSchema`, input refs, effective permission ceiling, remaining budgets, and stop conditions.
- Use `ClarificationRequest` only after proportional discovery cannot resolve a materially divergent user-owned choice or a required permission expansion. Record the inspected evidence and blocked boundary.
- Let `TraceEvent` expose transitions, artifact refs, tools, redacted results, permission decisions, budget snapshots, and concise decision summaries without hidden reasoning.

## Evidence statuses

Resolve every required acceptance criterion to exactly one status:

- `pass`: direct evidence demonstrates the requirement.
- `fail`: direct evidence demonstrates it is not satisfied.
- `unverified`: required evidence could not be obtained; state why.
- `not_applicable`: the approved contract makes the criterion irrelevant; cite that basis.

Treat confidence as metadata, never proof. Mark repository and runtime claims as `observed`, `inferred`, `user_reported`, or `unverified` and attach the appropriate sources.

## Budget ownership

- Initialize `prompt_revisions` to one unless the controller supplies a narrower budget.
- Consume it only when Agent 1 requests the single Agent 2 correction.
- Initialize `post_execution_remediations` to one unless narrower.
- Consume the shared remediation when either QualityReview or ReleaseAudit requests corrective execution.
- Do not reset either counter for native subagents, serial fallback, compaction, or transport recovery.

When a budget is exhausted, select `partial`, `blocked`, or `failed_verification` and identify the remaining failed criterion or permission boundary.
