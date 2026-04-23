import type {
  CategoryBreakdownRow,
  ContractPerf,
  ContractPerfTier,
  MonthlyTrendPoint,
} from "./performance-types"

// ---------------------------------------------------------------------------
// Mock baselines for views not yet backed by live data.
// These follow v0's vendor performance mock data verbatim. We'll replace with
// live data as the analytics server actions gain coverage.
// ---------------------------------------------------------------------------

export const MOCK_CONTRACT_PERFORMANCE: ContractPerf[] = [
  {
    id: "1",
    name: "FirstHealth Usage Agreement",
    facility: "FirstHealth Regional",
    targetSpend: 500000,
    actualSpend: 450000,
    targetVolume: 1200,
    actualVolume: 1150,
    rebateRate: 5.0,
    rebatePaid: 22500,
    compliance: 95,
    status: "on-track",
    rebateTiers: [
      { tier: "Tier 1", threshold: 300000, current: 450000, rebateRate: 3.0, achieved: true },
      { tier: "Tier 2", threshold: 450000, current: 450000, rebateRate: 5.0, achieved: true },
      { tier: "Tier 3", threshold: 600000, current: 450000, rebateRate: 7.0, achieved: false },
    ],
  },
  {
    id: "2",
    name: "Memorial Hospital Supply",
    facility: "Memorial Hospital",
    targetSpend: 400000,
    actualSpend: 380000,
    targetVolume: 800,
    actualVolume: 820,
    rebateRate: 4.0,
    rebatePaid: 15200,
    compliance: 102,
    status: "exceeding",
    rebateTiers: [
      { tier: "Tier 1", threshold: 200000, current: 380000, rebateRate: 2.5, achieved: true },
      { tier: "Tier 2", threshold: 350000, current: 380000, rebateRate: 4.0, achieved: true },
      { tier: "Tier 3", threshold: 500000, current: 380000, rebateRate: 5.5, achieved: false },
    ],
  },
  {
    id: "3",
    name: "Clearwater Biologics",
    facility: "Clearwater Medical",
    targetSpend: 600000,
    actualSpend: 520000,
    targetVolume: 1500,
    actualVolume: 1280,
    rebateRate: 6.0,
    rebatePaid: 31200,
    compliance: 85,
    status: "at-risk",
    rebateTiers: [
      { tier: "Tier 1", threshold: 400000, current: 520000, rebateRate: 4.0, achieved: true },
      { tier: "Tier 2", threshold: 550000, current: 520000, rebateRate: 6.0, achieved: false },
      { tier: "Tier 3", threshold: 700000, current: 520000, rebateRate: 8.0, achieved: false },
    ],
  },
  {
    id: "4",
    name: "Regional Medical Center",
    facility: "Regional Medical",
    targetSpend: 300000,
    actualSpend: 280000,
    targetVolume: 600,
    actualVolume: 590,
    rebateRate: 3.5,
    rebatePaid: 9800,
    compliance: 98,
    status: "on-track",
    rebateTiers: [
      { tier: "Tier 1", threshold: 150000, current: 280000, rebateRate: 2.0, achieved: true },
      { tier: "Tier 2", threshold: 250000, current: 280000, rebateRate: 3.5, achieved: true },
      { tier: "Tier 3", threshold: 350000, current: 280000, rebateRate: 5.0, achieved: false },
    ],
  },
  {
    id: "5",
    name: "University Health System",
    facility: "University Hospital",
    targetSpend: 750000,
    actualSpend: 680000,
    targetVolume: 2000,
    actualVolume: 1850,
    rebateRate: 5.5,
    rebatePaid: 37400,
    compliance: 92,
    status: "on-track",
    rebateTiers: [
      { tier: "Tier 1", threshold: 500000, current: 680000, rebateRate: 3.5, achieved: true },
      { tier: "Tier 2", threshold: 650000, current: 680000, rebateRate: 5.5, achieved: true },
      { tier: "Tier 3", threshold: 850000, current: 680000, rebateRate: 7.5, achieved: false },
    ],
  },
]

export const MOCK_MONTHLY_TREND: MonthlyTrendPoint[] = [
  { month: "Jan", spend: 320000, target: 350000, rebates: 16000 },
  { month: "Feb", spend: 285000, target: 300000, rebates: 14250 },
  { month: "Mar", spend: 340000, target: 320000, rebates: 17000 },
  { month: "Apr", spend: 298000, target: 310000, rebates: 14900 },
  { month: "May", spend: 375000, target: 340000, rebates: 18750 },
  { month: "Jun", spend: 410000, target: 380000, rebates: 20500 },
  { month: "Jul", spend: 385000, target: 390000, rebates: 19250 },
  { month: "Aug", spend: 420000, target: 400000, rebates: 21000 },
]

export const MOCK_DEFAULT_REBATE_TIERS: ContractPerfTier[] = [
  { tier: "Tier 1", threshold: 1000000, current: 2310000, rebateRate: 3.0, achieved: true },
  { tier: "Tier 2", threshold: 2000000, current: 2310000, rebateRate: 4.5, achieved: true },
  { tier: "Tier 3", threshold: 3500000, current: 2310000, rebateRate: 6.0, achieved: false },
]

export const MOCK_CATEGORY_BREAKDOWN: CategoryBreakdownRow[] = [
  { category: "Biologics", spend: 580000, target: 620000, pct: 93.5 },
  { category: "Disposables", spend: 320000, target: 300000, pct: 106.7 },
  { category: "Instruments", spend: 180000, target: 200000, pct: 90.0 },
  { category: "Implants", spend: 420000, target: 450000, pct: 93.3 },
  { category: "Equipment", spend: 150000, target: 180000, pct: 83.3 },
]
