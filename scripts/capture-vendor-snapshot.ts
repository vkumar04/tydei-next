/* Capture prod's current state for vendor portal routes.
   Writes to docs/v0-reference/_prod-current/<slug>/<theme>-<viewport>.png.

   Signs in as demo-vendor@tydei.com once and reuses the storage state. */

import { chromium, type Browser } from "playwright";
import { mkdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const PROD_URL = process.env.PROD_URL ?? "http://localhost:3000";
const OUT_DIR = resolve(import.meta.dir, "..", "docs", "v0-reference", "_prod-current");
const FILTER = process.env.ROUTES?.split(",").map((s) => s.trim()).filter(Boolean);

const DEMO_EMAIL = "demo-vendor@tydei.com";
const DEMO_PASSWORD = "demo-vendor-2024";

// Default: light desktop only. Set FULL_MATRIX=1 to capture dark + mobile too.
const FULL_MATRIX = process.env.FULL_MATRIX === "1";

type Route = {
  slug: string;
  path: string;
  requiresAuth: boolean;
};

const routes: Route[] = [
  { slug: "vendor-dashboard", path: "/vendor/dashboard", requiresAuth: true },
  { slug: "vendor-contracts", path: "/vendor/contracts", requiresAuth: true },
  { slug: "vendor-invoices", path: "/vendor/invoices", requiresAuth: true },
  { slug: "vendor-purchase-orders", path: "/vendor/purchase-orders", requiresAuth: true },
  { slug: "vendor-market-share", path: "/vendor/market-share", requiresAuth: true },
  { slug: "vendor-performance", path: "/vendor/performance", requiresAuth: true },
  { slug: "vendor-prospective", path: "/vendor/prospective", requiresAuth: true },
  { slug: "vendor-renewals", path: "/vendor/renewals", requiresAuth: true },
  { slug: "vendor-alerts", path: "/vendor/alerts", requiresAuth: true },
  { slug: "vendor-ai-agent", path: "/vendor/ai-agent", requiresAuth: true },
  { slug: "vendor-reports", path: "/vendor/reports", requiresAuth: true },
  { slug: "vendor-settings", path: "/vendor/settings", requiresAuth: true },
];

const viewports = FULL_MATRIX
  ? [
      { label: "desktop", width: 1440, height: 900 },
      { label: "mobile", width: 390, height: 844 },
    ]
  : [{ label: "desktop", width: 1440, height: 900 }];

const themes: Array<"light" | "dark"> = FULL_MATRIX ? ["light", "dark"] : ["light"];

let cachedStorageState: Awaited<ReturnType<import("playwright").BrowserContext["storageState"]>> | null = null;

async function loginAsVendor(browser: Browser) {
  if (cachedStorageState) return cachedStorageState;
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });
  const page = await context.newPage();
  await page.goto(PROD_URL, { waitUntil: "domcontentloaded", timeout: 30_000 });

  const signedIn = await page.evaluate(
    async ({ url, email, password }) => {
      const r = await fetch(`${url}/api/auth/sign-in/email`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email, password }),
      });
      return { ok: r.ok, status: r.status, body: await r.text() };
    },
    { url: PROD_URL, email: DEMO_EMAIL, password: DEMO_PASSWORD },
  );
  if (!signedIn.ok) {
    throw new Error(`Sign-in failed: ${signedIn.status} ${signedIn.body}`);
  }

  await page.goto(`${PROD_URL}/vendor/dashboard`, { waitUntil: "domcontentloaded", timeout: 30_000 });
  if (!/\/vendor/.test(page.url())) {
    const dbg = resolve(OUT_DIR, "_login-debug-vendor.png");
    if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });
    await page.screenshot({ path: dbg, fullPage: true });
    throw new Error(`Session not accepted: landed on ${page.url()}`);
  }

  cachedStorageState = await context.storageState();
  await context.close();
  return cachedStorageState;
}

async function captureRoute(
  browser: Browser,
  route: Route,
  theme: "light" | "dark",
  viewport: (typeof viewports)[number],
) {
  const slugDir = resolve(OUT_DIR, route.slug);
  if (!existsSync(slugDir)) mkdirSync(slugDir, { recursive: true });

  const contextOptions: Parameters<Browser["newContext"]>[0] = {
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: 2,
    colorScheme: theme,
  };
  if (route.requiresAuth) {
    const state = await loginAsVendor(browser);
    contextOptions.storageState = state;
  }
  const context = await browser.newContext(contextOptions);

  const page = await context.newPage();
  await page.addInitScript((t) => {
    try {
      localStorage.setItem("theme", t);
    } catch {}
  }, theme);

  const full = `${PROD_URL}${route.path}`;
  try {
    await page.goto(full, { waitUntil: "networkidle", timeout: 30_000 });
  } catch {
    try {
      await page.goto(full, { waitUntil: "domcontentloaded", timeout: 30_000 });
    } catch (err) {
      console.error(`[fail] ${route.slug} ${theme} ${viewport.label}: ${(err as Error).message}`);
      await context.close();
      return;
    }
  }

  await page
    .evaluate((t) => {
      const root = document.documentElement;
      root.classList.remove("light", "dark");
      root.classList.add(t);
      root.style.colorScheme = t;
    }, theme)
    .catch(() => {});

  await page.evaluate(async () => {
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const total = document.documentElement.scrollHeight;
    const step = window.innerHeight * 0.8;
    for (let y = 0; y < total; y += step) {
      window.scrollTo(0, y);
      await sleep(100);
    }
    window.scrollTo(0, total);
    await sleep(400);
    window.scrollTo(0, 0);
    await sleep(300);
  });

  await page.waitForTimeout(800);

  const file = resolve(slugDir, `${theme}-${viewport.label}.png`);
  try {
    await page.screenshot({ path: file, fullPage: true });
    console.log(`[ok]   ${route.slug} ${theme} ${viewport.label}`);
  } catch (err) {
    console.error(`[fail] screenshot ${route.slug} ${theme} ${viewport.label}: ${(err as Error).message}`);
  }

  await context.close();
}

async function main() {
  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

  const filteredRoutes = FILTER ? routes.filter((r) => FILTER.includes(r.slug)) : routes;

  console.log(`Capturing ${filteredRoutes.length} vendor routes from ${PROD_URL}`);
  console.log(`Output: ${OUT_DIR}`);

  const browser = await chromium.launch({ headless: true });
  for (const route of filteredRoutes) {
    for (const theme of themes) {
      for (const viewport of viewports) {
        await captureRoute(browser, route, theme, viewport);
      }
    }
  }
  await browser.close();
  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
