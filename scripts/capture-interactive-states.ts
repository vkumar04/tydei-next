/* Capture interactive UI states (dialogs, dropdowns, mid-flow forms)
   for visual parity pass 3. Signs in as demo-facility (and demo-admin
   for admin-only states), drives the UI, and screenshots. */

import { chromium, type Browser, type Page, type BrowserContext } from "playwright";
import { mkdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const URL = process.env.PROD_URL ?? "http://localhost:3000";
const OUT_DIR = resolve(
  import.meta.dir,
  "..",
  "docs",
  "v0-reference",
  "_prod-current",
  "_interactive",
);

const FACILITY = { email: "demo-facility@tydei.com", password: "demo-facility-2024" };
const ADMIN = { email: "demo-admin@tydei.com", password: "demo-admin-2024" };

async function signIn(browser: Browser, creds: { email: string; password: string }) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 30_000 });
  const res = await page.evaluate(
    async ({ url, email, password }) => {
      const r = await fetch(`${url}/api/auth/sign-in/email`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email, password }),
      });
      return { ok: r.ok, status: r.status, body: await r.text() };
    },
    { url: URL, email: creds.email, password: creds.password },
  );
  if (!res.ok) throw new Error(`sign-in ${creds.email}: ${res.status} ${res.body}`);
  const state = await ctx.storageState();
  await ctx.close();
  return state;
}

async function newAuthedContext(browser: Browser, state: Awaited<ReturnType<BrowserContext["storageState"]>>) {
  return browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
    storageState: state,
  });
}

async function shot(page: Page, name: string) {
  const file = resolve(OUT_DIR, `${name}.png`);
  await page.screenshot({ path: file, fullPage: false });
  console.log(`[ok]   ${name}`);
  return file;
}

async function safeClickFirst(page: Page, selectors: string[]) {
  for (const sel of selectors) {
    try {
      const loc = page.locator(sel).first();
      if (await loc.count()) {
        await loc.click({ timeout: 3000 });
        return sel;
      }
    } catch {}
  }
  return null;
}

