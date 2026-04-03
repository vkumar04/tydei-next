// ─── Structured definitions for tooltips ────────────────────────

export const contractTypeDefinitions = {
  usage: {
    label: "Usage-Based",
    shortLabel: "Usage",
    description:
      "Rebates are calculated based on the volume or dollar amount of products purchased. The more you buy, the higher your rebate tier.",
    examples: ["Spend $100K, get 3% rebate", "Purchase 1000 units, earn $5/unit"],
    bestFor: "High-volume purchases with predictable spending patterns",
  },
  capital: {
    label: "Capital Equipment",
    shortLabel: "Capital",
    description:
      "Covers large equipment purchases with associated service, maintenance, and consumable pricing. Often includes installation and training.",
    examples: ["MRI machine with 5-year service", "Surgical robot with consumables bundle"],
    bestFor: "Major equipment acquisitions with long-term support needs",
  },
  service: {
    label: "Service Agreement",
    shortLabel: "Service",
    description:
      "Covers ongoing service, maintenance, or support arrangements rather than product purchases. May include SLAs, response times, and uptime guarantees.",
    examples: ["Annual equipment maintenance", "Managed service with SLA"],
    bestFor: "Ongoing service relationships with defined performance standards",
  },
  tie_in: {
    label: "Tie-In / Bundled",
    shortLabel: "Tie-In",
    description:
      "Links purchasing commitments across multiple product lines or categories. Rebates or pricing depend on meeting aggregate targets across the bundle.",
    examples: ["Buy implants + instruments for bundled discount", "Cross-category volume commitment"],
    bestFor: "Multi-category vendor relationships with linked commitments",
  },
  grouped: {
    label: "GPO / Group Contract",
    shortLabel: "Grouped",
    description:
      "Negotiated through a Group Purchasing Organization (GPO). Leverages collective buying power of multiple facilities for better pricing.",
    examples: ["Premier contract", "Vizient agreement", "HealthTrust pricing"],
    bestFor: "Facilities that are members of purchasing cooperatives",
  },
  pricing_only: {
    label: "Pricing Only",
    shortLabel: "Pricing",
    description:
      "A straightforward pricing agreement without rebate structures. You receive discounted prices upfront rather than rebates after purchase.",
    examples: ["15% off list price", "Fixed unit pricing"],
    bestFor: "Simple purchasing relationships without volume commitments",
  },
} as const

export const rebateTypeDefinitions = {
  percent_of_spend: {
    label: "Percent of Spend",
    description:
      "Rebate is calculated as a percentage of your total spending.",
    formula: "Rebate = Total Spend x Rebate %",
    example: "$200,000 spend x 4% = $8,000 rebate",
  },
  flat_amount: {
    label: "Flat Amount",
    description:
      "A fixed dollar rebate regardless of spend amount within the tier. Simple and predictable.",
    formula: "Rebate = Fixed Amount per Tier",
    example: "Tier 1 = $5,000 flat rebate",
  },
  per_unit: {
    label: "Per Unit",
    description:
      "Rebate is calculated based on the number of units purchased. Each unit earns a fixed rebate amount.",
    formula: "Rebate = Units Purchased x Rebate per Unit",
    example: "500 units x $10/unit = $5,000 rebate",
  },
  tiered_progressive: {
    label: "Tiered Progressive",
    description:
      "Different rebate rates apply to different portions of spend. Higher tiers only apply to spend above threshold.",
    formula: "Each tier rate applies only to spend within that tier",
    example: "First $100K at 2%, next $100K at 4%, above $200K at 6%",
  },
} as const

export const tierStructureDefinitions = {
  spend_threshold: {
    label: "Spend Threshold",
    description:
      "Tiers are based on total dollar amount spent. As your spending increases, you qualify for higher rebate rates.",
    example: "Tier 1: $0-$100K (2%), Tier 2: $100K-$250K (4%), Tier 3: $250K+ (6%)",
  },
  market_share: {
    label: "Market Share",
    description:
      "Rebates are tied to the percentage of your total category spend that goes to this vendor. Rewards vendor loyalty.",
    example:
      "If 60% of your orthopedic spend is with this vendor, you get the 60% market share tier rate",
    note: "Requires accurate category spend tracking",
  },
  volume_units: {
    label: "Volume/Units",
    description:
      "Tiers are based on the number of units purchased rather than dollar amounts. Good for standardized products.",
    example: "Tier 1: 0-500 units (3%), Tier 2: 501-1000 units (5%), Tier 3: 1001+ units (7%)",
  },
  compliance_based: {
    label: "Compliance-Based",
    description:
      "Rebates depend on meeting specific compliance requirements like ordering through approved channels or meeting reporting deadlines.",
    example: "Base rebate 3%, +1% for EDI ordering, +0.5% for quarterly reporting",
  },
  growth_incentive: {
    label: "Growth Incentive",
    description:
      "Additional rebates for increasing purchases compared to a baseline period (usually prior year).",
    example: "10% growth over last year = additional 2% rebate on incremental spend",
  },
} as const

