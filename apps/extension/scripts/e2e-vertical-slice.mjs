import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { once } from "node:events";
import { chromium } from "playwright";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SCRIPT_DIR, "../../..");
const WEB = path.join(ROOT, "apps/web");
const EXTENSION = path.join(ROOT, "apps/extension/.output/chrome-mv3");
const NEXT = path.join(ROOT, "node_modules/next/dist/bin/next");
const BASE_URL = "http://127.0.0.1:3000";

const PROFILE = {
  personal: {
    name: "Jordan Rivera",
    email: "jordan@example.com",
    phone: "555-0100",
    city: "Austin",
    links: { linkedin: "https://linkedin.com/in/jordan" },
  },
  skills: ["Python", "TypeScript"],
  education: [],
  experience: [],
};

const fixtures = [
  {
    ats: "greenhouse",
    url: "https://boards.greenhouse.io/acme/jobs/101",
    title: "Backend Engineer",
    company: "Acme Cloud",
  },
  {
    ats: "lever",
    url: "https://jobs.lever.co/globex/202/apply",
    title: "Platform Engineer",
    company: "Globex",
  },
];

const SUGGESTION_FIXTURE = {
  ats: "greenhouse",
  url: "https://boards.greenhouse.io/acme/jobs/303",
  title: "Senior Backend Engineer",
  company: "Acme Cloud",
};
const SUGGESTION_QUESTION = "Which of your projects is most relevant to this role?";
const SUGGESTION_VALUE =
  "I led a TypeScript ingestion rewrite that reduced nightly batch latency by 40%.";

const log = (key, value) => console.log(`VERTICAL ${key}: ${value}`);

function fixtureHtml(fixture) {
  const posting = JSON.stringify({
    "@context": "https://schema.org/",
    "@type": "JobPosting",
    title: fixture.title,
    hiringOrganization: { name: fixture.company },
    description: `<p>${fixture.company} needs ${fixture.title} experience with TypeScript.</p>`,
  });
  return `<!doctype html><html><head><title>${fixture.title} — ${fixture.company}</title>
<script type="application/ld+json">${posting}</script></head><body><main>
<h1>${fixture.title}</h1><form id="application">
  <label for="name">Full name *</label><input id="name" name="name" required />
  <label for="email">Email *</label><input id="email" name="email" type="email" required />
  <label for="phone">Phone</label><input id="phone" name="phone" type="tel" />
  <button id="submit" type="submit">Submit application</button>
</form></main><script>
window.__offerosSubmitted = false;
document.querySelector("form").addEventListener("submit", (event) => {
  event.preventDefault();
  window.__offerosSubmitted = true;
});
</script></body></html>`;
}

function suggestionFixtureHtml() {
  const posting = JSON.stringify({
    "@context": "https://schema.org/",
    "@type": "JobPosting",
    title: SUGGESTION_FIXTURE.title,
    hiringOrganization: { name: SUGGESTION_FIXTURE.company },
    description:
      "<p>Build TypeScript ingestion systems. The applicant should describe one relevant project.</p>",
  });
  return `<!doctype html><html><head><title>${SUGGESTION_FIXTURE.title} — ${SUGGESTION_FIXTURE.company}</title>
<script type="application/ld+json">${posting}</script></head><body><main>
<h1>${SUGGESTION_FIXTURE.title}</h1><form id="application">
  <label for="project">${SUGGESTION_QUESTION} *</label>
  <textarea id="project" name="relevant_project" required></textarea>
  <button id="submit" type="submit">Submit application</button>
</form></main><script>
window.__offerosSubmitted = false;
document.querySelector("form").addEventListener("submit", (event) => {
  event.preventDefault();
  window.__offerosSubmitted = true;
});
</script></body></html>`;
}

async function waitForServer(server, output) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (server.exitCode !== null) {
      throw new Error(`OfferOS web server exited early (${server.exitCode})\n${output.text}`);
    }
    try {
      const response = await fetch(`${BASE_URL}/api/v1/profile`);
      if (response.ok) return;
    } catch {
      // The server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`OfferOS web server did not become ready\n${output.text}`);
}

