/* Capture admin portal screenshots for comparison against v0 baselines.
   Writes to docs/v0-reference/_prod-current/<slug>/<theme>-<viewport>.png.
   Light desktop only. */

import { chromium, type Browser } from "playwright";
import { mkdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const PROD_URL = process.env.PROD_URL ?? "http://localhost:3000";
const OUT_DIR = resolve(import.meta.dir, "..", "docs", "v0-reference", "_prod-current");
const FILTER = process.env.ROUTES?.split(",").map((s) => s.trim()).filter(Boolean);

const DEMO_EMAIL = "demo-admin@tydei.com";
const DEMO_PASSWORD = "demo-admin-2024";

type Route = { slug: string; path: string };

const routes: Route[] = [
  { slug: "admin-dashboard", path: "/admin/dashboard" },
  { slug: "admin-users", path: "/admin/users" },
  { slug: "admin-facilities", path: "/admin/facilities" },
  { slug: "admin-vendors", path: "/admin/vendors" },
  { slug: "admin-payor-contracts", path: "/admin/payor-contracts" },
  { slug: "admin-billing", path: "/admin/billing" },
];

const FULL_MATRIX = process.env.FULL_MATRIX === "1";
const viewports = FULL_MATRIX
  ? [
      { label: "desktop", width: 1440, height: 900 },
      { label: "mobile", width: 390, height: 844 },
    ]
  : [{ label: "desktop", width: 1440, height: 900 }];
const themes: Array<"light" | "dark"> = FULL_MATRIX ? ["light", "dark"] : ["light"];

let cachedStorageState: Awaited<ReturnType<import("playwright").BrowserContext["storageState"]>> | null = null;

async function loginAsAdmin(browser: Browser) {
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

  await page.goto(`${PROD_URL}/admin/dashboard`, { waitUntil: "domcontentloaded", timeout: 30_000 });
  if (!/\/admin/.test(page.url())) {
    const dbg = resolve(OUT_DIR, "_admin-login-debug.png");
    if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });
    await page.screenshot({ path: dbg, fullPage: true });
    throw new Error(`Session not accepted: landed on ${page.url()}`);
  }

  cachedStorageState = await context.storageState();
  await context.close();
  return cachedStorageState;
}

async function captureRoute(browser: Browser, route: Route) {
  const slugDir = resolve(OUT_DIR, route.slug);
  if (!existsSync(slugDir)) mkdirSync(slugDir, { recursive: true });

  const state = await loginAsAdmin(browser);

  for (const viewport of viewports) {
    for (const theme of themes) {
      const context = await browser.newContext({
        viewport: { width: viewport.width, height: viewport.height },
        deviceScaleFactor: 2,
        colorScheme: theme,
        storageState: state,
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
          continue;
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
  }
}

async function main() {
  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

  const filteredRoutes = FILTER ? routes.filter((r) => FILTER.includes(r.slug)) : routes;

  console.log(`Capturing ${filteredRoutes.length} admin routes from ${PROD_URL}`);
  console.log(`Output: ${OUT_DIR}`);

  const browser = await chromium.launch({ headless: true });
  for (const route of filteredRoutes) {
    await captureRoute(browser, route);
  }
  await browser.close();
  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