export const performancePeriodDefinitions = {
  monthly: {
    label: "Monthly",
    description:
      "Performance is evaluated every month. Faster feedback but more administrative overhead.",
    pros: ["Quick tier adjustments", "Easier cash flow planning"],
    cons: ["More administrative work", "May not capture seasonal patterns"],
  },
  quarterly: {
    label: "Quarterly",
    description:
      "Performance is evaluated every 3 months. Balances responsiveness with administrative simplicity.",
    pros: ["Good balance of feedback and effort", "Aligns with fiscal quarters"],
    cons: ["May delay tier advancement", "3-month lag on rebate recognition"],
  },
  semi_annual: {
    label: "Semi-Annual",
    description:
      "Performance is evaluated every 6 months. Fewer evaluation cycles with longer accumulation windows.",
    pros: ["Lower admin burden", "Larger spend windows help hit tiers"],
    cons: ["Slow feedback loop", "Harder to course-correct"],
  },
  annual: {
    label: "Annual",
    description:
      "Performance is evaluated once per year. Simplest to administer but longest feedback cycle.",
    pros: ["Minimal administration", "Full year to achieve targets"],
    cons: ["Long wait for rebates", "Difficult to course-correct mid-year"],
  },
} as const

export type ContractType = keyof typeof contractTypeDefinitions
export type RebateType = keyof typeof rebateTypeDefinitions
export type TierStructure = keyof typeof tierStructureDefinitions
export type PerformancePeriod = keyof typeof performancePeriodDefinitions

// ─── Flat definition map (legacy / simple tooltips) ─────────────

export const CONTRACT_DEFINITIONS: Record<string, string> = {
  spend_rebate:
    "A rebate earned when cumulative spend reaches defined thresholds during the evaluation period. Higher spend tiers typically yield larger rebate percentages.",
  volume_rebate:
    "A rebate based on the number of units purchased rather than dollar spend. Baseline thresholds are expressed in dollar amounts but tracking is volume-driven.",
  price_reduction:
    "Once a spend or volume threshold is met, future purchases within the period receive a discounted unit price instead of a retrospective rebate payment.",
  market_share:
    "The percentage of a facility's total category spend allocated to this vendor. Meeting market share targets can unlock rebates or preferential pricing.",
  market_share_price_reduction:
    "Once the facility achieves a target market share percentage with this vendor, future purchases receive a reduced unit price.",
  capitated_price_reduction:
    "A per-procedure ceiling price model. Once procedure spend reaches a threshold, subsequent procedures receive discounted pricing for the remainder of the period.",
  capitated_pricing_rebate:
    "A per-procedure ceiling price with a retrospective rebate. The vendor guarantees a maximum cost per procedure and rebates the difference if actual cost is lower.",
  growth_rebate:
    "A rebate based on spend growth compared to a prior baseline period. Rewards facilities for increasing purchasing volume year-over-year with the vendor.",
  compliance_rebate:
    "A rebate earned by meeting specific compliance requirements such as standardization targets, reporting obligations, or product utilization benchmarks.",
  fixed_fee:
    "A flat dollar amount paid as a rebate regardless of spend or volume levels. Often used for administrative fees or guaranteed minimum payments.",
  locked_pricing:
    "Pricing that is contractually fixed for the duration of the agreement. The vendor cannot increase unit prices until the contract expires or is renegotiated.",
  gpo_affiliation:
    "Group Purchasing Organization membership that provides access to pre-negotiated pricing tiers. GPO contracts aggregate volume across member facilities for better rates.",
  performance_period:
    "The time window over which spend, volume, or compliance is measured against tier thresholds. Common periods are quarterly, semi-annual, or annual.",
  rebate_pay_period:
    "The cadence at which earned rebates are calculated and paid out to the facility. Typically quarterly or annually, often with a 30-90 day processing lag.",
  auto_renewal:
    "A clause that automatically extends the contract for an additional term unless one party provides written notice of termination within the required notice window.",
  termination_notice:
    "The number of days advance written notice required to terminate or non-renew a contract before its expiration or auto-renewal date.",
  tier:
    "A threshold level in a rebate or pricing structure. Each tier defines a minimum spend or volume target and the corresponding rebate percentage or price discount.",
  evaluation_period:
    "The cadence at which the facility's performance against contract tiers is assessed — monthly, quarterly, semi-annually, or annually.",
  baseline_type:
    "The metric used to measure performance against tier thresholds: spend-based (dollar amount), volume-based (unit count), or growth-based (year-over-year change).",
  total_value:
    "The estimated total dollar value of the contract over its full term, including projected spend and anticipated rebate earnings.",
  annual_value:
    "The estimated annual dollar value of the contract, used for budgeting and comparing contracts of different durations on a normalized basis.",
}
