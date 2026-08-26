"use client";

import { useMemo, useState } from "react";
import { Clock, Database, ExternalLink, MapPin, Search } from "lucide-react";
import {
  assessJobMatch,
  evaluateJobExperienceRule,
  evaluateJobSalaryRule,
  matchesLocationCriteria,
  matchesQuery,
  type JobMatchAssessment,
  type JobMatchPreferences,
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

function verdictLabel(verdict: JobMatchAssessment["verdict"]): string {
  if (verdict === "strong") return "Strong evidence";
  if (verdict === "possible") return "Possible match";
  if (verdict === "review") return "Needs review";
  return "Excluded";
}

function sponsorshipLabel(
  state: JobMatchAssessment["eligibility"]["sponsorship"]["state"],
): string {
  if (state === "available") return "available";
  if (state === "unavailable") return "not offered";
  if (state === "ambiguous") return "needs review";
  return "not mentioned";
}

function workAuthorizationLabel(
  state: JobMatchAssessment["eligibility"]["usWorkAuthorization"]["state"],
): string {
  if (state === "required") return "current authorization required";
  if (state === "restricted") return "specific status restriction";
  return "not mentioned";
}

type FactDecision = "satisfied" | "review" | "blocker" | "observed";

function compactUsd(value: number): string {
  if (value >= 1_000 && value % 1_000 === 0) {
    return `$${(value / 1_000).toLocaleString("en-US")}k`;
  }
  return `$${value.toLocaleString("en-US")}`;
}

function salaryFactLabel(assessment: JobMatchAssessment): string {
  const salary = assessment.salary;
  if (salary.state === "not-mentioned") return "Not mentioned";
  if (salary.state === "unsupported") {
    return "Not a supported annual USD cash/base amount";
  }
  if (salary.state === "ambiguous") return "Ambiguous compensation";
  if (salary.bound === "range") {
    return `${compactUsd(salary.minimum!)}–${compactUsd(salary.maximum!)} annual USD`;
  }
  if (salary.bound === "minimum-only") {
    return `${compactUsd(salary.minimum!)}+ annual USD`;
  }
  if (salary.bound === "maximum-only") {
    return `Up to ${compactUsd(salary.maximum!)} annual USD`;
  }
  return `${compactUsd(salary.minimum!)} annual USD`;
}

function experienceFactLabel(assessment: JobMatchAssessment): string {
  const experience = assessment.experience;
  if (experience.state === "not-mentioned") return "Not mentioned";
  if (experience.state === "ambiguous") {
    return "Ambiguous or non-comparable experience requirement";
  }
  if (experience.maximumYears !== undefined) {
    return `${experience.minimumYears}–${experience.maximumYears} years explicitly required`;
  }
  return `${experience.minimumYears}+ years explicitly required`;
}

function factDecision(status: ReturnType<typeof evaluateJobSalaryRule>["status"]): FactDecision {
  return status === "not-configured" ? "observed" : status;
}

function factDecisionLabel(decision: FactDecision): string {
  if (decision === "satisfied") return "Rule satisfied";
  if (decision === "review") return "Needs review";
  if (decision === "blocker") return "Rule blocker";
  return "Fact only — no rule set";
}

function factDecisionClass(decision: FactDecision): string {
  if (decision === "satisfied") return "bg-success/15 text-success";
  if (decision === "review") return "bg-warn-bg text-foreground";
  if (decision === "blocker") return "bg-destructive/10 text-destructive";
  return "bg-muted text-muted-foreground";
}

function JobCard({
  entry,
  assessment,
  matchPreferences,
}: {
  entry: JobCatalogueEntry;
  assessment?: JobMatchAssessment;
  matchPreferences?: JobMatchPreferences;
}) {
  const { posting } = entry;
  const providers = [...new Set(posting.sources.map((source) => source.provider))];
  const eligibilityEvidence = assessment
    ? [
        ...assessment.eligibility.sponsorship.evidence.map((detail) => ({
          label: "Sponsorship",
          detail,
        })),
        ...assessment.eligibility.usWorkAuthorization.evidence.map((detail) => ({
          label: "US work authorization",
          detail,
        })),
      ]
    : [];
  const salaryDecision =
    assessment && matchPreferences
      ? factDecision(
          evaluateJobSalaryRule(assessment.salary, matchPreferences.minimumAnnualSalaryUsd).status,
        )
      : "observed";
  const experienceDecision =
    assessment && matchPreferences
      ? factDecision(
          evaluateJobExperienceRule(
            assessment.experience,
            matchPreferences.maximumRequiredExperienceYears,
          ).status,
        )
      : "observed";

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

      {assessment && (
        <div
          className={cn(
            "mt-4 rounded-xl border p-3 text-caption",
            assessment.verdict === "skip" &&
              "border-destructive/25 bg-destructive/5 text-foreground",
            assessment.verdict === "review" && "border-warn/30 bg-warn-bg text-foreground",
            assessment.verdict === "possible" && "border-border bg-muted/45 text-foreground",
            assessment.verdict === "strong" && "border-success/25 bg-success/10 text-foreground",
          )}
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-semibold">{verdictLabel(assessment.verdict)}</span>
            <span className="text-muted-foreground">
              {assessment.score}/100 evidence score · deterministic
            </span>
          </div>
          <p className="mt-2 text-muted-foreground">
            Sponsorship: {sponsorshipLabel(assessment.eligibility.sponsorship.state)} · US work
            authorization:{" "}
            {workAuthorizationLabel(assessment.eligibility.usWorkAuthorization.state)}
          </p>
          {eligibilityEvidence.length > 0 && (
            <ul className="mt-2 space-y-1 text-muted-foreground">
              {eligibilityEvidence.map((item) => (
                <li key={`${item.label}:${item.detail}`}>
                  <span className="font-medium text-foreground">{item.label} evidence:</span> “
                  {item.detail}”
                </li>
              ))}
            </ul>
          )}
          <dl className="mt-3 grid gap-2 sm:grid-cols-2">
            <div className="rounded-lg border border-border/70 bg-background/45 p-2.5">
              <dt className="flex flex-wrap items-center justify-between gap-2 font-medium text-foreground">
                Salary fact
                <span
                  aria-label={`Salary decision: ${factDecisionLabel(salaryDecision)}`}
                  className={cn(
                    "rounded-full px-2 py-0.5 text-caption font-medium",
                    factDecisionClass(salaryDecision),
                  )}
                >
                  {factDecisionLabel(salaryDecision)}
                </span>
              </dt>
              <dd className="mt-1 text-muted-foreground">
                {salaryFactLabel(assessment)}
                {assessment.salary.evidence.length > 0 && (
                  <ul className="mt-1 space-y-1" aria-label="Salary evidence">
                    {assessment.salary.evidence.map((detail) => (
                      <li key={detail}>Evidence: “{detail}”</li>
                    ))}
                  </ul>
                )}
              </dd>
            </div>
            <div className="rounded-lg border border-border/70 bg-background/45 p-2.5">
              <dt className="flex flex-wrap items-center justify-between gap-2 font-medium text-foreground">
                Experience fact
                <span
                  aria-label={`Experience decision: ${factDecisionLabel(experienceDecision)}`}
                  className={cn(
                    "rounded-full px-2 py-0.5 text-caption font-medium",
                    factDecisionClass(experienceDecision),
                  )}
                >
                  {factDecisionLabel(experienceDecision)}
                </span>
              </dt>
              <dd className="mt-1 text-muted-foreground">
                {experienceFactLabel(assessment)}
                {assessment.experience.evidence.length > 0 && (
                  <ul className="mt-1 space-y-1" aria-label="Experience evidence">
                    {assessment.experience.evidence.map((detail) => (
                      <li key={detail}>Evidence: “{detail}”</li>
                    ))}
                  </ul>
                )}
              </dd>
            </div>
          </dl>
          {assessment.blockers.length > 0 && (
            <ul className="mt-2 space-y-1 text-destructive">
              {assessment.blockers.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          )}
          {assessment.matchedSkills.length > 0 && (
            <p className="mt-2">
              <span className="font-medium">Skills found:</span>{" "}
              {assessment.matchedSkills.join(", ")}
            </p>
          )}
          {assessment.missingSkills.length > 0 && (
            <p className="mt-1 text-muted-foreground">
              Not found in available JD text: {assessment.missingSkills.join(", ")}
            </p>
          )}
          {assessment.reviewReasons.length > 0 && (
            <p className="mt-1 text-muted-foreground">{assessment.reviewReasons.join(" ")}</p>
          )}
        </div>
      )}

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
  initialProfileSkills,
}: {
  initialJobs: JobCatalogueEntry[];
  initialRuns: JobSearchRunSummary[];
  initialSourceHealth: JobSourceHealthSummary[];
  initialSavedSearches: SavedJobSearch[];
  initialProfileSkills: string[];
}) {
  const initialActiveSearch = initialSavedSearches[0] ?? null;
  const [jobs, setJobs] = useState(initialJobs);
  const [runs, setRuns] = useState(initialRuns);
  const [sourceHealth, setSourceHealth] = useState(initialSourceHealth);
  const [activeSavedSearch, setActiveSavedSearch] = useState<SavedJobSearch | null>(
    initialActiveSearch,
  );
  const [query, setQuery] = useState(initialActiveSearch?.criteria.query ?? "");
  const [locationScope, setLocationScope] = useState<JobLocationScope>(
    initialActiveSearch?.criteria.locationScope ?? "remote-us",
  );
  const [includeUnknown, setIncludeUnknown] = useState(
    initialActiveSearch?.criteria.unknownLocationPolicy !== "exclude",
  );
  const [showSkipped, setShowSkipped] = useState(false);
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
  const assessedJobs = useMemo(() => {
    const filtered = jobs
      .filter(
        (entry) =>
          matchesQuery(entry.posting, criteria.query) &&
          matchesLocationCriteria(entry.posting, criteria),
      )
      .map((entry) => ({
        entry,
        assessment: activeSavedSearch
          ? assessJobMatch(
              entry.posting,
              activeSavedSearch.criteria.query,
              activeSavedSearch.match,
              {
                profileSkills: initialProfileSkills,
              },
            )
          : undefined,
      }));
    if (!activeSavedSearch) return filtered;
    return filtered.sort((left, right) => {
      if (left.assessment!.verdict === "skip" && right.assessment!.verdict !== "skip") return 1;
      if (left.assessment!.verdict !== "skip" && right.assessment!.verdict === "skip") return -1;
      return right.assessment!.score - left.assessment!.score;
    });
  }, [activeSavedSearch, criteria, initialProfileSkills, jobs]);
  const skippedCount = assessedJobs.filter((item) => item.assessment?.verdict === "skip").length;
  const visibleJobs = showSkipped
    ? assessedJobs
    : assessedJobs.filter((item) => item.assessment?.verdict !== "skip");
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

  function activateSavedSearch(search: SavedJobSearch | null) {
    setActiveSavedSearch(search);
    setShowSkipped(false);
    if (!search) return;
    setQuery(search.criteria.query);
    setLocationScope(search.criteria.locationScope ?? "any");
    setIncludeUnknown(search.criteria.unknownLocationPolicy !== "exclude");
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
                  onChange={(event) => {
                    setQuery(event.target.value);
                    setActiveSavedSearch(null);
                  }}
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
                onChange={(event) => {
                  setLocationScope(event.target.value as JobLocationScope);
                  setActiveSavedSearch(null);
                }}
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
                onChange={(event) => {
                  setIncludeUnknown(event.target.checked);
                  setActiveSavedSearch(null);
                }}
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
                setActiveSavedSearch(null);
                setShowSkipped(false);
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
        profileSkills={initialProfileSkills}
        onRunComplete={refreshAfterSearch}
        activeSearchId={activeSavedSearch?.id ?? null}
        onActivate={activateSavedSearch}
      />

      <section aria-labelledby="job-results-heading">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 id="job-results-heading" className="text-body font-semibold text-muted-foreground">
              {activeSavedSearch ? `${activeSavedSearch.name} shortlist` : "Job catalogue"}
            </h2>
            {activeSavedSearch && (
              <p className="mt-0.5 text-caption text-muted-foreground">
                Hard blockers first, then ranked by visible role and skill evidence. No AI call.
              </p>
            )}
          </div>
          <div className="flex items-center gap-3">
            {activeSavedSearch && skippedCount > 0 && (
              <button
                type="button"
                onClick={() => setShowSkipped((current) => !current)}
                className="text-caption font-semibold text-primary hover:underline"
              >
                {showSkipped ? "Hide excluded" : `Show ${skippedCount} excluded`}
              </button>
            )}
            <span className="text-caption text-muted-foreground">
              {visibleJobs.length} shown · {jobs.length} saved
            </span>
          </div>
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
            {visibleJobs.map(({ entry, assessment }) => (
              <JobCard
                key={entry.posting.id}
                entry={entry}
                assessment={assessment}
                matchPreferences={activeSavedSearch?.match}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
