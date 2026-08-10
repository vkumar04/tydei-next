import { test, expect } from "@playwright/test"

/**
 * E2E: regression guards for the eight issues Charles reported and we
 * shipped fixes for on 2026-07-27.
 *
 * Six of the eight land on a surface a browser can assert. Each test pins
 * the *user-visible* half of the fix, so a refactor that re-introduces the
 * old behaviour fails here rather than in a demo.
 *
 * Coverage:
 *  1. Facility /dashboard/analysis/prospective — "Current State Analysis"
 *     reports the facility's OWN spend and never substitutes the
 *     illustrative mid-size-ASC constants. The old `0 || 12_500_000`
 *     fallbacks (seedAssumptions, analysis-dashboard-client.tsx) put
 *     $12.5M of vendor spend on screen for a facility with no COG at all.
 *  2. Vendor /vendor/prospective — the tab strip is exactly
 *     Opportunities / Proposals / Benchmarks. The old "Analytics" tab is
 *     gone (its content moved into the one-page Proposals workspace).
 *  3. Vendor /vendor/prospective → Proposals — the Deal Scorer's
 *     "Working on proposal" picker renders in the EMBEDDED one-page flow
 *     too. Behind the old inherit gate it was unreachable, so a saved
 *     proposal could never be re-attached and its score / constructs /
 *     assumptions never came back ("you can go back and look at it again").
 *  4. Vendor /vendor/settings — the new "Identity" tab and its "Also known
 *     as" alias card ("I have a company name, example Stryker. How does it
 *     know on the facility side what contract to pull in when multiple
 *     names are used?").
 *  5. Vendor /vendor/prospective → Benchmarks — "Download template" sits
 *     next to the import controls, so the expected columns are discoverable
 *     before an import silently blanks them.
 *  6. Facility /dashboard/contracts/new → "Upload PDF" — the AI-extraction
 *     entry point renders its drop zone (it used to blow the page up).
 *
 * Every assertion here is READ-ONLY: no upload, no proposal, no alias. The
 * one interaction that touches state (opening a Radix select) is closed
 * again with Escape, so the file is safe to re-run against the same seeded
 * database as many times as you like.
 */

// ─── 1. Facility — Current State Analysis ────────────────────

test.describe("facility Current State Analysis reports live data", () => {
  test.use({ storageState: "tests/e2e/.auth/facility.json" })

  test("models from live spend and never substitutes the demo constants", async ({
    page,
  }) => {
    await page.goto("/dashboard/analysis/prospective")

    // "Current State" is the default outer tab, so the CFO dashboard is
    // the first thing rendered — no tab click needed.
    await expect(
      page.getByRole("heading", { name: /current state analysis/i }),
    ).toBeVisible({ timeout: 20_000 })

    // ── The invariant, true for ANY facility ────────────────
    // The page may legitimately show real figures, an honest "No COG spend
    // data yet" empty state, or an explicitly opted-into sample model. What
    // it may NEVER do is quietly dress the illustrative model up as the
    // facility's own numbers.
    //
    // "showing a representative model" was the old subtitle that made the
    // fabricated figures sound like a deliberate product decision.
    await expect(page.getByText(/representative model/i)).toHaveCount(0)
    // $12.5M is `DEFAULT_FACILITY_ASSUMPTIONS.currentVendorSpend` rendered
    // through usdCompact — the exact string the `0 || 12_500_000` fallback
    // produced. The fallback fired ⇔ the VENDOR SPEND surfaces show the
    // constant, so pin those two surfaces rather than the whole page: a
    // page-wide string sweep false-positived on 2026-08-05 when a Deal
    // Scenario PROJECTION derived from real data happened to format to
    // "$12.5M" (real inputs drift; any derived figure can collide).
    const spendCard = page
      .locator("[data-slot=card]")
      .filter({ hasText: "Current Vendor Spend" })
    await expect(spendCard.getByText("$12.5M")).toHaveCount(0)
    await expect(page.getByText(/vendor spend \$12\.5M/i)).toHaveCount(0)

    // ── The seeded expectation ──────────────────────────────
    // The demo facility DOES have COG rows, so the subtitle must say the
    // model came from them. Skip (don't fail) if a future seed drops COG
    // entirely — the empty state is the correct behaviour then, and the
    // no-fabrication assertions above already ran.
    const emptyState = page.getByText(/no cog spend data yet/i)
    test.skip(
      (await emptyState.count()) > 0,
      "seed has no COG spend for this facility — the empty state is correct",
    )

    // Apostrophe-agnostic: the copy is "your facility's live spend".
    await expect(
      page.getByText(/modeled from your facility.s live spend/i),
    ).toBeVisible({ timeout: 10_000 })

    // With real data there must be no sample-model banner either.
    await expect(
      page.getByText(/sample model .* not this facility/i),
    ).toHaveCount(0)
  })
})

// ─── 2, 3, 5. Vendor — prospective workspace ─────────────────

