/* Capture prod's current state for side-by-side comparison with v0 baselines.
   Writes to docs/v0-reference/_prod-current/<slug>/<theme>-<viewport>.png. */

import { chromium, type Browser } from "playwright";
import { mkdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const PROD_URL = process.env.PROD_URL ?? "http://localhost:3211";
const OUT_DIR = resolve(import.meta.dir, "..", "docs", "v0-reference", "_prod-current");
const FILTER = process.env.ROUTES?.split(",").map((s) => s.trim()).filter(Boolean);

type Route = {
  slug: string;
  path: string;
  requiresAuth: boolean;
};

const routes: Route[] = [
  { slug: "landing", path: "/", requiresAuth: false },
  { slug: "auth-login", path: "/login", requiresAuth: false },
  { slug: "auth-sign-up", path: "/sign-up", requiresAuth: false },
  { slug: "dashboard-home", path: "/dashboard", requiresAuth: true },
  { slug: "dashboard-contracts", path: "/dashboard/contracts", requiresAuth: true },
  { slug: "dashboard-cog-data", path: "/dashboard/cog-data", requiresAuth: true },
  { slug: "dashboard-alerts", path: "/dashboard/alerts", requiresAuth: true },
  { slug: "dashboard-reports", path: "/dashboard/reports", requiresAuth: true },
  { slug: "dashboard-purchase-orders", path: "/dashboard/purchase-orders", requiresAuth: true },
  { slug: "dashboard-invoice-validation", path: "/dashboard/invoice-validation", requiresAuth: true },
  { slug: "dashboard-contract-renewals", path: "/dashboard/contract-renewals", requiresAuth: true },
  { slug: "dashboard-rebate-optimizer", path: "/dashboard/rebate-optimizer", requiresAuth: true },
  { slug: "dashboard-case-costing", path: "/dashboard/case-costing", requiresAuth: true },
  { slug: "dashboard-analysis", path: "/dashboard/analysis", requiresAuth: true },
  { slug: "dashboard-ai-agent", path: "/dashboard/ai-agent", requiresAuth: true },
  { slug: "dashboard-settings", path: "/dashboard/settings", requiresAuth: true },
];

const viewports = [
  { label: "desktop", width: 1440, height: 900 },
  { label: "mobile", width: 390, height: 844 },
];

const themes: Array<"light" | "dark"> = ["light", "dark"];

async function captureRoute(
  browser: Browser,
  route: Route,
  theme: "light" | "dark",
  viewport: (typeof viewports)[number],
) {
  const slugDir = resolve(OUT_DIR, route.slug);
  if (!existsSync(slugDir)) mkdirSync(slugDir, { recursive: true });

  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: 2,
    colorScheme: theme,
  });

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

  // Scroll through the page to trigger any whileInView motion animations,
  // then scroll back to the top before capturing fullPage.
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

  console.log(`Capturing ${filteredRoutes.length} routes from ${PROD_URL}`);
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
