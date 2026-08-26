import { AddJobDialog } from "@/components/agent/add-job-dialog";
import { JobSearchClient } from "@/components/jobs/job-search-client";
import { getDb } from "@/server/db/client";
import {
  listSourceHealth,
  listStoredJobs,
  listStoredSearchRuns,
} from "@/server/repositories/job-search-repo";

export const dynamic = "force-dynamic";

/** One place for public discovery and everything already captured locally. */
export default function JobsPage() {
  const db = getDb();

  return (
    <main className="mx-auto w-full max-w-[1120px] px-6 py-10">
      <header className="mb-8 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-heading font-semibold text-foreground">Jobs</h1>
          <p className="mt-1 text-body text-muted-foreground">
            Search public listings, then keep every useful posting in your local catalogue.
          </p>
        </div>
        <AddJobDialog />
      </header>

      <JobSearchClient
        initialJobs={listStoredJobs(db)}
        initialRuns={listStoredSearchRuns(db, 10)}
        initialSourceHealth={listSourceHealth(db)}
      />
    </main>
  );
}
