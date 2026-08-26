import { savedJobSearchDefinitionSchema } from "@offeros/job-search";
import { getDb } from "@/server/db/client";
import { handle, notFound, ok } from "@/server/http/envelope";
import {
  deleteSavedJobSearch,
  updateSavedJobSearch,
} from "@/server/repositories/saved-job-search-repo";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function PUT(request: Request, ctx: Ctx) {
  return handle(async () => {
    const { id } = await ctx.params;
    const definition = savedJobSearchDefinitionSchema.parse(await request.json());
    const updated = updateSavedJobSearch(getDb(), id, definition);
    return updated ? ok(updated) : notFound("saved search");
  });
}

export async function DELETE(_request: Request, ctx: Ctx) {
  return handle(async () => {
    const { id } = await ctx.params;
    return deleteSavedJobSearch(getDb(), id) ? ok({ id }) : notFound("saved search");
  });
}
