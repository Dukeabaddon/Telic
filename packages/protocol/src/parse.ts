import type { z } from "zod";

import {
  ClarificationRequestSchema,
  ContextCandidateSchema,
  ContextManifestSchema,
  NextActionSchema,
  RunEnvelopeSchema,
} from "./controller.js";
import { TraceEventSchema } from "./trace.js";
import { EvidenceArtifactSchema } from "./evidence.js";
import {
  ProblemFrameSchema,
  PromptReviewSchema,
  ScenarioSpecSchema,
  TaskContractSchema,
} from "./workflow-intent.js";
import {
  QualityReviewSchema,
  WorkPlanSchema,
  WorkResultSchema,
} from "./workflow-execution.js";
import {
  ReceiptAuditSchema,
  ReleaseAuditSchema,
  UserReportSchema,
} from "./workflow-release.js";

function parserFor<Schema extends z.ZodType>(schema: Schema) {
  return (input: unknown): z.infer<Schema> => schema.parse(input);
}

function safeParserFor<Schema extends z.ZodType>(schema: Schema) {
  return (input: unknown) => schema.safeParse(input);
}

export const parseRunEnvelope = parserFor(RunEnvelopeSchema);
export const parseContextCandidate = parserFor(ContextCandidateSchema);
export const parseContextManifest = parserFor(ContextManifestSchema);
export const parseNextAction = parserFor(NextActionSchema);
export const parseClarificationRequest = parserFor(ClarificationRequestSchema);
export const parseProblemFrame = parserFor(ProblemFrameSchema);
export const parseScenarioSpec = parserFor(ScenarioSpecSchema);
export const parseTaskContract = parserFor(TaskContractSchema);
export const parsePromptReview = parserFor(PromptReviewSchema);
export const parseWorkPlan = parserFor(WorkPlanSchema);
export const parseWorkResult = parserFor(WorkResultSchema);
export const parseQualityReview = parserFor(QualityReviewSchema);
export const parseReleaseAudit = parserFor(ReleaseAuditSchema);
export const parseReceiptAudit = parserFor(ReceiptAuditSchema);
export const parseUserReport = parserFor(UserReportSchema);
export const parseTraceEvent = parserFor(TraceEventSchema);
export const parseEvidenceArtifact = parserFor(EvidenceArtifactSchema);

export const safeParseRunEnvelope = safeParserFor(RunEnvelopeSchema);
export const safeParseContextCandidate = safeParserFor(ContextCandidateSchema);
export const safeParseContextManifest = safeParserFor(ContextManifestSchema);
export const safeParseNextAction = safeParserFor(NextActionSchema);
export const safeParseClarificationRequest = safeParserFor(
  ClarificationRequestSchema,
);
export const safeParseProblemFrame = safeParserFor(ProblemFrameSchema);
export const safeParseScenarioSpec = safeParserFor(ScenarioSpecSchema);
export const safeParseTaskContract = safeParserFor(TaskContractSchema);
export const safeParsePromptReview = safeParserFor(PromptReviewSchema);
export const safeParseWorkPlan = safeParserFor(WorkPlanSchema);
export const safeParseWorkResult = safeParserFor(WorkResultSchema);
export const safeParseQualityReview = safeParserFor(QualityReviewSchema);
export const safeParseReleaseAudit = safeParserFor(ReleaseAuditSchema);
export const safeParseUserReport = safeParserFor(UserReportSchema);
export const safeParseTraceEvent = safeParserFor(TraceEventSchema);
export const safeParseEvidenceArtifact = safeParserFor(EvidenceArtifactSchema);
