import { z } from "zod";

import { RunTopologySchema } from "./common.js";

export { RunTopologySchema };
export type { RunTopology } from "./common.js";

export const ClassifyRunSignalSchema = z.enum([
  "OVERRIDE_MICRO",
  "OVERRIDE_STANDARD",
  "OVERRIDE_FORENSIC",
  "ANALYZE_AND_FIX",
  "ELEVATED_CAPABILITY",
  "NETWORK_READ",
  "SHELL_EXECUTE_ALLOWLIST",
  "LONG_REQUEST",
  "COMPLEXITY_KEYWORD",
  "INVESTIGATIVE_MODE",
  "PLAN_ONLY",
  "FIX_ONLY",
  "MICRO_SHORT_REPORT_ONLY",
  "MICRO_SHORT_FIX_ONLY",
  "DEFAULT_STANDARD",
]);

export const ClassifyRunResultSchema = z
  .object({
    topology: RunTopologySchema,
    rationaleCode: z.string().min(1).max(128),
    signals: z.array(ClassifyRunSignalSchema).max(32),
  })
  .strict();

export type ClassifyRunSignal = z.infer<typeof ClassifyRunSignalSchema>;
export type ClassifyRunResult = z.infer<typeof ClassifyRunResultSchema>;

export const EscalationReasonCodeSchema = z.enum([
  "MICRO_SPOT_REMEDIATE",
  "MICRO_SPOT_PARTIAL",
  "MICRO_USER_REPORTED",
  "STANDARD_USER_REPORTED_CLAIMS",
  "STANDARD_EVIDENCE_STRESS",
]);

export type EscalationReasonCode = z.infer<typeof EscalationReasonCodeSchema>;
