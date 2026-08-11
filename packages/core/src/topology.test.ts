import { describe, expect, it } from "vitest";

import {
  FORENSIC_PHASES,
  MICRO_PHASES,
  STANDARD_PHASES,
  phasesForTopology,
} from "./topology.js";

describe("topology phases", () => {
  it("forensic includes evidence reverify after quality review", () => {
    expect(phasesForTopology("forensic").length).toBeGreaterThan(
      phasesForTopology("standard").length,
    );
    const forensic = [...FORENSIC_PHASES];
    const standard = [...STANDARD_PHASES];
    expect(forensic.indexOf("agent_3_evidence_reverify")).toBeGreaterThan(
      forensic.indexOf("agent_3_review"),
    );
    expect(forensic.includes("agent_3_evidence_reverify")).toBe(true);
    expect(
      standard.includes(
        "agent_3_evidence_reverify" as (typeof standard)[number],
      ),
    ).toBe(false);
    expect(
      (MICRO_PHASES as readonly string[]).includes("agent_3_evidence_reverify"),
    ).toBe(false);
  });
});
