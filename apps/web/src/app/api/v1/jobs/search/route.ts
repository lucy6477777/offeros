import { z } from "zod";
import {
  createAshbyProvider,
  createFreehireProvider,
  createGreenhouseProvider,
  createLeverProvider,
  jobSearchCriteriaSchema,
  searchJobs,
  type JobSearchProvider,
} from "@offeros/job-search";
import { getDb } from "@/server/db/client";
import { badRequest, handle, ok } from "@/server/http/envelope";
import {
  listSourceHealth,
  listStoredSearchRuns,
  saveJobSearchResult,
} from "@/server/repositories/job-search-repo";

export const runtime = "nodejs";

const greenhouseBoardSchema = z
  .object({
    token: z.string().trim().min(1).max(200),
    company: z.string().trim().min(1).max(300),
  })
  .strict();

const leverSiteSchema = z
  .object({
    site: z.string().trim().min(1).max(200),
    company: z.string().trim().min(1).max(300),
    region: z.enum(["global", "eu"]).optional(),
  })
  .strict();

const ashbyBoardSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    company: z.string().trim().min(1).max(300),
  })
  .strict();

const searchRequestSchema = z
  .object({
    criteria: jobSearchCriteriaSchema.default({}),
    sources: z
      .object({
        greenhouse: z.array(greenhouseBoardSchema).max(50).default([]),
        lever: z.array(leverSiteSchema).max(50).default([]),
        ashby: z.array(ashbyBoardSchema).max(50).default([]),
        freehire: z.boolean().default(false),
      })
      .strict(),
  })
  .strict();

const historyLimitSchema = z.coerce.number().int().min(1).max(100).default(20);

/** Recent persisted runs plus rolling provider health. This is a local read;
 * it never triggers a provider request. */
export async function GET(request: Request) {
  return handle(() => {
    const limit = historyLimitSchema.parse(
      new URL(request.url).searchParams.get("limit") ?? undefined,
    );
    const db = getDb();
    return ok({ runs: listStoredSearchRuns(db, limit), sourceHealth: listSourceHealth(db) });
  });
}

/** Execute configured public ATS providers, preserve partial failures, and
 * atomically persist the completed result before returning it. */
export async function POST(request: Request) {
  return handle(async () => {
    const input = searchRequestSchema.parse(await request.json());
    const providers: JobSearchProvider[] = [];
    if (input.sources.greenhouse.length > 0) {
      providers.push(createGreenhouseProvider(input.sources.greenhouse));
    }
    if (input.sources.lever.length > 0) {
      providers.push(createLeverProvider(input.sources.lever));
    }
    if (input.sources.ashby.length > 0) {
      providers.push(createAshbyProvider(input.sources.ashby));
    }
    if (input.sources.freehire) providers.push(createFreehireProvider());
    if (providers.length === 0) return badRequest("at least one job source is required");

    const result = await searchJobs(providers, input.criteria);
    const stored = saveJobSearchResult(getDb(), { criteria: input.criteria, result });
    return ok({
      run: stored.run,
      postings: stored.postings,
      providerRuns: result.providerRuns,
      stages: result.stages,
    });
  });
}
