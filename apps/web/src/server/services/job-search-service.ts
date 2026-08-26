import {
  createAshbyProvider,
  createFreehireProvider,
  createGreenhouseProvider,
  createLeverProvider,
  hasConfiguredJobSource,
  jobSearchCriteriaSchema,
  jobSearchSourcesSchema,
  searchJobs,
  type JobSearchCriteria,
  type JobSearchProvider,
  type JobSearchSources,
} from "@offeros/job-search";
import type { Db } from "../db/client";
import { saveJobSearchResult } from "../repositories/job-search-repo";

export class ServiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ServiceError";
  }
}

export type ExecuteJobSearchInput = {
  criteria: JobSearchCriteria;
  sources: JobSearchSources;
};

/** The one execution path for ad-hoc and saved searches. Persisting happens
 * here, so no caller can report a completed run that is absent after reload. */
export async function executeJobSearch(db: Db, rawInput: ExecuteJobSearchInput) {
  const criteria = jobSearchCriteriaSchema.parse(rawInput.criteria);
  const sources = jobSearchSourcesSchema.parse(rawInput.sources);
  if (!hasConfiguredJobSource(sources)) {
    throw new ServiceError("at least one job source is required");
  }

  const providers: JobSearchProvider[] = [];
  if (sources.greenhouse.length > 0) {
    providers.push(createGreenhouseProvider(sources.greenhouse));
  }
  if (sources.lever.length > 0) providers.push(createLeverProvider(sources.lever));
  if (sources.ashby.length > 0) providers.push(createAshbyProvider(sources.ashby));
  if (sources.freehire) providers.push(createFreehireProvider());

  const result = await searchJobs(providers, criteria);
  const stored = saveJobSearchResult(db, { criteria, result });
  return {
    run: stored.run,
    postings: stored.postings,
    providerRuns: result.providerRuns,
    stages: result.stages,
  };
}