test.describe("vendor prospective workspace", () => {
  test.use({ storageState: "tests/e2e/.auth/vendor.json" })

  test("tab strip is exactly Opportunities / Proposals / Benchmarks / Dividend", async ({
    page,
  }) => {
    await page.goto("/vendor/prospective")

    const tabs = page.getByRole("tab")
    // Nothing else on this route renders tabs — the only other Tabs in the
    // subtree is ProposalDetailDialog's, and that dialog is closed.
    // (Dividend / DCF joined the strip 2026-08-09.)
    await expect(tabs).toHaveCount(4, { timeout: 20_000 })
    await expect(tabs.nth(0)).toHaveText(/opportunities/i)
    await expect(tabs.nth(1)).toHaveText(/proposals/i)
    await expect(tabs.nth(2)).toHaveText(/benchmarks/i)
    await expect(tabs.nth(3)).toHaveText(/dividend \/ dcf/i)

    // The separate "Analytics" tab was folded into the one-page Proposals
    // workspace; a reappearance means the split flow is back.
    await expect(page.getByRole("tab", { name: /analytics/i })).toHaveCount(0)
  })

  test("Deal Scorer exposes the 'Working on proposal' picker in the embedded flow", async ({
    page,
  }) => {
    await page.goto("/vendor/prospective")
    // Wait for the whole strip before clicking — a half-rendered TabsList
    // means React has not taken over yet and the click would no-op.
    await expect(page.getByRole("tab")).toHaveCount(4, { timeout: 20_000 })
    await page.getByRole("tab", { name: /proposals/i }).click()

    // Step 2 of the one-page workspace.
    await expect(page.getByText("Deal Scorer").first()).toBeVisible({
      timeout: 20_000,
    })

    // The embedded label. In the standalone Deal Scorer the same control is
    // labelled "Attach score to proposal (optional)" — asserting the
    // embedded wording is what proves the one-page flow renders it at all.
    await expect(page.getByText("Working on proposal")).toBeVisible({
      timeout: 10_000,
    })

    // The Radix SelectTrigger the label points at. Located by its id
    // rather than getByLabel because a `<label for>` on a Radix trigger
    // button is not part of its accessible name.
    const picker = page.locator("#attach-proposal")
    await expect(picker).toBeVisible()
    await expect(picker).toHaveRole("combobox")

    // Opening the list is read-only; Escape closes it without selecting.
    await picker.click()
    await expect(
      page.getByRole("option", { name: /don.t attach/i }),
    ).toBeVisible({ timeout: 10_000 })
    await page.keyboard.press("Escape")
  })

  test("Benchmarks tab offers Download template beside the import controls", async ({
    page,
  }) => {
    await page.goto("/vendor/prospective")
    await expect(page.getByRole("tab")).toHaveCount(4, { timeout: 20_000 })
    await page.getByRole("tab", { name: /benchmarks/i }).click()

    await expect(
      page.getByText(/product pricing benchmarks/i).first(),
    ).toBeVisible({ timeout: 20_000 })

    // Both live in the card's action slot. Asserting the import control too
    // pins the "next to" placement Charles asked for — a template link
    // buried elsewhere on the page is not the fix.
    // NOT clicked: the handler writes a CSV to disk.
    await expect(
      page.getByRole("button", { name: /download template/i }),
    ).toBeVisible({ timeout: 10_000 })
    await expect(
      page.getByRole("button", { name: /import benchmarks/i }).first(),
    ).toBeVisible()
  })
})

// ─── 4. Vendor — settings Identity tab ───────────────────────

test.describe("vendor settings Identity tab", () => {
  test.use({ storageState: "tests/e2e/.auth/vendor.json" })

  test("renders the 'Also known as' alias card", async ({ page }) => {
    await page.goto("/vendor/settings")

    // /vendor/settings redirects non-Super users to /vendor/dashboard; the
    // demo vendor is Super, so landing anywhere else is a real failure.
    await expect(page).toHaveURL(/\/vendor\/settings/, { timeout: 20_000 })

    const identityTab = page.getByRole("tab", { name: /identity/i })
    await expect(identityTab).toBeVisible({ timeout: 20_000 })
    await identityTab.click()

    // Scope to the live panel so we're asserting the tab actually switched,
    // not just that the words exist somewhere in the DOM.
    const panel = page.getByRole("tabpanel")
    await expect(panel.getByText(/also known as/i)).toBeVisible({
      timeout: 10_000,
    })
    // The alias input carries aria-label="New alias".
    await expect(panel.getByLabel(/new alias/i)).toBeVisible()
    // Disabled until something is typed — visibility is the assertion, and
    // nothing is typed, so no alias row is created.
    await expect(
      panel.getByRole("button", { name: /add alias/i }),
    ).toBeVisible()
  })
})

// ─── 6. Facility — contracts/new Upload PDF ──────────────────

test.describe("facility new-contract Upload PDF tab", () => {
  test.use({ storageState: "tests/e2e/.auth/facility.json" })

  test("renders the AI-extraction drop zone", async ({ page }) => {
    await page.goto("/dashboard/contracts/new")

    const pdfTab = page.getByRole("tab", { name: /upload pdf/i })
    await expect(pdfTab).toBeVisible({ timeout: 20_000 })
    // Already the default entry mode; clicking is idempotent and keeps the
    // test honest if that default ever changes.
    await pdfTab.click()

    await expect(
      page.getByText(/drop your contract pdf here/i),
    ).toBeVisible({ timeout: 10_000 })
    // The browse affordance that opens the file picker feeding
    // AIExtractDialog. Matched by text, not role: it is a <label for> styled
    // as a button (Button asChild), so it has no button role. Not clicked —
    // that opens an OS file dialog.
    await expect(page.getByText(/select pdf/i).first()).toBeVisible()
  })
})
