import { fetchJson } from "../http";
import { htmlToText, inferWorkplace } from "../normalize";
import {
  jobPostingSchema,
  type JobPosting,
  type JobSearchContext,
  type JobSearchProvider,
  type ProviderIssue,
  type ProviderSearchResult,
} from "../types";

export interface GreenhouseBoard {
  token: string;
  company: string;
}

const text = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

function parseJob(
  raw: unknown,
  board: GreenhouseBoard,
  sourceUrl: string,
  fetchedAt: number,
): JobPosting | null {
  if (typeof raw !== "object" || raw === null) return null;
  const value = raw as Record<string, unknown>;
  const externalId =
    typeof value.id === "number" || typeof value.id === "string" ? String(value.id) : "";
  const title = text(value.title);
  const locationObject =
    typeof value.location === "object" && value.location !== null
      ? (value.location as Record<string, unknown>)
      : {};
  const location = text(locationObject.name);
  const applyUrl = text(value.absolute_url);
  if (!externalId || !title || !applyUrl) return null;
  const description = htmlToText(text(value.content));
  const departments = Array.isArray(value.departments)
    ? (value.departments as Array<Record<string, unknown>>)
    : [];
  const department = text(departments[0]?.name);
  const updatedAt = text(value.updated_at);
  const candidate = {
    id: `greenhouse:${board.token.toLowerCase()}:${externalId}`,
    title,
    company: board.company.trim(),
    ...(location ? { location } : {}),
    workplace: inferWorkplace(title, location, description),
    ...(department ? { department } : {}),
    ...(description ? { description } : {}),
    ...(updatedAt ? { updatedAt } : {}),
    applyUrl,
    liveness: "open" as const,
    sources: [
      {
        provider: "greenhouse",
        kind: "official-ats" as const,
        externalId,
        tenant: board.token.toLowerCase(),
        sourceUrl,
        applyUrl,
        fetchedAt,
      },
    ],
  };
  const parsed = jobPostingSchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}

export function createGreenhouseProvider(boards: GreenhouseBoard[]): JobSearchProvider {
  return {
    id: "greenhouse",
    kind: "official-ats",
    async search(_criteria, context: JobSearchContext = {}): Promise<ProviderSearchResult> {
      const now = context.now ?? Date.now;
      const results = await Promise.all(
        boards.map(async (board) => {
          const scope = board.token.trim().toLowerCase();
          const sourceUrl = `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(scope)}/jobs?content=true`;
          const response = await fetchJson(sourceUrl, context);
          if (!response.ok) {
            return {
              postings: [] as JobPosting[],
              received: 0,
              rejected: 0,
              issues: [{ ...response.issue, provider: "greenhouse", scope }] as ProviderIssue[],
            };
          }
          const payload = response.value as { jobs?: unknown };
          if (!payload || !Array.isArray(payload.jobs)) {
            return {
              postings: [] as JobPosting[],
              received: 0,
              rejected: 0,
              issues: [
                {
                  provider: "greenhouse",
                  scope,
                  code: "invalid-payload" as const,
                  message: "Greenhouse response did not contain a jobs array",
                  retryable: false,
                },
              ],
            };
          }
          const fetchedAt = now();
          const postings = payload.jobs
            .map((job) => parseJob(job, board, sourceUrl, fetchedAt))
            .filter((job): job is JobPosting => job !== null);
          return {
            postings,
            received: payload.jobs.length,
            rejected: payload.jobs.length - postings.length,
            issues: [] as ProviderIssue[],
          };
        }),
      );
      return {
        postings: results.flatMap((result) => result.postings),
        received: results.reduce((sum, result) => sum + result.received, 0),
        rejected: results.reduce((sum, result) => sum + result.rejected, 0),
        issues: results.flatMap((result) => result.issues),
      };
    },
  };
}
