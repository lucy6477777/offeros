# `@offeros/job-search`

Provider-based job discovery for OfferOS. This package owns board-level search,
normalization, cross-source deduplication, and per-run diagnostics. The existing
web `extract/` ladder still owns deep reads of one known posting.

The first providers use the public, unauthenticated list endpoints documented by
[Greenhouse](https://developer.greenhouse.io/job-board.html) and
[Lever](https://github.com/lever/postings-api). They only issue `GET` requests;
application submission is outside this package.

```ts
import { createGreenhouseProvider, createLeverProvider, searchJobs } from "@offeros/job-search";

const result = await searchJobs(
  [
    createGreenhouseProvider([{ token: "clear", company: "CLEAR - Corporate" }]),
    createLeverProvider([{ site: "fundrise", company: "Fundrise" }]),
  ],
  { query: "software engineer", maxResults: 100 },
);
```

`result.providerRuns` records success, partial success, and failure for every
provider. `result.stages` records the survivor count after normalization,
criteria matching, deduplication, and the final limit, so jobs never disappear
without an observable reason.

Current boundary: results are returned in memory. SQLite persistence, saved
searches, source health history, US/Remote hard filters, and the Web UI are the
next Phase 2 slices.

To check current public payloads without writing anywhere:

```bash
npm run probe:live -w @offeros/job-search -- \
  "greenhouse:clear:CLEAR - Corporate" \
  "lever:fundrise:Fundrise"
```
