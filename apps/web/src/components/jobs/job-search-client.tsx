"use client";

import { useMemo, useState } from "react";
import { Clock, Database, ExternalLink, MapPin, Search } from "lucide-react";
import {
  matchesLocationCriteria,
  matchesQuery,
  type JobLocationScope,
  type JobSearchCriteria,
  type SavedJobSearch,
} from "@offeros/job-search";
import {
  api,
  type JobCatalogueEntry,
  type JobSearchRunSummary,
  type JobSourceHealthSummary,
  type PublicJobSearchResult,
} from "@/lib/api-client";
import { EmptyState } from "@/components/empty-state";
import { SavedSearchManager } from "@/components/jobs/saved-search-manager";
import { cn } from "@/lib/utils";

const DATE = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});

const DATE_TIME = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZone: "UTC",
  timeZoneName: "short",
});

function providerLabel(provider: string): string {
  const known: Record<string, string> = {
    "manual-url": "Manual URL",
    "browser-capture": "Browser",
    freehire: "freehire",
    greenhouse: "Greenhouse",
    lever: "Lever",
    ashby: "Ashby",
  };
  return (
    known[provider] ??
    provider
      .split(/[-_]/)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ")
  );
}

function statusLabel(status: JobSearchRunSummary["status"]): string {
  if (status === "success") return "Healthy";
  if (status === "partial") return "Partial";
  return "Failed";
}

