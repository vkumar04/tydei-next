/**
 * Typed metadata shapes for each alert type per spec §3
 * (docs/superpowers/specs/2026-04-18-alerts-rewrite.md).
 *
 * These live separately from the synthesizer so the UI / detail-page
 * components can import them without pulling in the engine.
 */

export interface OffContractMeta {
  po_id: string
  vendor_name: string
  item_count: number
  total_amount: number
  items: Array<{
    sku: string
    name: string
    quantity: number
    unitPrice: number
    contractPrice: number | null
  }>
}

export interface ExpiringContractMeta {
  contract_name: string
  contract_id: string
  vendor_name: string
  days_until_expiry: number
  expiration_date: string // ISO yyyy-mm-dd
  annual_value: number
}

export interface TierThresholdMeta {
  contract_name: string
  contract_id: string
  current_spend: number
  tier_threshold: number
  amount_needed: number
  target_tier: number
  tier_rebate: number
}

export interface RebateDueMeta {
  contract_name: string
  contract_id: string
  vendor_name: string
  amount: number
  period: string // e.g. "2026-Q1" or "2026-03"
  period_id: string
}

export interface PaymentDueMeta {
  contract_name: string
  contract_id: string
  vendor_name: string
  amount: number
  due_date: string // ISO yyyy-mm-dd
}

export type AlertMetadata =
  | OffContractMeta
  | ExpiringContractMeta
  | TierThresholdMeta
  | RebateDueMeta
  | PaymentDueMeta
