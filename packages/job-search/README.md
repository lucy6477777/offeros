# `@offeros/job-search`

Provider-based job discovery for OfferOS. This package owns board-level search,
normalization, cross-source deduplication, and per-run diagnostics. The existing
web `extract/` ladder still owns deep reads of one known posting.

The providers use public, unauthenticated read endpoints documented by
[Greenhouse](https://developer.greenhouse.io/job-board.html),
[Lever](https://github.com/lever/postings-api),
[Ashby](https://developers.ashbyhq.com/docs/public-job-posting-api), and
[freehire](https://freehire.me/docs/api/jobs/agent-jobs-search-get). They only
issue `GET` requests; application submission is outside this package.

```ts
import {
  createAshbyProvider,
  createFreehireProvider,
  createGreenhouseProvider,
  createLeverProvider,
  searchJobs,
} from "@offeros/job-search";

const result = await searchJobs(
  [
    createGreenhouseProvider([{ token: "clear", company: "CLEAR - Corporate" }]),
    createLeverProvider([{ site: "fundrise", company: "Fundrise" }]),
    createAshbyProvider([{ name: "Ashby", company: "Ashby" }]),
    createFreehireProvider(),
  ],
  {
    query: "software engineer",
    locationScope: "remote-us",
    unknownLocationPolicy: "include",
    maxResults: 100,
  },
);
```

`result.providerRuns` records success, partial success, and failure for every
provider. `result.stages` records the survivor count after normalization,
text criteria, location eligibility, deduplication, and the final limit. The
location stage separates `explicit-non-us`, `not-remote`, and unknown-data
decisions, so jobs never disappear without an observable reason.

`locationScope: "united-states"` excludes jobs explicitly outside the US.
`locationScope: "remote-us"` also excludes explicitly hybrid/on-site jobs.
Unknown country or workplace data stays visible by default; set
`unknownLocationPolicy: "exclude"` for strict filtering. freehire receives the
equivalent `countries=US` and `work_mode=remote` filters upstream, and OfferOS
still rechecks every normalized result locally. If freehire reports those
parameters as ignored, the provider fails closed instead of returning a broad
result set.

User-triggered captures use the same canonical contract:

```ts
import { createCapturedJobPosting } from "@offeros/job-search";

const posting = createCapturedJobPosting({
  source: "browser",
  url: "https://jobs.example.com/acme/123?utm_source=panel",
  title: "Platform Engineer",
  company: "Acme",
  description: "The rendered job description…",
});
```

The Web app upserts these through its job-search repository without creating a
fake search run. Existing manual URL, extension “Add this job”, and instant-fill
entrypoints all feed this path. Repeating a capture advances `lastSeenAt`; a
manual URL and browser capture of the same posting merge into one job while
retaining both provenance records.

The Web app persists normalized results, source provenance, run diagnostics,
survivor order, and rolling provider health in its existing local SQLite
database. `POST /api/v1/jobs/search` executes configured Greenhouse, Lever,
Ashby, and optional freehire providers. `GET /api/v1/jobs` queries canonical
jobs without touching the network, and `GET /api/v1/jobs/search` returns recent
runs and provider health.

The Web `/jobs` page renders the local catalogue with source provenance,
posting and last-check timestamps, liveness, and the original Apply Link.
Keywords and US/Remote controls filter local data immediately. A separate,
explicit “Search public jobs” action runs freehire and then re-reads the
persisted catalogue and source health, so the UI never presents an unpersisted
network response as local state.

Saved Searches persist the keywords, US/Remote guard, and company Greenhouse,
Lever, and Ashby boards as one repeatable watchlist. They also own deterministic
shortlist rules: priority skills, excluded keywords and companies, and a title
seniority ceiling. A saved search can also hold explicit US work-authorization
and employer-sponsorship answers. `extractJobEligibilityFacts` reads only the
posting text and keeps sponsorship as available, unavailable, ambiguous, or
not mentioned. `assessJobMatch` applies explicit blockers first, then ranks the
surviving jobs by visible role and skill evidence. It rejects an eligibility
case only when the user's saved answer and the posting's quoted statement
directly conflict; silence, conditional wording, and citizenship/residency
restrictions remain reviewable. These settings screen jobs only and are never
used to answer an application form. The score is derived on read and is not
persisted as if it were a new fact.

Current boundary: the hosted freehire endpoint is fixed in the Web route to
avoid arbitrary remote URL fetches; library callers may explicitly configure an
HTTPS self-hosted instance. Scheduled scans, Profile-skill reuse, experience and
salary rules, and AI rubric calibration remain later slices.

To check current public payloads without writing anywhere:

```bash
npm run probe:live -w @offeros/job-search -- \
  --remote-us \
  "greenhouse:clear:CLEAR - Corporate" \
  "lever:fundrise:Fundrise" \
  "ashby:Ashby:Ashby" \
  freehire
```
