import { fetchJson } from "../http";
import { normalizePostingUrl } from "../normalize";
import {
  jobPostingSchema,
  type JobPosting,
  type JobSearchContext,
  type JobSearchCriteria,
  type JobSearchProvider,
  type JobWorkplaceType,
  type ProviderIssue,
  type ProviderSearchResult,
} from "../types";

const DEFAULT_BASE_URL = "https://freehire.me/api/v1/";
const PAGE_SIZE = 100;

export interface FreehireProviderOptions {
  /** Intended for an explicitly configured self-hosted freehire instance. */
  baseUrl?: string;
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

function workplace(value: unknown): JobWorkplaceType {
  const normalized = text(value).toLowerCase().replace(/_/g, "-");
  if (normalized === "remote" || normalized === "hybrid") return normalized;
  if (normalized === "onsite" || normalized === "on-site") return "on-site";
  return "unknown";
}

function oneCountryCode(value: unknown): string {
  if (!Array.isArray(value) || value.length !== 1) return "";
  const code = text(value[0]);
  return /^[a-z]{2}$/i.test(code) ? code.toUpperCase() : "";
}

function parseJob(raw: unknown, sourceUrl: string, fetchedAt: number): JobPosting | null {
  const value = record(raw);
  if (Object.keys(value).length === 0) return null;
  const publicSlug = text(value.public_slug);
  const title = text(value.title);
  const company = text(value.company);
  const rawApplyUrl = text(value.url);
  if (!publicSlug || !title || !company || !rawApplyUrl) return null;
  const applyUrl = normalizePostingUrl(rawApplyUrl);
  const location = text(value.location);
  const countryCode = oneCountryCode(value.countries);
  const description = text(value.description);
  const postedAt = isoDate(value.posted_at);
  const updatedAt = isoDate(value.updated_at);
  const closedAt = isoDate(value.closed_at);
  const source = text(value.source);
  const candidate = {
    id: `freehire:${publicSlug}`,
    title,
    company,
    ...(location ? { location } : {}),
    ...(countryCode ? { countryCode } : {}),
    workplace: workplace(value.work_mode),
    ...(description ? { description } : {}),
    ...(postedAt ? { postedAt } : {}),
    ...(updatedAt ? { updatedAt } : {}),
    applyUrl,
    liveness: closedAt ? ("closed" as const) : ("open" as const),
    sources: [
      {
        provider: "freehire",
        kind: "aggregator" as const,
        externalId: publicSlug,
        ...(source ? { tenant: source } : {}),
        sourceUrl,
        applyUrl,
        fetchedAt,
      },
    ],
  };
  const parsed = jobPostingSchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}

function baseUrl(value: string | undefined): URL {
  const url = new URL(value ?? DEFAULT_BASE_URL);
  if (url.username || url.password)
    throw new Error("freehire base URL must not contain credentials");
  const isLocal =
    url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && isLocal)) {
    throw new Error("freehire base URL must use HTTPS, except for localhost development");
  }
  url.pathname = `${url.pathname.replace(/\/+$/, "")}/`;
  url.search = "";
  url.hash = "";
  return url;
}

function searchUrl(root: URL, criteria: JobSearchCriteria, limit: number, offset: number): URL {
  const url = new URL("agent/jobs/search", root);
  if (criteria.query) url.searchParams.set("q", criteria.query);
  if (criteria.locationScope === "united-states" || criteria.locationScope === "remote-us") {
    url.searchParams.set("countries", "US");
  }
  if (criteria.locationScope === "remote-us") url.searchParams.set("work_mode", "remote");
  url.searchParams.set("description_format", "text");
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("offset", String(offset));
  return url;
}

function relevantIgnoredParams(value: unknown, requested: URL): string[] {
  const ignored = record(value).ignored_params;
  if (!Array.isArray(ignored)) return [];
  const requestedKeys = new Set(requested.searchParams.keys());
  return ignored
    .map((item) => text(record(item).param))
    .filter((param) => param && requestedKeys.has(param));
}

export function createFreehireProvider(options: FreehireProviderOptions = {}): JobSearchProvider {
  const root = baseUrl(options.baseUrl);
  return {
    id: "freehire",
    kind: "aggregator",
    async search(criteria, context: JobSearchContext = {}): Promise<ProviderSearchResult> {
      const now = context.now ?? Date.now;
      const target = criteria.maxResults ?? PAGE_SIZE;
      const postings: JobPosting[] = [];
      const issues: ProviderIssue[] = [];
      let received = 0;
      let rejected = 0;
      let offset = 0;

      while (received < target) {
        const requested = searchUrl(root, criteria, Math.min(PAGE_SIZE, target - received), offset);
        const response = await fetchJson(requested.toString(), context);
        if (!response.ok) {
          issues.push({ ...response.issue, provider: "freehire" });
          break;
        }
        const payload = record(response.value);
        if (
          !Array.isArray(payload.data) ||
          typeof payload.meta !== "object" ||
          payload.meta === null
        ) {
          issues.push({
            provider: "freehire",
            code: "invalid-payload",
            message: "freehire response did not contain data and meta",
            retryable: false,
          });
          break;
        }
        const ignored = relevantIgnoredParams(payload.meta, requested);
        if (ignored.length > 0) {
          received += payload.data.length;
          rejected = received;
          postings.length = 0;
          issues.push({
            provider: "freehire",
            code: "invalid-payload",
            message: `freehire ignored requested parameters: ${ignored.join(", ")}`,
            retryable: false,
          });
          break;
        }

        const fetchedAt = now();
        const pagePostings = payload.data
          .map((job) => parseJob(job, requested.toString(), fetchedAt))
          .filter((job): job is JobPosting => job !== null);
        received += payload.data.length;
        rejected += payload.data.length - pagePostings.length;
        postings.push(...pagePostings);
        offset += payload.data.length;
        const total = Number(record(payload.meta).total);
        if (
          payload.data.length === 0 ||
          (Number.isFinite(total) ? offset >= total : payload.data.length < PAGE_SIZE)
        ) {
          break;
        }
      }

      return { postings, received, rejected, issues };
    },
  };
}
