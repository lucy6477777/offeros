import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const EXTENSION = path.resolve(SCRIPT_DIR, "../.output/chrome-mv3");
const urls = process.argv.slice(2);

assert.ok(urls.length > 0, "usage: npm run probe:ats-live -- <ATS application URL> [...]");

const supportedHosts = [
  /(^|\.)greenhouse\.io$/,
  /^jobs(?:\.eu)?\.lever\.co$/,
  /(^|\.)ashbyhq\.com$/,
  /(^|\.)icims\.com$/,
  /(^|\.)myworkdayjobs\.com$/,
];

for (const raw of urls) {
  const url = new URL(raw);
  assert.equal(url.protocol, "https:", `${raw}: only HTTPS ATS pages are accepted`);
  assert.ok(
    supportedHosts.some((pattern) => pattern.test(url.hostname)),
    `${raw}: host is not in OfferOS's supported ATS list`,
  );
}

const log = (result) => console.log(`LIVE_ATS ${JSON.stringify(result)}`);

async function tabIdFor(serviceWorker, url) {
  return serviceWorker.evaluate(async (target) => {
    const tabs = await chrome.tabs.query({});
    return tabs.find((tab) => tab.url === target)?.id ?? null;
  }, url);
}

async function sendWithRetry(serviceWorker, tabId, message) {
  let error;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      return await serviceWorker.evaluate(
        async ({ id, payload }) => chrome.tabs.sendMessage(id, payload),
        { id: tabId, payload: message },
      );
    } catch (caught) {
      error = caught;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  throw error;
}

const temp = await mkdtemp(path.join(tmpdir(), "offeros-live-ats-"));
let context;
try {
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

  for (const url of urls) {
    const page = await context.newPage();
    const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
    assert.ok(response, `${url}: navigation produced no response`);
    assert.ok(response.ok(), `${url}: HTTP ${response.status()}`);
    await page.waitForTimeout(1_500);

    const finalUrl = page.url();
    const tabId = await tabIdFor(serviceWorker, finalUrl);
    assert.notEqual(tabId, null, `${finalUrl}: application tab not found`);

    const before = await page.locator("input, textarea, select").evaluateAll((controls) =>
      controls.map((control) => ({
        name: control.getAttribute("name") ?? "",
        value: control instanceof HTMLInputElement && control.type === "file" ? "" : control.value,
      })),
    );
    const scan = await sendWithRetry(serviceWorker, tabId, { kind: "OFFEROS_ENGINE_SCAN" });
    const capture = await sendWithRetry(serviceWorker, tabId, {
      kind: "OFFEROS_ENGINE_CAPTURE_JD",
    });
    const after = await page.locator("input, textarea, select").evaluateAll((controls) =>
      controls.map((control) => ({
        name: control.getAttribute("name") ?? "",
        value: control instanceof HTMLInputElement && control.type === "file" ? "" : control.value,
      })),
    );

    assert.equal(scan.ok, true, `${finalUrl}: scan failed`);
    assert.ok(scan.descriptors.length > 0, `${finalUrl}: no application fields found`);
    assert.ok(
      capture.jd.length > 100,
      `${finalUrl}: job description capture was unexpectedly short`,
    );
    assert.deepEqual(after, before, `${finalUrl}: read-only probe changed an application field`);

    log({
      url: finalUrl,
      ats: scan.atsId,
      fields: scan.descriptors.length,
      required: scan.descriptors.filter((descriptor) => descriptor.required).length,
      jdCharacters: capture.jd.length,
      title: capture.structuredTitle ?? capture.metaTitle,
      company: capture.structuredCompany ?? capture.metaCompany,
      mutatedFields: false,
      submitted: false,
    });
    await page.close();
  }
} finally {
  if (context) await context.close();
  await rm(temp, { recursive: true, force: true });
}