async function run() {
  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });
  const browser = await chromium.launch({ headless: true });

  const facilityState = await signIn(browser, FACILITY);
  let adminState: Awaited<ReturnType<BrowserContext["storageState"]>> | null = null;
  try {
    adminState = await signIn(browser, ADMIN);
  } catch (err) {
    console.error(`[warn] admin sign-in failed: ${(err as Error).message}`);
  }

  const report: Record<string, string> = {};

  // 1. mass-upload-dialog-open
  {
    const ctx = await newAuthedContext(browser, facilityState);
    const page = await ctx.newPage();
    try {
      await page.goto(`${URL}/dashboard`, { waitUntil: "networkidle", timeout: 30_000 });
      await page.waitForTimeout(600);
      const clicked = await safeClickFirst(page, [
        'button:has-text("Import Data")',
        'header button:has-text("Import")',
        '[data-testid="import-data-button"]',
      ]);
      await page.waitForTimeout(1200);
      await shot(page, "mass-upload-dialog-open");
      report["mass-upload-dialog-open"] = clicked ? `clicked ${clicked}` : "no button found";
    } catch (e) {
      report["mass-upload-dialog-open"] = `err: ${(e as Error).message}`;
    }
    await ctx.close();
  }

  // 2. contract-detail
  {
    const ctx = await newAuthedContext(browser, facilityState);
    const page = await ctx.newPage();
    try {
      await page.goto(`${URL}/dashboard/contracts`, { waitUntil: "networkidle", timeout: 30_000 });
      await page.waitForTimeout(800);
      const clicked = await safeClickFirst(page, [
        'table tbody tr >> nth=0',
        '[role="row"]:not(:first-child)',
        'a[href*="/dashboard/contracts/"]',
      ]);
      await page.waitForTimeout(1500);
      await shot(page, "contract-detail");
      report["contract-detail"] = clicked ? `clicked ${clicked}` : "no row found";
    } catch (e) {
      report["contract-detail"] = `err: ${(e as Error).message}`;
    }
    await ctx.close();
  }

  // 3. payor-view-rates-dialog
  if (adminState) {
    const ctx = await newAuthedContext(browser, adminState);
    const page = await ctx.newPage();
    try {
      await page.goto(`${URL}/admin/payor-contracts`, { waitUntil: "networkidle", timeout: 30_000 });
      await page.waitForTimeout(800);
      const clicked = await safeClickFirst(page, [
        'button:has-text("View Rates")',
        '[aria-label*="View Rates"]',
        'table tbody tr >> nth=0',
      ]);
      await page.waitForTimeout(1500);
      await shot(page, "payor-view-rates-dialog");
      report["payor-view-rates-dialog"] = clicked ? `clicked ${clicked}` : "no selector";
    } catch (e) {
      report["payor-view-rates-dialog"] = `err: ${(e as Error).message}`;
    }
    await ctx.close();
  } else {
    report["payor-view-rates-dialog"] = "skipped (admin sign-in failed)";
  }

  // 4. rebate-optimizer-calculator-dialog
  {
    const ctx = await newAuthedContext(browser, facilityState);
    const page = await ctx.newPage();
    try {
      await page.goto(`${URL}/dashboard/rebate-optimizer`, { waitUntil: "networkidle", timeout: 30_000 });
      await page.waitForTimeout(800);
      const clicked = await safeClickFirst(page, [
        'button:has-text("Calculate Rebate")',
        'button:has-text("Calculate")',
        'button:has-text("Optimize")',
      ]);
      await page.waitForTimeout(1500);
      await shot(page, "rebate-optimizer-calculator-dialog");
      report["rebate-optimizer-calculator-dialog"] = clicked ? `clicked ${clicked}` : "no button";
    } catch (e) {
      report["rebate-optimizer-calculator-dialog"] = `err: ${(e as Error).message}`;
    }
    await ctx.close();
  }

  // 5. cog-import-dialog-open
  {
    const ctx = await newAuthedContext(browser, facilityState);
    const page = await ctx.newPage();
    try {
      await page.goto(`${URL}/dashboard/cog-data`, { waitUntil: "networkidle", timeout: 30_000 });
      await page.waitForTimeout(800);
      const clicked = await safeClickFirst(page, [
        'button:has-text("Import Data")',
        'button:has-text("Mass Upload")',
        'button:has-text("Import")',
        'button:has-text("Upload")',
      ]);
      await page.waitForTimeout(1500);
      await shot(page, "cog-import-dialog-open");
      report["cog-import-dialog-open"] = clicked ? `clicked ${clicked}` : "no button";
    } catch (e) {
      report["cog-import-dialog-open"] = `err: ${(e as Error).message}`;
    }
    await ctx.close();
  }

  // 6. ai-agent-chat-mid-conversation
  {
    const ctx = await newAuthedContext(browser, facilityState);
    const page = await ctx.newPage();
    try {
      await page.goto(`${URL}/dashboard/ai-agent`, { waitUntil: "networkidle", timeout: 30_000 });
      await page.waitForTimeout(800);
      const input = page.locator('textarea, input[type="text"]').first();
      if (await input.count()) {
        await input.click();
        await input.fill("Show me my top contracts");
        await page.waitForTimeout(200);
        const sent = await safeClickFirst(page, [
          'button[type="submit"]',
          'button:has-text("Send")',
          '[aria-label*="Send"]',
        ]);
        if (!sent) {
          await page.keyboard.press("Enter");
        }
        await page.waitForTimeout(3000);
        report["ai-agent-chat-mid-conversation"] = "typed+sent";
      } else {
        report["ai-agent-chat-mid-conversation"] = "no input found";
      }
      await shot(page, "ai-agent-chat-mid-conversation");
    } catch (e) {
      report["ai-agent-chat-mid-conversation"] = `err: ${(e as Error).message}`;
    }
    await ctx.close();
  }

  // 7. facility-dropdown-open
  {
    const ctx = await newAuthedContext(browser, facilityState);
    const page = await ctx.newPage();
    try {
      await page.goto(`${URL}/dashboard`, { waitUntil: "networkidle", timeout: 30_000 });
      await page.waitForTimeout(800);
      const clicked = await safeClickFirst(page, [
        '[data-testid="facility-selector"]',
        'aside button:has-text("Facility")',
        'aside [role="combobox"]',
        'button[aria-haspopup="menu"]',
        'header button[aria-haspopup]',
        'button:has([class*="avatar"])',
      ]);
      await page.waitForTimeout(800);
      await shot(page, "facility-dropdown-open");
      report["facility-dropdown-open"] = clicked ? `clicked ${clicked}` : "no dropdown";
    } catch (e) {
      report["facility-dropdown-open"] = `err: ${(e as Error).message}`;
    }
    await ctx.close();
  }

  // 8. alert-detail-drawer
  {
    const ctx = await newAuthedContext(browser, facilityState);
    const page = await ctx.newPage();
    try {
      await page.goto(`${URL}/dashboard/alerts`, { waitUntil: "networkidle", timeout: 30_000 });
      await page.waitForTimeout(800);
      const clicked = await safeClickFirst(page, [
        '[data-testid="alert-card"]',
        'article:has-text("Alert")',
        'div[role="button"]:has-text("alert")',
        'main button:has-text("View")',
        'main ul li >> nth=0',
        'main [class*="card"] >> nth=0',
      ]);
      await page.waitForTimeout(1200);
      await shot(page, "alert-detail-drawer");
      report["alert-detail-drawer"] = clicked ? `clicked ${clicked}` : "no card";
    } catch (e) {
      report["alert-detail-drawer"] = `err: ${(e as Error).message}`;
    }
    await ctx.close();
  }

  await browser.close();
  console.log("\n=== REPORT ===");
  for (const [k, v] of Object.entries(report)) console.log(`${k}: ${v}`);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