function JobCard({ entry }: { entry: JobCatalogueEntry }) {
  const { posting } = entry;
  const providers = [...new Set(posting.sources.map((source) => source.provider))];

  return (
    <article className="rounded-2xl border border-border bg-card p-5 shadow-sm">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-title font-semibold text-foreground">{posting.title}</h2>
            <span
              className={cn(
                "rounded-full px-2 py-0.5 text-caption font-medium",
                posting.liveness === "open" && "bg-success/15 text-success",
                posting.liveness === "closed" && "bg-destructive/10 text-destructive",
                posting.liveness === "unknown" && "bg-muted text-muted-foreground",
              )}
            >
              {posting.liveness === "unknown" ? "Status unknown" : posting.liveness}
            </span>
          </div>
          <p className="mt-1 text-body-lg font-medium text-foreground/85">{posting.company}</p>
          <div className="mt-3 flex flex-wrap gap-2 text-caption text-muted-foreground">
            <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-1">
              <MapPin aria-hidden className="size-3.5" />
              {posting.location ?? "Location not listed"}
            </span>
            <span className="rounded-full bg-muted px-2.5 py-1 capitalize">
              {posting.workplace}
            </span>
            {posting.employmentType && (
              <span className="rounded-full bg-muted px-2.5 py-1">{posting.employmentType}</span>
            )}
            {posting.salary && (
              <span className="rounded-full bg-muted px-2.5 py-1">{posting.salary}</span>
            )}
          </div>
        </div>

        <a
          href={posting.applyUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-full bg-primary px-4 py-2 text-body font-semibold text-primary-foreground press hover:bg-primary/85"
        >
          Apply link
          <ExternalLink aria-hidden className="size-3.5" />
        </a>
      </div>

      <dl className="mt-5 grid gap-4 border-t border-border pt-4 text-caption sm:grid-cols-3">
        <div>
          <dt className="font-medium text-muted-foreground">Sources</dt>
          <dd className="mt-1 flex flex-wrap gap-1.5 text-foreground">
            {providers.map((provider) => (
              <span key={provider} className="rounded-full border border-border px-2 py-0.5">
                {providerLabel(provider)}
              </span>
            ))}
          </dd>
        </div>
        <div>
          <dt className="font-medium text-muted-foreground">Posted</dt>
          <dd className="mt-1 text-foreground">
            {posting.postedAt ? (
              <time dateTime={posting.postedAt}>{DATE.format(new Date(posting.postedAt))}</time>
            ) : (
              "Not provided"
            )}
          </dd>
        </div>
        <div>
          <dt className="font-medium text-muted-foreground">Last checked</dt>
          <dd className="mt-1 inline-flex items-center gap-1 text-foreground">
            <Clock aria-hidden className="size-3.5 text-muted-foreground" />
            <time dateTime={new Date(entry.lastSeenAt).toISOString()}>
              {DATE_TIME.format(new Date(entry.lastSeenAt))}
            </time>
          </dd>
        </div>
      </dl>
    </article>
  );
}

function SearchOutcome({ result }: { result: PublicJobSearchResult }) {
  const issues = result.providerRuns.flatMap((run) => run.issues);
  const failed = result.run.status === "failed";
  const partial = result.run.status === "partial";

  return (
    <div
      role={failed ? "alert" : "status"}
      className={cn(
        "mt-4 rounded-xl border p-3 text-body",
        failed && "border-destructive/30 bg-destructive/5 text-destructive",
        partial && "border-warn/30 bg-warn-bg text-foreground",
        !failed && !partial && "border-success/25 bg-success/10 text-foreground",
      )}
    >
      <p className="font-semibold">
        {failed
          ? "Public search could not complete"
          : `${result.run.resultCount} job${result.run.resultCount === 1 ? "" : "s"} matched and saved`}
      </p>
      {issues.length > 0 && <p className="mt-1 text-caption">{issues[0]!.message}</p>}
    </div>
  );
}

export function JobSearchClient({
  initialJobs,
  initialRuns,
  initialSourceHealth,
  initialSavedSearches,
}: {
  initialJobs: JobCatalogueEntry[];
  initialRuns: JobSearchRunSummary[];
  initialSourceHealth: JobSourceHealthSummary[];
  initialSavedSearches: SavedJobSearch[];
}) {
  const [jobs, setJobs] = useState(initialJobs);
  const [runs, setRuns] = useState(initialRuns);
  const [sourceHealth, setSourceHealth] = useState(initialSourceHealth);
  const [query, setQuery] = useState("");
  const [locationScope, setLocationScope] = useState<JobLocationScope>("remote-us");
  const [includeUnknown, setIncludeUnknown] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<PublicJobSearchResult | null>(null);

  const criteria = useMemo<JobSearchCriteria>(
    () => ({
      ...(query.trim() ? { query: query.trim() } : {}),
      locationScope,
      unknownLocationPolicy: includeUnknown ? "include" : "exclude",
    }),
    [includeUnknown, locationScope, query],
  );
  const visibleJobs = useMemo(
    () =>
      jobs.filter(
        (entry) =>
          matchesQuery(entry.posting, criteria.query) &&
          matchesLocationCriteria(entry.posting, criteria),
      ),
    [criteria, jobs],
  );
  const lastRun = runs[0];
  const freehireHealth = sourceHealth.find((source) => source.provider === "freehire");

  async function refreshAfterSearch(result: PublicJobSearchResult) {
    const [catalogue, history] = await Promise.all([api.jobs.list(), api.jobs.history(10)]);
    setOutcome(result);
    setJobs(catalogue);
    setRuns(history.runs);
    setSourceHealth(history.sourceHealth);
  }

  async function searchPublicJobs() {
    if (busy || !criteria.query) return;
    setBusy(true);
    setError(null);
    setOutcome(null);
    try {
      const result = await api.jobs.searchPublic({ ...criteria, maxResults: 100 });
      await refreshAfterSearch(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Public search failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-8">
      <section className="rounded-2xl border border-border bg-card p-5 shadow-sm">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void searchPublicJobs();
          }}
        >
          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_220px_auto]">
            <label className="block">
              <span className="mb-1.5 block text-caption font-medium text-muted-foreground">
                Keywords
              </span>
              <span className="flex items-center gap-2 rounded-xl border border-border bg-background px-3 py-2 focus-within:ring-1 focus-within:ring-ring">
                <Search aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="ML engineer, LLM, Python…"
                  className="min-w-0 flex-1 bg-transparent text-body text-foreground outline-none placeholder:text-muted-foreground"
                />
              </span>
            </label>
            <label className="block">
              <span className="mb-1.5 block text-caption font-medium text-muted-foreground">
                Location
              </span>
              <select
                value={locationScope}
                onChange={(event) => setLocationScope(event.target.value as JobLocationScope)}
                className="w-full rounded-xl border border-border bg-background px-3 py-2 text-body text-foreground outline-none focus:ring-1 focus:ring-ring"
              >
                <option value="remote-us">Remote · United States</option>
                <option value="united-states">United States</option>
                <option value="any">Anywhere</option>
              </select>
            </label>
            <button
              type="submit"
              disabled={busy || !criteria.query}
              className="self-end rounded-full bg-primary px-5 py-2 text-body font-semibold text-primary-foreground press hover:bg-primary/85 disabled:opacity-50"
            >
              {busy ? "Searching…" : "Search public jobs"}
            </button>
          </div>

          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <label className="inline-flex items-center gap-2 text-caption text-muted-foreground">
              <input
                type="checkbox"
                checked={includeUnknown}
                onChange={(event) => setIncludeUnknown(event.target.checked)}
                className="size-4 rounded border-border"
              />
              Include jobs whose location is unclear
            </label>
            <button
              type="button"
              onClick={() => {
                setQuery("");
                setLocationScope("any");
                setIncludeUnknown(true);
                setError(null);
                setOutcome(null);
              }}
              className="text-caption font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              Clear filters
            </button>
          </div>
        </form>

        <div className="mt-5 grid gap-3 border-t border-border pt-4 text-caption sm:grid-cols-3">
          <div className="flex items-center gap-2">
            <Database aria-hidden className="size-4 text-muted-foreground" />
            <span data-testid="catalogue-total">
              <strong className="font-semibold text-foreground">{jobs.length}</strong> saved locally
            </span>
          </div>
          <div>
            <span className="text-muted-foreground">Last search: </span>
            <span className="font-medium text-foreground">
              {lastRun ? DATE_TIME.format(new Date(lastRun.finishedAt)) : "Not run yet"}
            </span>
          </div>
          <div>
            <span className="text-muted-foreground">freehire: </span>
            <span className="font-medium text-foreground">
              {freehireHealth ? statusLabel(freehireHealth.status) : "Not checked"}
            </span>
          </div>
        </div>

        {outcome && <SearchOutcome result={outcome} />}
        {error && (
          <div
            role="alert"
            className="mt-4 rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-body text-destructive"
          >
            {error}
          </div>
        )}
      </section>

      <SavedSearchManager
        initialSavedSearches={initialSavedSearches}
        onRunComplete={refreshAfterSearch}
      />

      <section aria-labelledby="job-results-heading">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 id="job-results-heading" className="text-body font-semibold text-muted-foreground">
            Job catalogue
          </h2>
          <span className="text-caption text-muted-foreground">
            {visibleJobs.length} matching · {jobs.length} saved
          </span>
        </div>

        {visibleJobs.length === 0 ? (
          <EmptyState
            title={jobs.length === 0 ? "No jobs saved yet" : "No saved jobs match"}
            body={
              jobs.length === 0
                ? "Search the public index above, paste a job link, or save the current page from Chrome."
                : "Change the keywords or location filters. Your saved jobs are still in the local catalogue."
            }
          />
        ) : (
          <div className="space-y-3">
            {visibleJobs.map((entry) => (
              <JobCard key={entry.posting.id} entry={entry} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
