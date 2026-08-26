import { fetchJson } from "../http";
import { htmlToText, inferWorkplace, normalizeSearchText } from "../normalize";
import {
  jobPostingSchema,
  type JobPosting,
  type JobSearchContext,
  type JobSearchProvider,
  type JobWorkplaceType,
  type ProviderIssue,
  type ProviderSearchResult,
} from "../types";

export interface AshbyBoard {
  name: string;
  company: string;
}

const text = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function isoDate(value: unknown): string {
  const raw = text(value);
  if (!raw) return "";
  const timestamp = Date.parse(raw);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : "";
}

function workplace(value: unknown, isRemote: unknown, ...fallback: string[]): JobWorkplaceType {
  const normalized = text(value).toLowerCase();
  if (normalized === "remote") return "remote";
  if (normalized === "hybrid") return "hybrid";
  if (normalized === "onsite" || normalized === "on-site") return "on-site";
  if (isRemote === true) return "remote";
  return inferWorkplace(...fallback);
}

function countryCode(value: string): string {
  const normalized = normalizeSearchText(value);
  if (/^[a-z]{2}$/i.test(value)) return value.toUpperCase();
  const aliases: Record<string, string> = {
    australia: "AU",
    canada: "CA",
    germany: "DE",
    india: "IN",
    ireland: "IE",
    mexico: "MX",
    singapore: "SG",
    "united kingdom": "GB",
    "united states": "US",
    "united states of america": "US",
    usa: "US",
  };
  return aliases[normalized] ?? "";
}

function locationWithCountry(location: string, country: string): string {
  if (!country) return location;
  if (!location) return country;
  if (normalizeSearchText(location).includes(normalizeSearchText(country))) return location;
  return `${location}, ${country}`;
}

function parseJob(
  raw: unknown,
  board: AshbyBoard,
  sourceUrl: string,
  fetchedAt: number,
): JobPosting | null {
  const value = record(raw);
  if (Object.keys(value).length === 0 || value.isListed === false) return null;
  const externalId = text(value.id);
  const title = text(value.title);
  const applyUrl = text(value.applyUrl) || text(value.jobUrl);
  if (!externalId || !title || !applyUrl) return null;

  const postalAddress = record(record(value.address).postalAddress);
  const addressCountry = text(postalAddress.addressCountry);
  const secondaryLocations = Array.isArray(value.secondaryLocations)
    ? (value.secondaryLocations as unknown[])
    : [];
  const primaryLocation = text(value.location) || text(record(secondaryLocations[0]).location);
  const location = locationWithCountry(primaryLocation, addressCountry);
  const description = text(value.descriptionPlain) || htmlToText(text(value.descriptionHtml));
  const compensation = record(value.compensation);
  const salary =
    value.shouldDisplayCompensationOnJobPostings === false
      ? ""
      : text(compensation.scrapeableCompensationSalarySummary) ||
        text(compensation.compensationTierSummary);
  const publishedAt = isoDate(value.publishedAt);
  const department = text(value.department) || text(value.team);
  const employmentType = text(value.employmentType);
  const boardName = board.name.trim();
  const candidate = {
    id: `ashby:${boardName.toLowerCase()}:${externalId}`,
    title,
    company: board.company.trim(),
    ...(location ? { location } : {}),
    ...(countryCode(addressCountry) ? { countryCode: countryCode(addressCountry) } : {}),
    workplace: workplace(value.workplaceType, value.isRemote, title, location, description),
    ...(employmentType ? { employmentType } : {}),
    ...(department ? { department } : {}),
    ...(description ? { description } : {}),
    ...(salary ? { salary } : {}),
    ...(publishedAt ? { postedAt: publishedAt } : {}),
    applyUrl,
    liveness: "open" as const,
    sources: [
      {
        provider: "ashby",
        kind: "official-ats" as const,
        externalId,
        tenant: boardName.toLowerCase(),
        sourceUrl,
        applyUrl,
        fetchedAt,
      },
    ],
  };
  const parsed = jobPostingSchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}

export function createAshbyProvider(boards: AshbyBoard[]): JobSearchProvider {
  return {
    id: "ashby",
    kind: "official-ats",
    async search(_criteria, context: JobSearchContext = {}): Promise<ProviderSearchResult> {
      const now = context.now ?? Date.now;
      const results = await Promise.all(
        boards.map(async (board) => {
          const boardName = board.name.trim();
          const sourceUrl = `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(boardName)}?includeCompensation=true`;
          const response = await fetchJson(sourceUrl, context);
          if (!response.ok) {
            return {
              postings: [] as JobPosting[],
              received: 0,
              rejected: 0,
              issues: [
                { ...response.issue, provider: "ashby", scope: boardName },
              ] as ProviderIssue[],
            };
          }
          const payload = record(response.value);
          if (!Array.isArray(payload.jobs)) {
            return {
              postings: [] as JobPosting[],
              received: 0,
              rejected: 0,
              issues: [
                {
                  provider: "ashby",
                  scope: boardName,
                  code: "invalid-payload" as const,
                  message: "Ashby response did not contain a jobs array",
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
