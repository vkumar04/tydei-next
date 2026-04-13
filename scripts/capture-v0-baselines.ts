import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { mkdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const V0_URL = process.env.V0_URL ?? "http://localhost:3111";
const OUT_DIR = resolve(import.meta.dir, "..", "docs", "v0-reference");

type Route = {
  slug: string;
  path: string;
  requiresDemoCookie: boolean;
  waitFor?: string;
};

const routes: Route[] = [
  { slug: "landing", path: "/", requiresDemoCookie: false },
  { slug: "auth-login", path: "/auth/login", requiresDemoCookie: false },
  { slug: "auth-sign-up", path: "/auth/sign-up", requiresDemoCookie: false },

  { slug: "dashboard-home", path: "/dashboard", requiresDemoCookie: true },
  { slug: "dashboard-contracts", path: "/dashboard/contracts", requiresDemoCookie: true },
  { slug: "dashboard-cog-data", path: "/dashboard/cog-data", requiresDemoCookie: true },
  { slug: "dashboard-alerts", path: "/dashboard/alerts", requiresDemoCookie: true },
  { slug: "dashboard-reports", path: "/dashboard/reports", requiresDemoCookie: true },
  { slug: "dashboard-purchase-orders", path: "/dashboard/purchase-orders", requiresDemoCookie: true },
  { slug: "dashboard-invoice-validation", path: "/dashboard/invoice-validation", requiresDemoCookie: true },
  { slug: "dashboard-contract-renewals", path: "/dashboard/contract-renewals", requiresDemoCookie: true },
  { slug: "dashboard-rebate-optimizer", path: "/dashboard/rebate-optimizer", requiresDemoCookie: true },
  { slug: "dashboard-case-costing", path: "/dashboard/case-costing", requiresDemoCookie: true },
  { slug: "dashboard-analysis", path: "/dashboard/analysis", requiresDemoCookie: true },
  { slug: "dashboard-ai-agent", path: "/dashboard/ai-agent", requiresDemoCookie: true },
  { slug: "dashboard-settings", path: "/dashboard/settings", requiresDemoCookie: true },
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

  const url = new URL(V0_URL);
  const origin = `${url.protocol}//${url.host}`;

  const context: BrowserContext = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: 2,
    colorScheme: theme,
  });

  const cookies = [
    {
      name: "theme",
      value: theme,
      url: origin,
    },
  ];
  if (route.requiresDemoCookie) {
    cookies.push({ name: "demo_session", value: "true", url: origin });
  }
  await context.addCookies(cookies);

  const page: Page = await context.newPage();
  await page.addInitScript((t) => {
    try {
      localStorage.setItem("theme", t);
    } catch {}
  }, theme);

  const full = `${V0_URL}${route.path}`;
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

  await page.waitForTimeout(1200);

  const file = resolve(slugDir, `${theme}-${viewport.label}.png`);
  try {
    await page.screenshot({ path: file, fullPage: true });
    console.log(`[ok]   ${route.slug} ${theme} ${viewport.label} -> ${file}`);
  } catch (err) {
    console.error(`[fail] screenshot ${route.slug} ${theme} ${viewport.label}: ${(err as Error).message}`);
  }

  await context.close();
}

async function main() {
  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

  console.log(`Capturing ${routes.length} routes x ${themes.length} themes x ${viewports.length} viewports`);
  console.log(`Source: ${V0_URL}`);
  console.log(`Output: ${OUT_DIR}`);

  const browser = await chromium.launch({ headless: true });
  for (const route of routes) {
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