async function api(pathname, init) {
  const response = await fetch(`${BASE_URL}/api/v1${pathname}`, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  const body = await response.json();
  assert.equal(body.success, true, `${pathname}: ${body.errorMsg ?? response.status}`);
  return body.result;
}

async function extensionApi(serviceWorker, pathname, init) {
  return serviceWorker.evaluate(
    async ({ url, request }) => {
      const response = await fetch(url, {
        ...request,
        headers: { "content-type": "application/json", ...(request?.headers ?? {}) },
      });
      return { status: response.status, body: await response.json() };
    },
    { url: `${BASE_URL}/api/v1${pathname}`, request: init },
  );
}

async function runFixture(context, serviceWorker, fixture, primaryResumeId) {
  const page = await context.newPage();
  await page.route(fixture.url, (route) =>
    route.fulfill({ status: 200, contentType: "text/html", body: fixtureHtml(fixture) }),
  );
  await page.goto(fixture.url, { waitUntil: "load" });
  await page.waitForTimeout(600);

  const tabId = await serviceWorker.evaluate(async (url) => {
    const tabs = await chrome.tabs.query({});
    return tabs.find((tab) => tab.url === url)?.id ?? null;
  }, fixture.url);
  assert.notEqual(tabId, null, `${fixture.ats}: application tab not found`);

  const scan = await serviceWorker.evaluate(
    async (id) => chrome.tabs.sendMessage(id, { kind: "OFFEROS_ENGINE_SCAN" }),
    tabId,
  );
  assert.equal(scan.ok, true, `${fixture.ats}: scan failed`);
  assert.equal(scan.atsId, fixture.ats);

  const capture = await serviceWorker.evaluate(
    async (id) => chrome.tabs.sendMessage(id, { kind: "OFFEROS_ENGINE_CAPTURE_JD" }),
    tabId,
  );
  assert.equal(capture.structuredTitle, fixture.title);
  assert.equal(capture.structuredCompany, fixture.company);

  const instant = await extensionApi(serviceWorker, "/agent/fill/instant", {
    method: "POST",
    body: JSON.stringify({
      jobInfo: {
        jobId: `e2e-${fixture.ats}`,
        jobTitle: capture.structuredTitle,
        companyName: capture.structuredCompany,
        applyLink: capture.url,
      },
      jdText: capture.jd,
    }),
  });
  assert.equal(instant.status, 200, `${fixture.ats}: extension-origin request rejected`);
  assert.equal(instant.body.success, true, instant.body.errorMsg);
  const bundle = instant.body.result;
  assert.equal(bundle.resumeId, primaryResumeId, `${fixture.ats}: primary résumé not resolved`);

  const selectedResume = await extensionApi(
    serviceWorker,
    `/applications/${bundle.applicationId}`,
    {
      method: "PATCH",
      body: JSON.stringify({ resumeId: primaryResumeId, attachResume: "original" }),
    },
  );
  assert.equal(selectedResume.status, 200);
  assert.equal(selectedResume.body.result.resumeId, primaryResumeId);

  const descriptorByName = new Map(
    scan.descriptors.map((descriptor) => [descriptor.name, descriptor]),
  );
  const attempted = [
    ["name", bundle.fillProfile.personal.name],
    ["email", bundle.fillProfile.personal.email],
    ["phone", bundle.fillProfile.personal.phone],
  ].map(([name, value]) => {
    const descriptor = descriptorByName.get(name);
    assert.ok(descriptor, `${fixture.ats}: ${name} descriptor missing`);
    assert.ok(value, `${fixture.ats}: ${name} profile value missing`);
    return { descriptor, value };
  });

  const fill = await serviceWorker.evaluate(
    async ({ id, values }) => chrome.tabs.sendMessage(id, { kind: "OFFEROS_ENGINE_FILL", values }),
    {
      id: tabId,
      values: attempted.map(({ descriptor, value }) => ({ fieldId: descriptor.fieldId, value })),
    },
  );
  assert.equal(fill.ok, true);
  assert.equal(fill.filled, attempted.length, `${fixture.ats}: not every safe field filled`);

  const landed = await page.evaluate(() => ({
    name: document.querySelector('input[name="name"]').value,
    email: document.querySelector('input[name="email"]').value,
    phone: document.querySelector('input[name="phone"]').value,
    submitted: window.__offerosSubmitted,
  }));
  assert.deepEqual(landed, {
    name: PROFILE.personal.name,
    email: PROFILE.personal.email,
    phone: PROFILE.personal.phone,
    submitted: false,
  });

  const outcomes = new Map(fill.outcomes ?? []);
  const reports = attempted.map(({ descriptor, value }) => {
    const write = outcomes.get(descriptor.fieldId);
    const outcome = typeof write === "string" ? write : write?.outcome;
    const reason = typeof write === "object" && write !== null ? (write.reason ?? "") : "";
    const before = typeof write === "object" && write !== null ? write.before : undefined;
    const after = typeof write === "object" && write !== null ? write.after : undefined;
    return {
      fieldId: descriptor.fieldId,
      label: descriptor.label,
      classifiedType: descriptor.name,
      status: "fillable",
      value,
      source: "personal",
      reason: reason || "filled from the local profile",
      outcome,
      confidence: "high",
      before: before ?? descriptor.currentValue ?? "",
      after: after ?? value,
      required: descriptor.required === true,
      page: capture.url,
      ...(descriptor.questionKey ? { questionKey: descriptor.questionKey } : {}),
    };
  });
  assert.ok(reports.every((report) => report.outcome === "filled"));

  const report = await extensionApi(serviceWorker, `/agent/tasks/${bundle.taskId}/fill/report`, {
    method: "POST",
    body: JSON.stringify({ reports, complete: true, handoffId: bundle.handoffId }),
  });
  assert.equal(report.status, 200);
  assert.equal(report.body.success, true, report.body.errorMsg);

  const task = await extensionApi(serviceWorker, `/agent/tasks/${bundle.taskId}`);
  assert.equal(task.body.success, true);
  assert.equal(task.body.result.task.fieldReports.length, attempted.length);
  for (const saved of task.body.result.task.fieldReports) {
    assert.equal(saved.confidence, "high");
    assert.equal(saved.before, "");
    assert.ok(saved.after, `${fixture.ats}: saved report lost its observed after value`);
  }

  const tracked = await extensionApi(
    serviceWorker,
    `/applications?jobUrl=${encodeURIComponent(fixture.url)}`,
  );
  assert.equal(tracked.status, 200);
  assert.equal(tracked.body.success, true);
  assert.equal(tracked.body.result.length, 1);
  assert.equal(tracked.body.result[0].jobInfo.jobTitle, fixture.title);
  assert.equal(tracked.body.result[0].jobInfo.companyName, fixture.company);

  await page.reload({ waitUntil: "load" });
  assert.equal(await page.evaluate(() => window.__offerosSubmitted), false);

  const persistedApplication = await extensionApi(
    serviceWorker,
    `/applications/${bundle.applicationId}`,
  );
  assert.equal(persistedApplication.body.success, true);
  assert.equal(persistedApplication.body.result.resumeId, primaryResumeId);
  assert.equal(persistedApplication.body.result.attachResume, "original");

  const pending = await extensionApi(serviceWorker, "/agent/fill/pending");
  assert.equal(pending.body.success, true);
  assert.equal(
    pending.body.result.some((ticket) => ticket.taskId === bundle.taskId),
    false,
    `${fixture.ats}: completed handoff remained pending`,
  );

  log(`${fixture.ats}_scan_fields`, scan.descriptors.length);
  log(`${fixture.ats}_filled`, fill.filled);
  log(`${fixture.ats}_tracked`, tracked.body.result.length);
  log(`${fixture.ats}_evidence`, task.body.result.task.fieldReports.length);
  log(
    `${fixture.ats}_resume_linked`,
    persistedApplication.body.result.resumeId === primaryResumeId,
  );
  log(`${fixture.ats}_no_submit`, !landed.submitted);
  await page.close();
}

/**
 * Exercise the human approval boundary through the actual built side panel.
 * The intercepted endpoint stands in only for the model: task claiming, panel
 * state, DOM messaging, verified write and report persistence all stay real.
 */
async function runSuggestionGate(context, serviceWorker, extensionId) {
  const page = await context.newPage();
  await page.route(SUGGESTION_FIXTURE.url, (route) =>
    route.fulfill({ status: 200, contentType: "text/html", body: suggestionFixtureHtml() }),
  );
  await page.goto(SUGGESTION_FIXTURE.url, { waitUntil: "load" });
  await page.waitForTimeout(600);

  const tabId = await serviceWorker.evaluate(async (url) => {
    const tabs = await chrome.tabs.query({});
    return tabs.find((tab) => tab.url === url)?.id ?? null;
  }, SUGGESTION_FIXTURE.url);
  assert.notEqual(tabId, null, "suggestion gate: application tab not found");

  const scan = await serviceWorker.evaluate(
    async (id) => chrome.tabs.sendMessage(id, { kind: "OFFEROS_ENGINE_SCAN" }),
    tabId,
  );
  assert.equal(scan.ok, true, "suggestion gate: scan failed");
  const descriptor = scan.descriptors.find((item) => item.name === "relevant_project");
  assert.ok(descriptor, "suggestion gate: long-answer field missing from scan");

  const capture = await serviceWorker.evaluate(
    async (id) => chrome.tabs.sendMessage(id, { kind: "OFFEROS_ENGINE_CAPTURE_JD" }),
    tabId,
  );
  const instant = await extensionApi(serviceWorker, "/agent/fill/instant", {
    method: "POST",
    body: JSON.stringify({
      jobInfo: {
        jobId: "e2e-suggestion-gate",
        jobTitle: capture.structuredTitle,
        companyName: capture.structuredCompany,
        applyLink: capture.url,
      },
      jdText: capture.jd,
    }),
  });
  assert.equal(instant.status, 200);
  assert.equal(instant.body.success, true, instant.body.errorMsg);
  const bundle = instant.body.result;

  const analysisRequests = [];
  const analyzeRoute = /\/api\/v1\/agent\/tasks\/[^/]+\/fill\/analyze$/;
  await context.route(analyzeRoute, async (route) => {
    const body = route.request().postDataJSON();
    analysisRequests.push(body);
    assert.equal(body.handoffId, bundle.handoffId);
    assert.ok(
      body.fields.some((field) => field.fieldId === descriptor.fieldId),
      "suggestion gate: panel did not send the outstanding field",
    );
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "access-control-allow-origin": `chrome-extension://${extensionId}` },
      body: JSON.stringify({
        success: true,
        errorCode: 10000,
        errorMsg: null,
        result: {
          fields: [
            {
              fieldId: descriptor.fieldId,
              value: SUGGESTION_VALUE,
              source: "agent",
              reason: "your résumé describes this TypeScript ingestion project",
            },
          ],
          summary: "Prepared one grounded suggestion for review.",
        },
      }),
    });
  });

  const sidepanel = await context.newPage();
  await sidepanel.goto(`chrome-extension://${extensionId}/sidepanel.html`, { waitUntil: "load" });
  await serviceWorker.evaluate(async (id) => chrome.tabs.update(id, { active: true }), tabId);

  const questionRow = sidepanel.locator("button[data-state]", { hasText: SUGGESTION_QUESTION });
  await questionRow.waitFor({ state: "visible", timeout: 10_000 });
  assert.equal(await questionRow.getAttribute("data-state"), "manual");
  assert.equal(await page.locator("textarea[name='relevant_project']").inputValue(), "");

  await sidepanel.getByRole("button", { name: /AI analyse the remaining/ }).click();
  await sidepanel.getByText(SUGGESTION_VALUE, { exact: true }).waitFor({ timeout: 10_000 });
  assert.equal(analysisRequests.length, 1);
  assert.equal(
    await page.locator("textarea[name='relevant_project']").inputValue(),
    "",
    "suggestion gate: analysis wrote to the form before approval",
  );
  assert.equal(await questionRow.getAttribute("data-state"), "suggestion");

  await sidepanel.getByRole("button", { name: "Apply", exact: true }).click();
  await page
    .locator("textarea[name='relevant_project']")
    .waitFor({ state: "visible", timeout: 10_000 });
  await page.waitForFunction(
    ({ selector, expected }) => document.querySelector(selector)?.value === expected,
    { selector: "textarea[name='relevant_project']", expected: SUGGESTION_VALUE },
  );
  assert.equal(await questionRow.getAttribute("data-state"), "filled");
  assert.equal(await page.evaluate(() => window.__offerosSubmitted), false);

  const task = await extensionApi(serviceWorker, `/agent/tasks/${bundle.taskId}`);
  assert.equal(task.body.success, true);
  const saved = task.body.result.task.fieldReports.find(
    (report) => report.fieldId === descriptor.fieldId,
  );
  assert.ok(saved, "suggestion gate: approved suggestion was not reported");
  assert.equal(saved.source, "agent");
  assert.equal(saved.outcome, "filled");
  assert.equal(saved.confidence, "medium");
  assert.equal(saved.before, "");
  assert.equal(saved.after, SUGGESTION_VALUE);

  log("suggestion_held_before_apply", true);
  log("suggestion_applied_after_click", true);
  log("suggestion_evidence_persisted", true);
  log("suggestion_no_submit", true);
  await context.unroute(analyzeRoute);
  await sidepanel.close();
  await page.close();
}

