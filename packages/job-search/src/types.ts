import { z } from "zod";

export const JOB_SOURCE_KINDS = ["official-ats", "aggregator", "browser", "manual"] as const;
export const JOB_WORKPLACE_TYPES = ["remote", "hybrid", "on-site", "unknown"] as const;
export const JOB_LIVENESS = ["open", "closed", "unknown"] as const;
export const PROVIDER_RUN_STATUSES = ["success", "partial", "failed"] as const;
export const SEARCH_STAGE_NAMES = [
  "provider-normalization",
  "criteria",
  "deduplication",
  "limit",
] as const;

export const jobSourceRecordSchema = z.object({
  provider: z.string().min(1),
  kind: z.enum(JOB_SOURCE_KINDS),
  externalId: z.string().min(1),
  tenant: z.string().min(1).optional(),
  sourceUrl: z.string().url(),
  applyUrl: z.string().url(),
  fetchedAt: z.number().int().nonnegative(),
});

/**
 * One normalized posting, independent of whichever provider found it.
 *
 * Unknown data stays absent or explicitly `unknown`; a provider is never
 * allowed to turn a missing country, workplace type, or timestamp into a
 * confident value just to make filtering easier.
 */
export const jobPostingSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  company: z.string().min(1),
  location: z.string().min(1).optional(),
  countryCode: z.string().length(2).optional(),
  workplace: z.enum(JOB_WORKPLACE_TYPES),
  employmentType: z.string().min(1).optional(),
  department: z.string().min(1).optional(),
  description: z.string().min(1).optional(),
  salary: z.string().min(1).optional(),
  postedAt: z.string().datetime({ offset: true }).optional(),
  updatedAt: z.string().datetime({ offset: true }).optional(),
  applyUrl: z.string().url(),
  liveness: z.enum(JOB_LIVENESS),
  sources: z.array(jobSourceRecordSchema).min(1),
});

export const jobSearchCriteriaSchema = z.object({
  /** Local full-text match over title, company, location, and description. */
  query: z.string().trim().min(1).optional(),
  maxResults: z.number().int().min(1).max(5_000).optional(),
});

export type JobSourceKind = (typeof JOB_SOURCE_KINDS)[number];
export type JobWorkplaceType = (typeof JOB_WORKPLACE_TYPES)[number];
export type JobLiveness = (typeof JOB_LIVENESS)[number];
export type JobSourceRecord = z.infer<typeof jobSourceRecordSchema>;
export type JobPosting = z.infer<typeof jobPostingSchema>;
export type JobSearchCriteria = z.infer<typeof jobSearchCriteriaSchema>;

export const providerIssueSchema = z.object({
  provider: z.string().min(1),
  /** Board/site name, when one tenant failed but the provider stayed alive. */
  scope: z.string().min(1).optional(),
  code: z.enum(["network", "http", "invalid-json", "response-too-large", "invalid-payload"]),
  message: z.string().min(1),
  retryable: z.boolean(),
});

export type ProviderIssue = z.infer<typeof providerIssueSchema>;

export interface ProviderSearchResult {
  postings: JobPosting[];
  /** Raw job objects seen before validation. */
  received: number;
  /** Raw objects deliberately rejected during normalization. */
  rejected: number;
  issues: ProviderIssue[];
}

export interface JobSearchContext {
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
  now?: () => number;
}

export interface JobSearchProvider {
  id: string;
  kind: JobSourceKind;
  search(criteria: JobSearchCriteria, context?: JobSearchContext): Promise<ProviderSearchResult>;
}

export const providerRunSchema = z.object({
  provider: z.string().min(1),
  status: z.enum(PROVIDER_RUN_STATUSES),
  received: z.number().int().nonnegative(),
  accepted: z.number().int().nonnegative(),
  rejected: z.number().int().nonnegative(),
  durationMs: z.number().int().nonnegative(),
  issues: z.array(providerIssueSchema),
});

export const searchStageCountSchema = z.object({
  stage: z.enum(SEARCH_STAGE_NAMES),
  input: z.number().int().nonnegative(),
  output: z.number().int().nonnegative(),
  removed: z.number().int().nonnegative(),
});

export const jobSearchResultSchema = z.object({
  postings: z.array(jobPostingSchema),
  providerRuns: z.array(providerRunSchema),
  stages: z.array(searchStageCountSchema),
  startedAt: z.number().int().nonnegative(),
  finishedAt: z.number().int().nonnegative(),
});

export type ProviderRunStatus = (typeof PROVIDER_RUN_STATUSES)[number];
export type ProviderRun = z.infer<typeof providerRunSchema>;
export type SearchStageCount = z.infer<typeof searchStageCountSchema>;
export type JobSearchResult = z.infer<typeof jobSearchResultSchema>;
