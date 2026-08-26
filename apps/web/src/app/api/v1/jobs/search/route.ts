import { z } from "zod";
import { jobSearchCriteriaSchema, jobSearchSourcesSchema } from "@offeros/job-search";
import { getDb } from "@/server/db/client";
import { handle, ok } from "@/server/http/envelope";
import { listSourceHealth, listStoredSearchRuns } from "@/server/repositories/job-search-repo";
import { executeJobSearch } from "@/server/services/job-search-service";

export const runtime = "nodejs";

const searchRequestSchema = z
  .object({
    criteria: jobSearchCriteriaSchema.default({}),
    sources: jobSearchSourcesSchema,
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
    return ok(await executeJobSearch(getDb(), input));
  });
}
