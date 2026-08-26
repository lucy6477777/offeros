import { savedJobSearchDefinitionSchema } from "@offeros/job-search";
import { getDb } from "@/server/db/client";
import { handle, ok } from "@/server/http/envelope";
import {
  createSavedJobSearch,
  listSavedJobSearches,
} from "@/server/repositories/saved-job-search-repo";

export const runtime = "nodejs";

export async function GET() {
  return handle(() => ok(listSavedJobSearches(getDb())));
}

export async function POST(request: Request) {
  return handle(async () => {
    const definition = savedJobSearchDefinitionSchema.parse(await request.json());
    return ok(createSavedJobSearch(getDb(), definition));
  });
}
