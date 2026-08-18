export type DateRange = { from: string; to: string }

export const queryKeys = {
  contracts: {
    all: ["contracts"] as const,
    list: (facilityId: string, filters?: Record<string, unknown>) =>
      ["contracts", "list", facilityId, filters] as const,
    detail: (id: string, periodId?: string) =>
      ["contracts", "detail", id, periodId ?? null] as const,
    stats: (facilityId: string, scope?: string) =>
      ["contracts", "stats", facilityId, scope ?? "this"] as const,
    renewalBrief: (id: string) =>
      ["contracts", "renewalBrief", id] as const,
    pricing: (id: string) =>
      ["contracts", "pricing", id] as const,
    // Per-category market share for a contract's vendor, read by BOTH the
    // standalone CategoryMarketShareCard and the ContractPerformanceCard
    // Market Share row. They previously used two divergent literal keys
    // (`category-market-share` vs `contract-performance-share`), so the
    // use-cog.ts COG-mutation invalidations (which only hit
    // `category-market-share`) silently left the Performance-tab row
    // stale. Both cards now derive from this one entry; `categoryMarketShareBase`
    // is the family prefix the COG mutations invalidate.
    categoryMarketShareBase: ["category-market-share"] as const,
    categoryMarketShare: (vendorId: string | undefined, contractId?: string) =>
      ["category-market-share", vendorId, contractId ?? null] as const,
    // Contract-detail ledger surfaces (Transactions tab + terms page).
    // Read in contract-transactions / contract-detail / terms clients;
    // invalidated by the transaction dialogs and edit-contract.
    periods: (contractId: string) =>
      ["contractPeriods", contractId] as const,
    rebates: (contractId: string) =>
      ["contractRebates", contractId] as const,
    // Logged credits + payments (dedicated Credit/Payment tables), shown in
    // the Transactions ledger's Credits/Payments tabs. MUST be its own key —
    // it previously reused `periods`, colliding with the contract-detail
    // periods query (getContractPeriods) so the ledger rendered the wrong-
    // shaped data as "$NaN" (Charles 2026-06-20). Invalidated wherever the
    // ledger is (transaction dialogs, recompute, edit-contract).
    creditsPayments: (contractId: string) =>
      ["contractCreditsPayments", contractId] as const,
    // Capital amortization schedule. The READ carries a `scope`
    // discriminator; every invalidation MUST pass the same scope (or use
    // the `capitalScheduleBase` family prefix) or it won't prefix-match.
    capitalScheduleBase: ["contract-capital-schedule"] as const,
    capitalSchedule: (scope: string, contractId: string) =>
      ["contract-capital-schedule", scope, contractId] as const,
    // ── Contract-detail single-card reads (keyed by contractId) ────────
    // Each card below is a standalone query with its own queryFn. They were
    // inline literals scattered across components/contracts/*; centralized
    // here so reads and the multi-invalidate blocks (edit-contract,
    // terms-page, transactions) stay prefix-aligned.
    performance: (contractId: string) =>
      ["contract-performance", contractId] as const,
    performanceCarveout: (contractId: string) =>
      ["contract-performance-carveout", contractId] as const,
    tieInBundle: (contractId: string) =>
      ["contract-tie-in-bundle", contractId] as const,
    offContractSpend: (contractId: string) =>
      ["contracts", "off-contract-spend", contractId] as const,
    insights: (contractId: string) =>
      ["contract-insights", contractId] as const,
    // Tie-in shortfall carry-forward ledger. Read by the amortization card,
    // invalidated after a transaction recompute.
    tieInShortfallLedger: (contractId: string) =>
      ["tie-in-shortfall-ledger", contractId] as const,
    // Accrual timeline. Read by contract-accrual-timeline; invalidated by
    // edit-contract + terms-page on save.
    accrualTimeline: (contractId: string) =>
      ["contract-accrual-timeline", contractId] as const,
    capitalProjection: (contractId: string) =>
      ["contract-capital-projection", contractId] as const,
    marginAnalysis: (contractId: string) =>
      ["contract-margin-analysis", contractId] as const,
    categoryHealth: (contractId: string) =>
      ["contract-category-health", contractId] as const,
    bundleMemberships: (contractId: string) =>
      ["bundle-memberships", contractId] as const,
    perfHistory: (contractId: string) =>
      ["contracts", "perf-history", contractId] as const,
    pricingItems: (contractId: string) =>
      ["contracts", contractId, "pricing-items"] as const,
    // Change proposals for a contract (read + invalidated by the proposals
    // card and the counter-propose dialog).
    proposals: (contractId: string) =>
      ["contracts", "proposals", contractId] as const,
    // Contract-form link/candidate option lists (not contract-scoped).
    linkOptions: () => ["contracts", "link-options"] as const,
    tieInCandidates: () => ["contracts", "tie-in-candidates"] as const,
    // Live derived-metrics preview while filling the contract form (keyed by
    // vendor + selected categories + the effective/expiration window).
    derivedMetrics: (
      vendorId: string | undefined,
      categoryNames: string[],
      effectiveDate: string,
      expirationDate: string,
    ) =>
      [
        "contract-derived-metrics",
        vendorId,
        categoryNames,
        effectiveDate,
        expirationDate,
      ] as const,
    // Tie-in compliance card (analytics namespace; keyed by contract + mode).
    tieInCompliance: (contractId: string, mode: string) =>
      ["analytics", "tieInCompliance", contractId, mode] as const,
    // Vendor-side contract-detail cards.
    vendorCarveOut: (contractId: string) =>
      ["vendor-carve-out", contractId] as const,
    vendorPricing: (contractId: string) =>
      ["vendor-contract-pricing", contractId] as const,
    dcfBundle: (contractId: string) =>
      ["contracts", "dcfBundle", contractId] as const,
    vendorPeriods: (contractId: string) =>
      ["vendor-contract-periods", contractId] as const,
  },
  contractTerms: {
    all: ["contractTerms"] as const,
    list: (contractId: string) => ["contractTerms", "list", contractId] as const,
    // CPT-code option list for the contract-terms form picker (static lookup).
    cptOptions: () => ["contract-terms", "cpt-options"] as const,
  },
  categories: {
    all: ["categories"] as const,
    tree: () => ["categories", "tree"] as const,
    mappings: () => ["categories", "mappings"] as const,
    mappedUniverse: ["categories", "mapped-universe"] as const,
    // AI category-mapping suggestions for a free-text category name
    // (contract-form mapping helper).
    suggestions: (categoryName: string | null) =>
      ["category-suggestions", categoryName] as const,
  },
  vendors: {
    all: ["vendors"] as const,
    list: (filters?: Record<string, unknown>) => ["vendors", "list", filters] as const,
    detail: (id: string) => ["vendors", "detail", id] as const,
    mappings: () => ["vendors", "mappings"] as const,
  },
  cogRecords: {
    all: ["cogRecords"] as const,
    list: (facilityId: string, filters?: Record<string, unknown>) =>
      ["cogRecords", "list", facilityId, filters] as const,
    importHistory: (facilityId: string) =>
      ["cogRecords", "importHistory", facilityId] as const,
    stats: (facilityId: string) =>
      ["cogRecords", "stats", facilityId] as const,
  },
  pricingFiles: {
    all: ["pricingFiles"] as const,
    list: (facilityId: string, vendorId?: string) =>
      ["pricingFiles", "list", facilityId, vendorId] as const,
  },
  facilities: {
    all: ["facilities"] as const,
    list: (filters?: Record<string, unknown>) => ["facilities", "list", filters] as const,
    detail: (id: string) => ["facilities", "detail", id] as const,
  },
  alerts: {
    all: ["alerts"] as const,
    list: (portalType: string, entityId: string, filters?: Record<string, unknown>) =>
      ["alerts", "list", portalType, entityId, filters] as const,
    summary: (portalType: string, entityId: string) =>
      ["alerts", "summary", portalType, entityId] as const,
    ranked: (portalType: string, entityId: string, options?: Record<string, unknown>) =>
      ["alerts", "ranked", portalType, entityId, options] as const,
    badge: (portalType: string, entityId: string) =>
      ["alerts", "badge", portalType, entityId] as const,
    detail: (id: string) => ["alerts", "detail", id] as const,
    unreadCount: (portalType: string, entityId: string) =>
      ["alerts", "unreadCount", portalType, entityId] as const,
  },
  dashboard: {
    // Prefix for blanket invalidation (e.g. after an alert mutation so the
    // "Open Alerts" KPI refreshes — the alert mutations don't carry facilityId).
    all: ["dashboard"] as const,
    // Legacy per-stat keys (stats / monthlySpend / spendByVendor / etc.)
    // were removed 2026-04-23 along with `hooks/use-dashboard.ts` and
    // `lib/actions/dashboard.ts`. Dashboard now reads the canonical
    // composite keys below (kpiSummary + charts + contractStats), which
    // route through matchStatus-based filters consistent with the COG
    // Data page.
    kpiSummary: (facilityId: string) =>
      ["dashboard", "kpiSummary", facilityId] as const,
    charts: (facilityId: string, months: number) =>
      ["dashboard", "charts", facilityId, months] as const,
    contractStats: (facilityId: string) =>
      ["dashboard", "contractStats", facilityId] as const,
  },
  reports: {
    data: (facilityId: string, reportType: string, dateRange: DateRange) =>
      ["reports", "data", facilityId, reportType, dateRange] as const,
    periodData: (contractId: string, dateRange?: DateRange) =>
      ["reports", "periodData", contractId, dateRange] as const,
    priceDiscrepancies: (facilityId: string) =>
      ["reports", "priceDiscrepancies", facilityId] as const,
    // Rebate-calculation audit trail for a contract (Calculations tab).
    audit: (contractId: string) =>
      ["reports", "audit", contractId] as const,
    // Facility-wide rebate breakdown by rebate type (By-Rebate-Type tab).
    byRebateType: () => ["reports", "by-rebate-type"] as const,
  },
  vendorReports: {
    contracts: (vendorId: string) =>
      ["vendorReports", "contracts", vendorId] as const,
    // facilityId ("all" or a specific id) participates in the cache key so
    // the Reports Hub facility selector refetches per facility.
    data: (
      vendorId: string,
      reportType: string,
      facilityId: string,
      dateRange: DateRange,
    ) =>
      ["vendorReports", "data", vendorId, reportType, facilityId, dateRange] as const,
    overview: (vendorId: string, facilityId: string, dateRange: DateRange) =>
      ["vendorReports", "overview", vendorId, facilityId, dateRange] as const,
    byRebateType: (vendorId: string, facilityId: string) =>
      ["vendorReports", "byRebateType", vendorId, facilityId] as const,
    audit: (vendorId: string, contractId: string) =>
      ["vendorReports", "audit", vendorId, contractId] as const,
  },
  vendorContracts: {
    all: ["vendorContracts"] as const,
    list: (vendorId: string, filters?: Record<string, unknown>) =>
      ["vendorContracts", "list", vendorId, filters] as const,
    detail: (id: string) => ["vendorContracts", "detail", id] as const,
  },
  pendingContracts: {
    // Family prefix every pending-contract mutation invalidates (covers
    // vendor + facility lists AND the per-row `detail`). The lists carry
    // the entityId after the base, so a bare `all` prefix-matches them all.
    all: ["pendingContracts"] as const,
    vendor: (vendorId: string) => ["pendingContracts", "vendor", vendorId] as const,
    facility: (facilityId: string) => ["pendingContracts", "facility", facilityId] as const,
    detail: (id: string) => ["pendingContracts", "detail", id] as const,
  },
  vendorDashboard: {
    stats: (vendorId: string) => ["vendorDashboard", "stats", vendorId] as const,
    spendTrend: (vendorId: string, dateRange?: DateRange) =>
      ["vendorDashboard", "spendTrend", vendorId, dateRange] as const,
    marketShareByCategory: (vendorId: string) =>
      ["vendorDashboard", "marketShareByCategory", vendorId] as const,
    contractStatus: (vendorId: string) =>
      ["vendorDashboard", "contractStatus", vendorId] as const,
    recentContracts: (vendorId: string) =>
      ["vendorDashboard", "recentContracts", vendorId] as const,
  },
  purchaseOrders: {
    all: ["purchaseOrders"] as const,
    list: (facilityId: string, filters?: Record<string, unknown>) =>
      ["purchaseOrders", "list", facilityId, filters] as const,
    detail: (id: string) => ["purchaseOrders", "detail", id] as const,
    productSearch: (facilityId: string, query: string) =>
      ["purchaseOrders", "productSearch", facilityId, query] as const,
    stats: (facilityId: string) =>
      ["purchaseOrders", "stats", facilityId] as const,
    vendors: (facilityId: string) =>
      ["purchaseOrders", "vendors", facilityId] as const,
  },
  invoices: {
    all: ["invoices"] as const,
    list: (entityId: string, filters?: Record<string, unknown>) =>
      ["invoices", "list", entityId, filters] as const,
    detail: (id: string) => ["invoices", "detail", id] as const,
    validation: (id: string) => ["invoices", "validation", id] as const,
  },
  cases: {
    all: ["cases"] as const,
    list: (facilityId: string, filters?: Record<string, unknown>) =>
      ["cases", "list", facilityId, filters] as const,
    detail: (id: string) => ["cases", "detail", id] as const,
    surgeonScorecards: (facilityId: string) =>
      ["cases", "surgeonScorecards", facilityId] as const,
    cptAnalysis: (facilityId: string) =>
      ["cases", "cptAnalysis", facilityId] as const,
    surgeonComparison: (facilityId: string, surgeons: string[]) =>
      ["cases", "comparison", facilityId, surgeons] as const,
    reportData: (facilityId: string, filters?: Record<string, unknown>) =>
      ["cases", "reportData", facilityId, filters] as const,
    surgeonRebateContribution: (
      facilityId: string,
      filters?: Record<string, unknown>,
    ) => ["cases", "surgeonRebateContribution", facilityId, filters] as const,
    surgeonVendorSpend: (
      facilityId: string,
      filters?: Record<string, unknown>,
    ) => ["cases", "surgeonVendorSpend", facilityId, filters] as const,
    payorContracts: (facilityId?: string) =>
      ["cases", "payorContracts", facilityId] as const,
    // bugs.rtfd 2026-06-14: the Payor Contract Margin dropdown's option list.
    // Distinct queryFn from `payorContracts` (returns {id,label}), so it needs
    // its own key — and the add/update/delete/import mutations must invalidate
    // it or the dropdown stays empty until a reload.
    payorMarginOptions: () => ["case-costing", "payor-contracts"] as const,
    payorMargins: (contractId: string) =>
      ["cases", "payorMargins", contractId] as const,
    // Payor Contract Margin card summary (Est. Reimbursement / CPT Matched /
    // Total Margin). Distinct queryFn from `payorMargins` — keeps its own
    // `case-costing/payor-margin` namespace. The payor-contract mutations
    // (esp. rate import) must invalidate the `payorMarginSummaryBase` family
    // prefix or the card stays stale after a rate import.
    payorMarginSummaryBase: ["case-costing", "payor-margin"] as const,
    payorMarginSummary: (contractId: string | undefined) =>
      ["case-costing", "payor-margin", contractId] as const,
    trueMargin: (
      facilityId: string,
      periodStart: string,
      periodEnd: string,
    ) => ["cases", "trueMargin", facilityId, periodStart, periodEnd] as const,
  },
  renewals: {
    expiring: (entityId: string, windowDays: number) =>
      ["renewals", "expiring", entityId, windowDays] as const,
    summary: (contractId: string) => ["renewals", "summary", contractId] as const,
    performanceHistory: (contractId: string) =>
      ["renewals", "performanceHistory", contractId] as const,
    notes: (contractId: string) =>
      ["renewals", "notes", contractId] as const,
  },
  rebateOptimizer: {
    // Family prefix the set-spend-target mutation invalidates — prefix-matches
    // opportunities, spendTargets, insights, and insightFlags.
    all: ["rebateOptimizer"] as const,
    opportunities: (facilityId: string) =>
      ["rebateOptimizer", "opportunities", facilityId] as const,
    spendTargets: (facilityId: string) =>
      ["rebateOptimizer", "spendTargets", facilityId] as const,
    // AI Smart Recommendations (lazy) + the flagged-insights follow-up feed.
    insights: (facilityId: string) =>
      ["rebateOptimizer", "insights", facilityId] as const,
    insightFlags: (facilityId: string) =>
      ["rebateOptimizer", "insightFlags", facilityId] as const,
  },
  analysis: {
    depreciation: (contractId: string, input?: Record<string, unknown>) =>
      ["analysis", "depreciation", contractId, input] as const,
    priceProjections: (facilityId: string, filters?: Record<string, unknown>) =>
      ["analysis", "priceProjections", facilityId, filters] as const,
    vendorSpendTrends: (facilityId: string, dateRange?: DateRange) =>
      ["analysis", "vendorSpendTrends", facilityId, dateRange] as const,
    categorySpendTrends: (facilityId: string, dateRange?: DateRange) =>
      ["analysis", "categorySpendTrends", facilityId, dateRange] as const,
    proposalAnalysis: (facilityId: string) =>
      ["analysis", "proposalAnalysis", facilityId] as const,
  },
  prospective: {
    // Family prefix the proposal create/delete mutations invalidate — it
    // prefix-matches `vendorProposals`, `vendorBenchmarks`, and
    // `vendorCogPatterns` below.
    all: ["prospective"] as const,
    vendorProposals: (vendorId: string) =>
      ["prospective", "vendorProposals", vendorId] as const,
    vendorProposalDetailBase: ["prospective", "vendorProposalDetail"] as const,
    vendorProposalDetail: (id: string) =>
      ["prospective", "vendorProposalDetail", id] as const,
    vendorBenchmarksBase: ["prospective", "vendorBenchmarks"] as const,
    vendorBenchmarks: (vendorId: string) =>
      ["prospective", "vendorBenchmarks", vendorId] as const,
    vendorCogPatterns: (vendorId: string | null) =>
      ["prospective", "vendorCOGPatterns", vendorId] as const,
    // Dividend/DCF tab — both families sit under the `prospective` prefix so
    // the existing `prospective.all` invalidations refresh them too.
    dividendProposals: (vendorId: string) =>
      ["prospective", "dividendProposals", vendorId] as const,
    dividendProposal: (proposalId: string) =>
      ["prospective", "dividendProposals", "detail", proposalId] as const,
    payorVolumeDatasets: (vendorId: string) =>
      ["prospective", "payorVolumeDatasets", vendorId] as const,
    proformaStatements: (vendorId: string) =>
      ["prospective", "proformaStatements", vendorId] as const,
    medicareRateSets: (vendorId: string) =>
      ["prospective", "medicareRateSets", vendorId] as const,
    medicareRateOverrides: (vendorId: string) =>
      ["prospective", "medicareRateOverrides", vendorId] as const,
  },
  settings: {
    facilityProfile: (facilityId: string) =>
      ["settings", "facilityProfile", facilityId] as const,
    vendorProfile: (vendorId: string) =>
      ["settings", "vendorProfile", vendorId] as const,
    notifications: (entityId: string) =>
      ["settings", "notifications", entityId] as const,
    team: (orgId: string) => ["settings", "team", orgId] as const,
    featureFlags: (facilityId: string) =>
      ["settings", "featureFlags", facilityId] as const,
    connections: (entityId: string) =>
      ["settings", "connections", entityId] as const,
    /** Invite-dialog typeahead, keyed by the search text. */
    connectionTargets: (query: string) =>
      ["settings", "connections", "targets", query] as const,
    vendorOperatingMode: (vendorId: string) =>
      ["settings", "vendorOperatingMode", vendorId] as const,
    vendorAliases: (vendorId: string) =>
      ["settings", "vendorAliases", vendorId] as const,
    // Shares the "vendorAliases" prefix on purpose: adding or removing an alias
    // changes which suggestions are still actionable, and one invalidation must
    // refresh both.
    vendorAliasSuggestions: (vendorId: string) =>
      ["settings", "vendorAliases", vendorId, "suggestions"] as const,
    vendorDivisions: () => ["vendor-divisions"] as const,
    // Settings/Users feature ───────────────────────────────────────
    memberAccessTiers: (orgId: string) =>
      ["settings", "memberAccessTiers", orgId] as const,
  },
  // Per-user account/profile (name/email/password). Self-scoped — no id
  // in the key (it's always the session user).
  account: {
    me: () => ["account", "me"] as const,
  },
  // Contract-renewal alert settings (per-user; shared row both sides).
  renewalAlertSettings: {
    base: ["renewalAlertSettings"] as const,
    detail: (userId: string) => ["renewalAlertSettings", userId] as const,
  },
  // Vendor division membership (Settings/Users feature).
  divisionMembers: {
    base: ["divisionMembers"] as const,
    byVendor: (vendorId: string) => ["divisionMembers", "byVendor", vendorId] as const,
    byDivision: (divisionId: string) =>
      ["divisionMembers", "byDivision", divisionId] as const,
    // The CALLER's pickable divisions (proposal-builder division selector).
    mine: ["divisionMembers", "mine"] as const,
  },
  // Vendor 1-/2-way connection mode.
  connectionMode: {
    base: ["connectionMode"] as const,
    detail: (connectionId: string) => ["connectionMode", connectionId] as const,
  },
  // Vendor-owned COG (1-way mode).
  vendorCog: {
    base: ["vendorCog"] as const,
    list: (vendorId: string, filters?: Record<string, unknown>) =>
      ["vendorCog", "list", vendorId, filters] as const,
    stats: (vendorId: string) => ["vendorCog", "stats", vendorId] as const,
  },
  // Per-user facility assignment (facility enterprise scoping).
  facilityAssignment: {
    base: ["facilityAssignment"] as const,
    byUser: (userId: string) => ["facilityAssignment", "byUser", userId] as const,
    forOrg: (orgId: string) => ["facilityAssignment", "forOrg", orgId] as const,
  },
  ai: {
    // Family prefix the consume-credits mutation invalidates — prefix-matches
    // every per-entity `credits(entityId)` read.
    creditsBase: ["ai", "credits"] as const,
    credits: (entityId: string) => ["ai", "credits", entityId] as const,
    usageHistory: (creditId: string) => ["ai", "usageHistory", creditId] as const,
    // Per-action rollup over the credit's full billing period (AI Credits tab
    // "Total Credits" column). Distinct queryFn from usageHistory.
    breakdown: (creditId: string) => ["ai", "breakdown", creditId] as const,
    // Pre-flight credit availability check, keyed by entity + action.
    check: (entityId: string, action: string) =>
      ["ai", "check", entityId, action] as const,
  },
  admin: {
    stats: () => ["admin", "stats"] as const,
    activity: () => ["admin", "activity"] as const,
    pendingActions: () => ["admin", "pendingActions"] as const,
    // Family prefixes for the two tenant consoles. Every admin tenant mutation
    // invalidates one of these, and they prefix-match BOTH the paginated list
    // keys and the Access-picker option keys below.
    facilitiesBase: ["admin", "facilities"] as const,
    vendorsBase: ["admin", "vendors"] as const,
    /**
     * The paginated console lists. Called with NO filter these ARE the base
     * arrays above — that collapse is load-bearing, see `vendorOptions`.
     */
    facilities: (filters?: Record<string, unknown>) =>
      filters === undefined
        ? (["admin", "facilities"] as const)
        : (["admin", "facilities", filters] as const),
    vendors: (filters?: Record<string, unknown>) =>
      filters === undefined
        ? (["admin", "vendors"] as const)
        : (["admin", "vendors", filters] as const),
    /**
     * Unpaginated id/name lists for the user-creation Access picker.
     *
     * These share the "facilities"/"vendors" prefix with the list keys above so
     * that creating a tenant refreshes them. That claim was written down on
     * 2026-07-26 and was FALSE until 2026-07-28: `admin.vendors()` used to build
     * a 3-element `["admin","vendors",undefined]`, and TanStack's
     * `partialMatchKey` (query-core utils.js) walks the FILTER key's full
     * length — index 2 compared `"options"` against `undefined`, returned false,
     * and `invalidateQueries({ queryKey: queryKeys.admin.vendors() })` never
     * touched the picker. Creating a vendor left the Access picker showing a
     * catalog without it until a full reload.
     *
     * The no-filter form now collapses to the 2-element base, so a bare
     * `admin.vendors()` / `admin.facilities()` prefix-matches the option keys
     * as well as every `{page,…}`-keyed page. Re-adding a third element to the
     * no-filter branch silently re-breaks this.
     */
    facilityOptions: () => ["admin", "facilities", "options"] as const,
    vendorOptions: () => ["admin", "vendors", "options"] as const,
    usersBase: ["admin", "users"] as const,
    /**
     * The remaining admin list families. Every one of them collapses to its
     * 2-element base when called with no filter, for the reason spelled out
     * above — an appended `undefined` is compared against the sibling key's
     * real third element and does NOT prefix-match.
     *
     * `payorContracts` is where that bit last: the table holds two reads,
     * `payorContracts()` and `payorContracts({ status: "active" })`, and the
     * bare invalidation could not reach the second, so the call site had to
     * spell out both by hand. With the collapse the bare form is a genuine
     * family prefix and covers every `{…}`-keyed read, present and future.
     * (Call sites that still invalidate both keys stay correct — the second is
     * simply redundant now.)
     *
     * `admin-tenant-console-scope.test.tsx` walks these factories and fails if
     * a new one appends `undefined` again.
     */
    users: (filters?: Record<string, unknown>) =>
      filters === undefined
        ? (["admin", "users"] as const)
        : (["admin", "users", filters] as const),
    subscriptions: (filters?: Record<string, unknown>) =>
      filters === undefined
        ? (["admin", "subscriptions"] as const)
        : (["admin", "subscriptions", filters] as const),
    invoices: (filters?: Record<string, unknown>) =>
      filters === undefined
        ? (["admin", "invoices"] as const)
        : (["admin", "invoices", filters] as const),
    mrr: (months: number) => ["admin", "mrr", months] as const,
    payorContracts: (filters?: Record<string, unknown>) =>
      filters === undefined
        ? (["admin", "payorContracts"] as const)
        : (["admin", "payorContracts", filters] as const),
  },
  vendorAnalytics: {
    marketShare: (vendorId: string, filters?: Record<string, unknown>) =>
      ["vendorAnalytics", "marketShare", vendorId, filters] as const,
    performance: (vendorId: string) =>
      ["vendorAnalytics", "performance", vendorId] as const,
    performanceContracts: (vendorId: string) =>
      ["vendorAnalytics", "performanceContracts", vendorId] as const,
    performanceMonthlyTrend: (vendorId: string) =>
      ["vendorAnalytics", "performanceMonthlyTrend", vendorId] as const,
    performanceCategories: (vendorId: string) =>
      ["vendorAnalytics", "performanceCategories", vendorId] as const,
    performanceTiers: (vendorId: string) =>
      ["vendorAnalytics", "performanceTiers", vendorId] as const,
    benchmarks: (vendorId: string, category?: string) =>
      ["vendorAnalytics", "benchmarks", vendorId, category] as const,
  },
  changeProposals: {
    byContract: (contractId: string) =>
      ["changeProposals", "byContract", contractId] as const,
    pendingForFacility: (facilityId: string) =>
      ["changeProposals", "pending", facilityId] as const,
  },
  reportSchedules: {
    list: (facilityId: string) => ["reportSchedules", facilityId] as const,
  },
  forecasting: {
    spend: (facilityId: string, input?: Record<string, unknown>) =>
      ["forecasting", "spend", facilityId, input] as const,
    rebate: (facilityId: string, input?: Record<string, unknown>) =>
      ["forecasting", "rebate", facilityId, input] as const,
  },
  analytics: {
    contractScore: (contractId: string) =>
      ["analytics", "contractScore", contractId] as const,
    renewalRisk: (contractId: string) =>
      ["analytics", "renewalRisk", contractId] as const,
    rebateForecast: (contractId: string, months: number) =>
      ["analytics", "rebateForecast", contractId, months] as const,
    priceReduction: (contractId: string) =>
      ["analytics", "priceReduction", contractId] as const,
    spendConcentration: (facilityId: string, trailingDays: number) =>
      ["analytics", "spendConcentration", facilityId, trailingDays] as const,
    purchaseCompliance: (facilityId: string, range: DateRange) =>
      ["analytics", "purchaseCompliance", facilityId, range] as const,
  },
  notifications: {
    // In-app notification bell (Notification table, scoped by userId). The bell
    // read + its optimistic mutations both key off this. Distinct from
    // `settings.notifications` (per-entity notification *preferences*).
    all: ["my-notifications"] as const,
  },
  prospectiveAnalysis: {
    // Facility "Evaluate Proposals" — persisted proposal evaluations (DB-backed
    // since 2026-06-26; was localStorage). Prefix-invalidated on every write.
    evaluationsBase: ["prospectiveAnalysis", "evaluations"] as const,
    evaluations: ["prospectiveAnalysis", "evaluations"] as const,
    // Facility Analysis dashboard — real DB data seed.
    facilityData: (facilityId: string) =>
      ["prospectiveAnalysis", "facilityData", facilityId] as const,
    // On-demand AI insight layers (facility dashboard + vendor opportunity
    // engine). Keyed by a hash of the snapshot so a changed scenario refetches.
    facilityInsightsBase: ["prospectiveAnalysis", "facilityInsights"] as const,
    facilityInsights: (facilityId: string, snapshotHash: string) =>
      [
        "prospectiveAnalysis",
        "facilityInsights",
        facilityId,
        snapshotHash,
      ] as const,
    // Vendor Opportunity Engine DB seed. Family key: the base (no facility)
    // form is a PREFIX of every facility-scoped key, so existing prefix
    // invalidations (e.g. the benchmark-import invalidation in
    // hooks/use-prospective.ts, which calls `vendorOpportunityData(vendorId)`)
    // refresh the scoped variants too.
    vendorOpportunityDataBase: (vendorId: string) =>
      ["prospectiveAnalysis", "vendorOpportunityData", vendorId] as const,
    vendorOpportunityData: (vendorId: string, facilityId?: string) =>
      facilityId
        ? ([
            "prospectiveAnalysis",
            "vendorOpportunityData",
            vendorId,
            facilityId,
          ] as const)
        : (["prospectiveAnalysis", "vendorOpportunityData", vendorId] as const),
    // Per-facility Current State for the vendor pitch view (Opportunity Engine).
    vendorFacilityCurrentState: (vendorId: string, facilityId: string) =>
      [
        "prospectiveAnalysis",
        "vendorFacilityCurrentState",
        vendorId,
        facilityId,
      ] as const,
    vendorInsightsBase: ["prospectiveAnalysis", "vendorInsights"] as const,
    vendorInsights: (vendorId: string, snapshotHash: string) =>
      [
        "prospectiveAnalysis",
        "vendorInsights",
        vendorId,
        snapshotHash,
      ] as const,
  },
} as const
