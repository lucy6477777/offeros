import { getDb } from "@/server/db/client";
import { handle, notFound, ok } from "@/server/http/envelope";
import {
  getSavedJobSearch,
  recordSavedJobSearchRun,
} from "@/server/repositories/saved-job-search-repo";
import { executeJobSearch } from "@/server/services/job-search-service";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(_request: Request, ctx: Ctx) {
  return handle(async () => {
    const { id } = await ctx.params;
    const db = getDb();
    const savedSearch = getSavedJobSearch(db, id);
    if (!savedSearch) return notFound("saved search");

    const result = await executeJobSearch(db, savedSearch);
    const updated = recordSavedJobSearchRun(db, id, result.run);
    return ok({ ...result, savedSearch: updated! });
  });
}
