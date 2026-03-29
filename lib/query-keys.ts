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
    list: (filters?: Record<string, unknown>) => ["alerts", "list", filters] as const,
    detail: (id: string) => ["alerts", "detail", id] as const,
    count: (portalType?: string) => ["alerts", "count", portalType] as const,
  },
  purchaseOrders: {
    all: ["purchaseOrders"] as const,
    list: (filters?: Record<string, unknown>) => ["purchaseOrders", "list", filters] as const,
    detail: (id: string) => ["purchaseOrders", "detail", id] as const,
  },
  invoices: {
    all: ["invoices"] as const,
    list: (filters?: Record<string, unknown>) => ["invoices", "list", filters] as const,
    detail: (id: string) => ["invoices", "detail", id] as const,
  },
  cases: {
    all: ["cases"] as const,
    list: (filters?: Record<string, unknown>) => ["cases", "list", filters] as const,
    detail: (id: string) => ["cases", "detail", id] as const,
  },
} as const
