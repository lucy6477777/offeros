import { jobSearchCriteriaSchema } from "@offeros/job-search";
import { getDb } from "@/server/db/client";
import { handle, ok } from "@/server/http/envelope";
import { listStoredJobs } from "@/server/repositories/job-search-repo";

export const runtime = "nodejs";

/** Query the local canonical job store. Full provider scans are triggered by
 * POST /api/v1/jobs/search; this read path never touches the network. */
export async function GET(request: Request) {
  return handle(() => {
    const params = new URL(request.url).searchParams;
    const query = params.get("query")?.trim();
    const rawMaxResults = params.get("maxResults");
    const locationScope = params.get("locationScope")?.trim();
    const unknownLocationPolicy = params.get("unknownLocationPolicy")?.trim();
    const criteria = jobSearchCriteriaSchema.parse({
      ...(query ? { query } : {}),
      ...(locationScope ? { locationScope } : {}),
      ...(unknownLocationPolicy ? { unknownLocationPolicy } : {}),
      ...(rawMaxResults === null ? {} : { maxResults: Number(rawMaxResults) }),
    });
    return ok(listStoredJobs(getDb(), criteria));
  });
}
