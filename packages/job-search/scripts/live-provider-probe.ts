import assert from "node:assert/strict";
import { createGreenhouseProvider, createLeverProvider, searchJobs } from "../src";

const specs = process.argv.slice(2);
assert.ok(
  specs.length > 0,
  'usage: npm run probe:live -w @offeros/job-search -- "greenhouse:board:Company" "lever:site:Company"',
);

const greenhouse: Array<{ token: string; company: string }> = [];
const lever: Array<{ site: string; company: string; region?: "eu" }> = [];
for (const spec of specs) {
  const match = /^(greenhouse|lever|lever-eu):([^:]+):(.+)$/.exec(spec);
  assert.ok(match, `invalid provider spec: ${spec}`);
  const [, kind, tenant, company] = match;
  assert.ok(kind && tenant && company);
  if (kind === "greenhouse") greenhouse.push({ token: tenant, company });
  else lever.push({ site: tenant, company, ...(kind === "lever-eu" ? { region: "eu" } : {}) });
}

const providers = [
  ...(greenhouse.length > 0 ? [createGreenhouseProvider(greenhouse)] : []),
  ...(lever.length > 0 ? [createLeverProvider(lever)] : []),
];
const result = await searchJobs(providers, { maxResults: 5_000 });
assert.ok(result.postings.length > 0, "live providers returned no normalized postings");
assert.ok(
  result.providerRuns.some((run) => run.status !== "failed"),
  "every live provider failed",
);
assert.ok(
  result.postings.every((posting) =>
    posting.sources.some((source) => source.kind === "official-ats"),
  ),
  "a live posting lost its official ATS provenance",
);

console.log(
  JSON.stringify(
    {
      providerRuns: result.providerRuns,
      stages: result.stages,
      postings: result.postings.length,
      sample: result.postings.slice(0, 3).map((posting) => ({
        id: posting.id,
        title: posting.title,
        company: posting.company,
        location: posting.location ?? null,
        workplace: posting.workplace,
        applyUrl: posting.applyUrl,
      })),
    },
    null,
    2,
  ),
);
