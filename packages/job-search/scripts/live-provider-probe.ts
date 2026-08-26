import assert from "node:assert/strict";
import {
  createAshbyProvider,
  createFreehireProvider,
  createGreenhouseProvider,
  createLeverProvider,
  searchJobs,
} from "../src";

const args = process.argv.slice(2);
const remoteUs = args.includes("--remote-us");
const specs = args.filter((arg) => arg !== "--remote-us");
assert.ok(
  specs.length > 0,
  'usage: npm run probe:live -w @offeros/job-search -- [--remote-us] "greenhouse:board:Company" "lever:site:Company" "ashby:board:Company" freehire',
);

const greenhouse: Array<{ token: string; company: string }> = [];
const lever: Array<{ site: string; company: string; region?: "eu" }> = [];
const ashby: Array<{ name: string; company: string }> = [];
let freehire = false;
for (const spec of specs) {
  if (spec === "freehire") {
    freehire = true;
    continue;
  }
  const match = /^(greenhouse|lever|lever-eu|ashby):([^:]+):(.+)$/.exec(spec);
  assert.ok(match, `invalid provider spec: ${spec}`);
  const [, kind, tenant, company] = match;
  assert.ok(kind && tenant && company);
  if (kind === "greenhouse") greenhouse.push({ token: tenant, company });
  else if (kind === "ashby") ashby.push({ name: tenant, company });
  else lever.push({ site: tenant, company, ...(kind === "lever-eu" ? { region: "eu" } : {}) });
}

const providers = [
  ...(greenhouse.length > 0 ? [createGreenhouseProvider(greenhouse)] : []),
  ...(lever.length > 0 ? [createLeverProvider(lever)] : []),
  ...(ashby.length > 0 ? [createAshbyProvider(ashby)] : []),
  ...(freehire ? [createFreehireProvider()] : []),
];
const result = await searchJobs(providers, {
  ...(remoteUs ? { locationScope: "remote-us" as const } : {}),
  maxResults: 100,
});
assert.ok(result.postings.length > 0, "live providers returned no normalized postings");
assert.ok(
  result.providerRuns.some((run) => run.status !== "failed"),
  "every live provider failed",
);
assert.ok(
  result.postings.every((posting) => posting.sources.length > 0),
  "a live posting lost its source provenance",
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
