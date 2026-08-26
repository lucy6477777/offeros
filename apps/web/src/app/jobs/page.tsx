import { AddJobDialog } from "@/components/agent/add-job-dialog";
import { JobSearchClient } from "@/components/jobs/job-search-client";
import { resolveJobMatchSkills } from "@offeros/job-search";
import { getDb, type Db } from "@/server/db/client";
import {
  listSourceHealth,
  listStoredJobs,
  listStoredSearchRuns,
} from "@/server/repositories/job-search-repo";
import { listSavedJobSearches } from "@/server/repositories/saved-job-search-repo";
import { getProfile } from "@/server/repositories/profile-repo";

export const dynamic = "force-dynamic";

export function getJobMatchingProfileSkills(db: Db): string[] {
  return resolveJobMatchSkills(
    { skillSource: "profile", prioritySkills: [] },
    getProfile(db)?.skills ?? [],
  ).profileSkills;
}

/** One place for public discovery and everything already captured locally. */
export default function JobsPage() {
  const db = getDb();
  const profileSkills = getJobMatchingProfileSkills(db);

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
        initialSavedSearches={listSavedJobSearches(db)}
        initialProfileSkills={profileSkills}
      />
    </main>
  );
}
