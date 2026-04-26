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
  },
  contractTerms: {
    all: ["contractTerms"] as const,
    list: (contractId: string) => ["contractTerms", "list", contractId] as const,
  },
  categories: {
    all: ["categories"] as const,
    tree: () => ["categories", "tree"] as const,
    mappings: () => ["categories", "mappings"] as const,
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
    // Legacy per-stat keys (stats / monthlySpend / spendByVendor / etc.)
    // were removed 2026-04-23 along with `hooks/use-dashboard.ts` and
    // `lib/actions/dashboard.ts`. Dashboard now reads the canonical
    // composite keys below (kpiSummary + charts + contractStats), which
    // route through matchStatus-based filters consistent with the COG
    // Data page. See docs/superpowers/specs/2026-04-18-facility-
    // dashboard-rewrite.md.
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
  },
  vendorContracts: {
    all: ["vendorContracts"] as const,
    list: (vendorId: string, filters?: Record<string, unknown>) =>
      ["vendorContracts", "list", vendorId, filters] as const,
    detail: (id: string) => ["vendorContracts", "detail", id] as const,
  },
  pendingContracts: {
    vendor: (vendorId: string) => ["pendingContracts", "vendor", vendorId] as const,
    facility: (facilityId: string) => ["pendingContracts", "facility", facilityId] as const,
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
    payorContracts: (facilityId?: string) =>
      ["cases", "payorContracts", facilityId] as const,
    payorMargins: (contractId: string) =>
      ["cases", "payorMargins", contractId] as const,
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
    opportunities: (facilityId: string) =>
      ["rebateOptimizer", "opportunities", facilityId] as const,
    spendTargets: (facilityId: string) =>
      ["rebateOptimizer", "spendTargets", facilityId] as const,
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
    vendorProposals: (vendorId: string) =>
      ["prospective", "vendorProposals", vendorId] as const,
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
  },
  ai: {
    credits: (entityId: string) => ["ai", "credits", entityId] as const,
    usageHistory: (creditId: string) => ["ai", "usageHistory", creditId] as const,
  },
  admin: {
    stats: () => ["admin", "stats"] as const,
    activity: () => ["admin", "activity"] as const,
    pendingActions: () => ["admin", "pendingActions"] as const,
    facilities: (filters?: Record<string, unknown>) =>
      ["admin", "facilities", filters] as const,
    vendors: (filters?: Record<string, unknown>) =>
      ["admin", "vendors", filters] as const,
    users: (filters?: Record<string, unknown>) =>
      ["admin", "users", filters] as const,
    subscriptions: (filters?: Record<string, unknown>) =>
      ["admin", "subscriptions", filters] as const,
    invoices: (filters?: Record<string, unknown>) =>
      ["admin", "invoices", filters] as const,
    mrr: (months: number) => ["admin", "mrr", months] as const,
    payorContracts: (filters?: Record<string, unknown>) =>
      ["admin", "payorContracts", filters] as const,
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
    spendConcentration: (facilityId: string, trailingDays: number) =>
      ["analytics", "spendConcentration", facilityId, trailingDays] as const,
    purchaseCompliance: (facilityId: string, range: DateRange) =>
      ["analytics", "purchaseCompliance", facilityId, range] as const,
  },
} as const
