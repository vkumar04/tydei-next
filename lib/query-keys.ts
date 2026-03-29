export type DateRange = { from: string; to: string }

export const queryKeys = {
  contracts: {
    all: ["contracts"] as const,
    list: (facilityId: string, filters?: Record<string, unknown>) =>
      ["contracts", "list", facilityId, filters] as const,
    detail: (id: string) => ["contracts", "detail", id] as const,
    stats: (facilityId: string) => ["contracts", "stats", facilityId] as const,
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
    detail: (id: string) => ["alerts", "detail", id] as const,
    unreadCount: (portalType: string, entityId: string) =>
      ["alerts", "unreadCount", portalType, entityId] as const,
  },
  dashboard: {
    stats: (facilityId: string, dateRange: DateRange) =>
      ["dashboard", "stats", facilityId, dateRange] as const,
    earnedRebate: (facilityId: string, dateRange: DateRange) =>
      ["dashboard", "earnedRebate", facilityId, dateRange] as const,
    spendByVendor: (facilityId: string, dateRange: DateRange) =>
      ["dashboard", "spendByVendor", facilityId, dateRange] as const,
    contractLifecycle: (facilityId: string) =>
      ["dashboard", "contractLifecycle", facilityId] as const,
    spendNeededForTier: (facilityId: string) =>
      ["dashboard", "spendNeededForTier", facilityId] as const,
    recentContracts: (facilityId: string) =>
      ["dashboard", "recentContracts", facilityId] as const,
    recentAlerts: (facilityId: string) =>
      ["dashboard", "recentAlerts", facilityId] as const,
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
  },
  purchaseOrders: {
    all: ["purchaseOrders"] as const,
    list: (facilityId: string, filters?: Record<string, unknown>) =>
      ["purchaseOrders", "list", facilityId, filters] as const,
    detail: (id: string) => ["purchaseOrders", "detail", id] as const,
    productSearch: (facilityId: string, query: string) =>
      ["purchaseOrders", "productSearch", facilityId, query] as const,
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
    list: (filters?: Record<string, unknown>) => ["cases", "list", filters] as const,
    detail: (id: string) => ["cases", "detail", id] as const,
  },
  renewals: {
    expiring: (entityId: string, windowDays: number) =>
      ["renewals", "expiring", entityId, windowDays] as const,
    summary: (contractId: string) => ["renewals", "summary", contractId] as const,
  },
  rebateOptimizer: {
    opportunities: (facilityId: string) =>
      ["rebateOptimizer", "opportunities", facilityId] as const,
    spendTargets: (facilityId: string) =>
      ["rebateOptimizer", "spendTargets", facilityId] as const,
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
} as const
