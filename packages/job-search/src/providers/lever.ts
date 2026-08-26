import { fetchJson } from "../http";
import { htmlToText, inferWorkplace } from "../normalize";
import {
  jobPostingSchema,
  type JobPosting,
  type JobSearchContext,
  type JobSearchProvider,
  type JobWorkplaceType,
  type ProviderIssue,
  type ProviderSearchResult,
} from "../types";

export interface LeverSite {
  site: string;
  company: string;
  region?: "global" | "eu";
}

const text = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

function workplace(value: unknown, ...fallback: Array<string | undefined>): JobWorkplaceType {
  const normalized = text(value).toLowerCase();
  if (normalized === "remote" || normalized === "hybrid" || normalized === "on-site") {
    return normalized;
  }
  return inferWorkplace(...fallback);
}

function salary(value: unknown): string {
  if (typeof value !== "object" || value === null) return "";
  const range = value as Record<string, unknown>;
  const min = typeof range.min === "number" ? range.min : undefined;
  const max = typeof range.max === "number" ? range.max : undefined;
  if (min === undefined && max === undefined) return "";
  const amount =
    min !== undefined && max !== undefined
      ? `${min.toLocaleString("en-US")}–${max.toLocaleString("en-US")}`
      : (min ?? max)!.toLocaleString("en-US");
  const interval = text(range.interval)
    .replace(/^per-|-salary$/g, "")
    .replace(/-/g, " ");
  return [text(range.currency), amount, interval ? `per ${interval}` : ""]
    .filter(Boolean)
    .join(" ");
}

function parseJob(
  raw: unknown,
  site: LeverSite,
  sourceUrl: string,
  fetchedAt: number,
): JobPosting | null {
  if (typeof raw !== "object" || raw === null) return null;
  const value = raw as Record<string, unknown>;
  const externalId = text(value.id);
  const title = text(value.text);
  const categories =
    typeof value.categories === "object" && value.categories !== null
      ? (value.categories as Record<string, unknown>)
      : {};
  const location = text(categories.location);
  const employmentType = text(categories.commitment);
  const department = text(categories.department) || text(categories.team);
  const description =
    [text(value.descriptionPlain), text(value.additionalPlain)].filter(Boolean).join("\n\n") ||
    htmlToText(text(value.description));
  const applyUrl = text(value.applyUrl) || text(value.hostedUrl);
  if (!externalId || !title || !applyUrl) return null;
  const salaryText = salary(value.salaryRange);
  const postedAt =
    typeof value.createdAt === "number" && Number.isFinite(value.createdAt)
      ? new Date(value.createdAt).toISOString()
      : "";
  const candidate = {
    id: `lever:${site.site.toLowerCase()}:${externalId}`,
    title,
    company: site.company.trim(),
    ...(location ? { location } : {}),
    ...(text(value.country) ? { countryCode: text(value.country).toUpperCase() } : {}),
    workplace: workplace(value.workplaceType, title, location, description),
    ...(employmentType ? { employmentType } : {}),
    ...(department ? { department } : {}),
    ...(description ? { description } : {}),
    ...(salaryText ? { salary: salaryText } : {}),
    ...(postedAt ? { postedAt } : {}),
    applyUrl,
    liveness: "open" as const,
    sources: [
      {
        provider: "lever",
        kind: "official-ats" as const,
        externalId,
        tenant: site.site.toLowerCase(),
        sourceUrl,
        applyUrl,
        fetchedAt,
      },
    ],
  };
  const parsed = jobPostingSchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}

export function createLeverProvider(sites: LeverSite[]): JobSearchProvider {
  return {
    id: "lever",
    kind: "official-ats",
    async search(_criteria, context: JobSearchContext = {}): Promise<ProviderSearchResult> {
      const now = context.now ?? Date.now;
      const results = await Promise.all(
        sites.map(async (site) => {
          const scope = site.site.trim().toLowerCase();
          const apiHost = site.region === "eu" ? "api.eu.lever.co" : "api.lever.co";
          const sourceUrl = `https://${apiHost}/v0/postings/${encodeURIComponent(scope)}?mode=json`;
          const response = await fetchJson(sourceUrl, context);
          if (!response.ok) {
            return {
              postings: [] as JobPosting[],
              received: 0,
              rejected: 0,
              issues: [{ ...response.issue, provider: "lever", scope }] as ProviderIssue[],
            };
          }
          if (!Array.isArray(response.value)) {
            return {
              postings: [] as JobPosting[],
              received: 0,
              rejected: 0,
              issues: [
                {
                  provider: "lever",
                  scope,
                  code: "invalid-payload" as const,
                  message: "Lever response was not a postings array",
                  retryable: false,
                },
              ],
            };
          }
          const fetchedAt = now();
          const postings = response.value
            .map((job) => parseJob(job, site, sourceUrl, fetchedAt))
            .filter((job): job is JobPosting => job !== null);
          return {
            postings,
            received: response.value.length,
            rejected: response.value.length - postings.length,
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