const temp = await mkdtemp(path.join(tmpdir(), "offeros-vertical-"));
const serverOutput = { text: "" };
let server;
let context;
try {
  server = spawn(process.execPath, [NEXT, "start", "-H", "127.0.0.1"], {
    cwd: WEB,
    env: {
      ...process.env,
      NODE_ENV: "production",
      PORT: "3000",
      OFFEROS_DB_PATH: path.join(temp, "offeros.db"),
      OPENAI_API_KEY: "",
      ANTHROPIC_API_KEY: "",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  for (const stream of [server.stdout, server.stderr]) {
    stream.on("data", (chunk) => {
      serverOutput.text += chunk.toString();
    });
  }
  await waitForServer(server, serverOutput);
  await api("/profile", { method: "PUT", body: JSON.stringify(PROFILE) });
  const resume = await api("/resumes", {
    method: "POST",
    body: JSON.stringify({
      name: "Jordan Rivera Resume.pdf",
      mimeType: "application/pdf",
      dataBase64: Buffer.from("%PDF-1.4 fake local E2E resume").toString("base64"),
      text: "Jordan Rivera — Backend Engineer — TypeScript and Python",
      isPrimary: true,
    }),
  });
  log("web_ready", true);
  log("profile_seeded", true);
  log("resume_seeded", resume.id);

  context = await chromium.launchPersistentContext(path.join(temp, "chromium"), {
    headless: false,
    args: [
      `--disable-extensions-except=${EXTENSION}`,
      `--load-extension=${EXTENSION}`,
      "--no-sandbox",
    ],
  });
  const serviceWorker =
    context.serviceWorkers()[0] ??
    (await context.waitForEvent("serviceworker", { timeout: 8_000 }));
  assert.ok(serviceWorker, "extension service worker not found");
  const extensionUrl = new URL(serviceWorker.url());
  assert.equal(extensionUrl.protocol, "chrome-extension:");
  assert.ok(extensionUrl.hostname, "extension id missing from the service-worker URL");
  log("extension_id", extensionUrl.hostname);

  await serviceWorker.evaluate(
    async (base) => chrome.storage.local.set({ webApiBase: base }),
    BASE_URL,
  );

  for (const fixture of fixtures) await runFixture(context, serviceWorker, fixture, resume.id);
  await runSuggestionGate(context, serviceWorker, extensionUrl.hostname);

  const profile = await api("/profile");
  assert.equal(profile.personal.email, PROFILE.personal.email);
  const resumes = await api("/resumes");
  assert.equal(resumes.length, 1);
  assert.equal(resumes[0].id, resume.id);
  assert.equal(resumes[0].isPrimary, true);
  log("profile_persisted", true);
  log("resume_persisted", true);
  log("complete", true);
} finally {
  if (context) await context.close();
  if (server && server.exitCode === null) {
    server.kill("SIGTERM");
    await Promise.race([
      once(server, "exit"),
      new Promise((resolve) => setTimeout(resolve, 2_000)),
    ]);
  }
  await rm(temp, { recursive: true, force: true });
}
