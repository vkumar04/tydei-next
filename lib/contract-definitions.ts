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
