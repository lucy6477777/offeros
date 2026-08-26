import { deduplicatePostings } from "./dedupe";
import { locationEligibilityReason, matchesQuery } from "./normalize";
import {
  jobPostingSchema,
  jobSearchCriteriaSchema,
  type JobSearchContext,
  type JobSearchProvider,
  type JobSearchResult,
  type ProviderIssue,
  type ProviderRun,
  type SearchStageCount,
} from "./types";

/**
 * Run independent providers concurrently and keep every failure visible.
 * One broken board/provider is a failed source, never a failed search run.
 */
export async function searchJobs(
  providers: JobSearchProvider[],
  criteriaInput: unknown,
  context: JobSearchContext = {},
): Promise<JobSearchResult> {
  const criteria = jobSearchCriteriaSchema.parse(criteriaInput);
  const now = context.now ?? Date.now;
  const startedAt = now();
  const settled = await Promise.all(
    providers.map(async (provider): Promise<{ run: ProviderRun; postings: unknown[] }> => {
      const providerStarted = now();
      try {
        const result = await provider.search(criteria, context);
        const status =
          result.issues.length === 0
            ? "success"
            : result.postings.length > 0
              ? "partial"
              : "failed";
        return {
          run: {
            provider: provider.id,
            status,
            received: result.received,
            accepted: result.postings.length,
            rejected: result.rejected,
            durationMs: Math.max(0, now() - providerStarted),
            issues: result.issues,
          },
          postings: result.postings,
        };
      } catch {
        const issue: ProviderIssue = {
          provider: provider.id,
          code: "network",
          message: "provider failed before returning a result",
          retryable: true,
        };
        return {
          run: {
            provider: provider.id,
            status: "failed",
            received: 0,
            accepted: 0,
            rejected: 0,
            durationMs: Math.max(0, now() - providerStarted),
            issues: [issue],
          },
          postings: [],
        };
      }
    }),
  );

  const providerRuns = settled.map((entry) => entry.run);
  const received = providerRuns.reduce((sum, run) => sum + run.received, 0);
  const normalized = settled
    .flatMap((entry) => entry.postings)
    .flatMap((posting) => {
      const parsed = jobPostingSchema.safeParse(posting);
      return parsed.success ? [parsed.data] : [];
    });
  const criteriaMatched = normalized.filter((posting) => matchesQuery(posting, criteria.query));
  const locationReasons: Record<string, number> = {};
  const locationMatched = criteriaMatched.filter((posting) => {
    const reason = locationEligibilityReason(posting, criteria);
    locationReasons[reason] = (locationReasons[reason] ?? 0) + 1;
    return reason === "matched" || reason === "unknown-included";
  });
  const deduplicated = deduplicatePostings(locationMatched).postings;
  const limited = criteria.maxResults ? deduplicated.slice(0, criteria.maxResults) : deduplicated;
  const stages: SearchStageCount[] = [
    {
      stage: "provider-normalization",
      input: received,
      output: normalized.length,
      removed: received - normalized.length,
    },
    {
      stage: "criteria",
      input: normalized.length,
      output: criteriaMatched.length,
      removed: normalized.length - criteriaMatched.length,
    },
    {
      stage: "location-eligibility",
      input: criteriaMatched.length,
      output: locationMatched.length,
      removed: criteriaMatched.length - locationMatched.length,
      reasons: locationReasons,
    },
    {
      stage: "deduplication",
      input: locationMatched.length,
      output: deduplicated.length,
      removed: locationMatched.length - deduplicated.length,
    },
    {
      stage: "limit",
      input: deduplicated.length,
      output: limited.length,
      removed: deduplicated.length - limited.length,
    },
  ];
  return { postings: limited, providerRuns, stages, startedAt, finishedAt: now() };
}
