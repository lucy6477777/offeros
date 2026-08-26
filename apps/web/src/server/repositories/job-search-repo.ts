import { desc, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import {
  deduplicatePostings,
  jobPostingSchema,
  jobSearchCriteriaSchema,
  jobSearchResultSchema,
  matchesLocationCriteria,
  matchesQuery,
  normalizePostingUrl,
  providerRunSchema,
  searchStageCountSchema,
  type JobPosting,
  type JobSearchCriteria,
  type JobSearchResult,
  type JobSourceRecord,
  type ProviderIssue,
  type ProviderRun,
  type ProviderRunStatus,
  type SearchStageCount,
} from "@offeros/job-search";
import type { Db } from "../db/client";
import { jobPostings, jobSources, searchRunItems, searchRuns, sourceHealth } from "../db/schema";

type JobPostingRow = typeof jobPostings.$inferSelect;
type SearchRunRow = typeof searchRuns.$inferSelect;
type SourceHealthRow = typeof sourceHealth.$inferSelect;

export interface StoredJobPosting {
  posting: JobPosting;
  firstSeenAt: number;
  lastSeenAt: number;
}

export interface StoredSearchRun {
  id: string;
  criteria: JobSearchCriteria;
  providerRuns: ProviderRun[];
  stages: SearchStageCount[];
  status: ProviderRunStatus;
  resultCount: number;
  startedAt: number;
  finishedAt: number;
}

export interface StoredSourceHealth {
  provider: string;
  status: ProviderRunStatus;
  received: number;
  accepted: number;
  rejected: number;
  durationMs: number;
  issues: ProviderIssue[];
  lastSuccessAt?: number;
  lastFailureAt?: number;
  consecutiveFailures: number;
  updatedAt: number;
}

function toStoredJob(row: JobPostingRow): StoredJobPosting {
  return {
    posting: jobPostingSchema.parse(row.doc),
    firstSeenAt: row.firstSeenAt,
    lastSeenAt: row.lastSeenAt,
  };
}

function toStoredRun(row: SearchRunRow): StoredSearchRun {
  return {
    id: row.id,
    criteria: jobSearchCriteriaSchema.parse(row.criteria),
    providerRuns: providerRunSchema.array().parse(row.providerRuns),
    stages: searchStageCountSchema.array().parse(row.stages),
    status: row.status,
    resultCount: row.resultCount,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
  };
}

function toSourceHealth(row: SourceHealthRow): StoredSourceHealth {
  return {
    provider: row.provider,
    status: row.status,
    received: row.received,
    accepted: row.accepted,
    rejected: row.rejected,
    durationMs: row.durationMs,
    issues: row.issues,
    ...(row.lastSuccessAt === null ? {} : { lastSuccessAt: row.lastSuccessAt }),
    ...(row.lastFailureAt === null ? {} : { lastFailureAt: row.lastFailureAt }),
    consecutiveFailures: row.consecutiveFailures,
    updatedAt: row.updatedAt,
  };
}

function sourceId(source: JobSourceRecord): string {
  return JSON.stringify([source.provider, source.tenant ?? "", source.externalId]);
}

function runItemId(runId: string, postingId: string): string {
  return JSON.stringify([runId, postingId]);
}

function mergedSources(...groups: JobSourceRecord[][]): JobSourceRecord[] {
  const latest = new Map<string, JobSourceRecord>();
  for (const source of groups.flat()) {
    const key = sourceId(source);
    const current = latest.get(key);
    if (!current || source.fetchedAt >= current.fetchedAt) latest.set(key, source);
  }
  return [...latest.values()].sort((a, b) => sourceId(a).localeCompare(sourceId(b)));
}

function statusFor(providerRuns: ProviderRun[]): ProviderRunStatus {
  if (providerRuns.length === 0 || providerRuns.every((run) => run.status === "failed")) {
    return "failed";
  }
  if (providerRuns.every((run) => run.status === "success")) return "success";
  return "partial";
}

/**
 * Persist one completed search as a single SQLite transaction.
 *
 * Reusing `runId` replaces that run's survivor rows instead of duplicating
 * them. Job and source identities are upserts, so repeating the same provider
 * payload only advances `lastSeenAt` and health rather than growing duplicates.
 */
export function saveJobSearchResult(
  db: Db,
  input: { criteria: unknown; result: JobSearchResult; runId?: string },
): { run: StoredSearchRun; postings: StoredJobPosting[] } {
  const criteria = jobSearchCriteriaSchema.parse(input.criteria);
  const result = jobSearchResultSchema.parse(input.result);
  const runId = input.runId ?? randomUUID();
  const status = statusFor(result.providerRuns);

  return db.transaction((tx) => {
    tx.insert(searchRuns)
      .values({
        id: runId,
        criteria,
        providerRuns: result.providerRuns,
        stages: result.stages,
        status,
        resultCount: result.postings.length,
        startedAt: result.startedAt,
        finishedAt: result.finishedAt,
      })
      .onConflictDoUpdate({
        target: searchRuns.id,
        set: {
          criteria,
          providerRuns: result.providerRuns,
          stages: result.stages,
          status,
          resultCount: result.postings.length,
          startedAt: result.startedAt,
          finishedAt: result.finishedAt,
        },
      })
      .run();
    tx.delete(searchRunItems).where(eq(searchRunItems.runId, runId)).run();

    const stored: StoredJobPosting[] = [];
    for (const [position, incoming] of result.postings.entries()) {
      const normalizedApplyUrl = normalizePostingUrl(incoming.applyUrl);
      const byUrl = tx
        .select()
        .from(jobPostings)
        .where(eq(jobPostings.normalizedApplyUrl, normalizedApplyUrl))
        .get();
      const byId = tx.select().from(jobPostings).where(eq(jobPostings.id, incoming.id)).get();
      if (byUrl && byId && byUrl.id !== byId.id) {
        throw new Error(`job identity collision for ${incoming.id}`);
      }
      const existing = byUrl ?? byId;
      const existingPosting = existing ? jobPostingSchema.parse(existing.doc) : undefined;
      const deduplicated = existingPosting
        ? deduplicatePostings([existingPosting, incoming]).postings[0]!
        : incoming;
      const posting = jobPostingSchema.parse({
        ...deduplicated,
        id: existing?.id ?? incoming.id,
        sources: mergedSources(existingPosting?.sources ?? [], incoming.sources),
      });
      const row = {
        id: posting.id,
        normalizedApplyUrl: normalizePostingUrl(posting.applyUrl),
        doc: posting,
        firstSeenAt: existing?.firstSeenAt ?? result.finishedAt,
        lastSeenAt: result.finishedAt,
      };
      tx.insert(jobPostings)
        .values(row)
        .onConflictDoUpdate({
          target: jobPostings.id,
          set: {
            normalizedApplyUrl: row.normalizedApplyUrl,
            doc: posting,
            lastSeenAt: row.lastSeenAt,
          },
        })
        .run();

      for (const source of posting.sources) {
        tx.insert(jobSources)
          .values({
            id: sourceId(source),
            jobPostingId: posting.id,
            provider: source.provider,
            kind: source.kind,
            externalId: source.externalId,
            tenant: source.tenant ?? null,
            sourceUrl: source.sourceUrl,
            applyUrl: source.applyUrl,
            fetchedAt: source.fetchedAt,
          })
          .onConflictDoUpdate({
            target: jobSources.id,
            set: {
              jobPostingId: posting.id,
              kind: source.kind,
              sourceUrl: source.sourceUrl,
              applyUrl: source.applyUrl,
              fetchedAt: source.fetchedAt,
            },
          })
          .run();
      }
      tx.insert(searchRunItems)
        .values({
          id: runItemId(runId, posting.id),
          runId,
          jobPostingId: posting.id,
          position,
        })
        .run();
      stored.push(toStoredJob(row));
    }

    for (const providerRun of result.providerRuns) {
      const previous = tx
        .select()
        .from(sourceHealth)
        .where(eq(sourceHealth.provider, providerRun.provider))
        .get();
      const failed = providerRun.status === "failed";
      const health = {
        provider: providerRun.provider,
        status: providerRun.status,
        received: providerRun.received,
        accepted: providerRun.accepted,
        rejected: providerRun.rejected,
        durationMs: providerRun.durationMs,
        issues: providerRun.issues,
        lastSuccessAt: failed ? (previous?.lastSuccessAt ?? null) : result.finishedAt,
        lastFailureAt:
          providerRun.status === "success" ? (previous?.lastFailureAt ?? null) : result.finishedAt,
        consecutiveFailures: failed ? (previous?.consecutiveFailures ?? 0) + 1 : 0,
        updatedAt: result.finishedAt,
      };
      tx.insert(sourceHealth)
        .values(health)
        .onConflictDoUpdate({ target: sourceHealth.provider, set: health })
        .run();
    }

    return {
      run: toStoredRun({
        id: runId,
        criteria,
        providerRuns: result.providerRuns,
        stages: result.stages,
        status,
        resultCount: result.postings.length,
        startedAt: result.startedAt,
        finishedAt: result.finishedAt,
      }),
      postings: stored,
    };
  });
}

export function listStoredJobs(db: Db, criteriaInput: unknown = {}): StoredJobPosting[] {
  const criteria = jobSearchCriteriaSchema.parse(criteriaInput);
  const matched = db
    .select()
    .from(jobPostings)
    .orderBy(desc(jobPostings.lastSeenAt))
    .all()
    .map(toStoredJob)
    .filter(
      (stored) =>
        matchesQuery(stored.posting, criteria.query) &&
        matchesLocationCriteria(stored.posting, criteria),
    );
  return criteria.maxResults ? matched.slice(0, criteria.maxResults) : matched;
}

export function getStoredSearchRun(db: Db, id: string): StoredSearchRun | null {
  const row = db.select().from(searchRuns).where(eq(searchRuns.id, id)).get();
  return row ? toStoredRun(row) : null;
}

export function listStoredSearchRuns(db: Db, limit = 20): StoredSearchRun[] {
  const safeLimit = Math.max(1, Math.min(100, Math.trunc(limit)));
  return db
    .select()
    .from(searchRuns)
    .orderBy(desc(searchRuns.finishedAt))
    .limit(safeLimit)
    .all()
    .map(toStoredRun);
}

export function listSourceHealth(db: Db): StoredSourceHealth[] {
  return db
    .select()
    .from(sourceHealth)
    .orderBy(desc(sourceHealth.updatedAt))
    .all()
    .map(toSourceHealth);
}
