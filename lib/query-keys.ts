export const queryKeys = {
  contracts: {
    all: ["contracts"] as const,
    list: (filters?: Record<string, unknown>) => ["contracts", "list", filters] as const,
    detail: (id: string) => ["contracts", "detail", id] as const,
  },
  vendors: {
    all: ["vendors"] as const,
    list: (filters?: Record<string, unknown>) => ["vendors", "list", filters] as const,
    detail: (id: string) => ["vendors", "detail", id] as const,
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
  cogRecords: {
    all: ["cogRecords"] as const,
    list: (filters?: Record<string, unknown>) => ["cogRecords", "list", filters] as const,
  },
  pricingFiles: {
    all: ["pricingFiles"] as const,
    list: (filters?: Record<string, unknown>) => ["pricingFiles", "list", filters] as const,
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
