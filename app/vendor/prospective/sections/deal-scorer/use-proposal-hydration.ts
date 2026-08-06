"use client"

import { useEffect, useRef } from "react"
import type { Dispatch, SetStateAction } from "react"
import { toast } from "sonner"

import { normalizeSku } from "@/lib/contracts/normalize-sku"
import { getVendorProposalDetail } from "@/lib/actions/prospective"
import type { VendorContractVariant } from "@/lib/prospective-analysis/vendor-prospective-analyzer"
import { NO_PROPOSAL, makeConstruct, type ConstructForm } from "./construct-form"

/** Every state setter the hydration writes — threaded in as a bundle so the
 *  effect body below stays exactly the one that lived in DealScorerSection.
 *  All members are React state setters (stable identities); the effect keys
 *  on `proposalRowId` alone, as it always has. */
export interface ProposalHydrationSetters {
  setFacilityId: Dispatch<SetStateAction<string>>
  setProposalCategories: Dispatch<SetStateAction<string[]>>
  setCategorySpends: Dispatch<
    SetStateAction<{ _uid: string; category: string; spend: string }[]>
  >
  setUsageVolumeBySku: Dispatch<SetStateAction<Map<string, number>>>
  setUsageLoadedCount: Dispatch<SetStateAction<number>>
  setCurrentPriceBySku: Dispatch<SetStateAction<Map<string, number>>>
  setPriceLoadedCount: Dispatch<SetStateAction<number>>
  setTargetMargin: Dispatch<SetStateAction<string>>
  setFloorMargin: Dispatch<SetStateAction<string>>
  setCurrentShare: Dispatch<SetStateAction<string>>
  setInternalUnitCost: Dispatch<SetStateAction<string>>
  setContractVariant: Dispatch<SetStateAction<VendorContractVariant>>
  setEquipmentCost: Dispatch<SetStateAction<string>>
  setMaintenanceCost: Dispatch<SetStateAction<string>>
  setTermMonths: Dispatch<SetStateAction<string>>
  setInterestRate: Dispatch<SetStateAction<string>>
  setDiscountRate: Dispatch<SetStateAction<string>>
  setTargetShare: Dispatch<SetStateAction<string>>
  setConstructs: Dispatch<SetStateAction<ConstructForm[]>>
}

// When a real proposal is attached (via preselect OR the dropdown), load its
// usage + pricing as the REFERENCE — you enter usage + pricing ONCE (in the
// proposal); the proposal's per-item quantity fills Volume and its current
// price fills Current when you pick a product from the benchmark list.
// Constructs come ONLY from the benchmark dropdown, never from the proposal's
// products (Vick 2026-06-25: "constructs can only come from benchmark upload;
// only need to enter usage and pricing once"). Any prior saved deal (benchmark
// picks + Floor/Target) is restored so leaving and coming back doesn't lose
// it. One-shot per proposal id.
export function useProposalHydration(
  proposalRowId: string,
  setters: ProposalHydrationSetters,
) {
  const {
    setFacilityId,
    setProposalCategories,
    setCategorySpends,
    setUsageVolumeBySku,
    setUsageLoadedCount,
    setCurrentPriceBySku,
    setPriceLoadedCount,
    setTargetMargin,
    setFloorMargin,
    setCurrentShare,
    setInternalUnitCost,
    setContractVariant,
    setEquipmentCost,
    setMaintenanceCost,
    setTermMonths,
    setInterestRate,
    setDiscountRate,
    setTargetShare,
    setConstructs,
  } = setters
  const appliedProposalRef = useRef<string | null>(null)
  useEffect(() => {
    if (proposalRowId === NO_PROPOSAL || appliedProposalRef.current === proposalRowId) return
    appliedProposalRef.current = proposalRowId
    void getVendorProposalDetail(proposalRowId)
      .then((detail) => {
        // The facility is part of the proposal too — set it so it isn't
        // re-entered (Vick 2026-06-25 "missing information from the proposals
        // page"). Only when the proposal targets a single real facility.
        if (detail.facilities.length === 1 && detail.facilities[0]) {
          setFacilityId(detail.facilities[0].id)
        }
        const cats = (detail.productCategories ?? []).filter(Boolean)
        setProposalCategories(cats)
        // Seed the estimated-spend category from the proposal's first
        // category — only while the picker is untouched.
        if (cats[0]) {
          setCategorySpends((prev) =>
            prev.length === 1 && !prev[0]!.category
              ? [{ ...prev[0]!, category: cats[0]! }]
              : prev,
          )
        }
        const items = detail.pricingItems ?? []
        const volMap = new Map<string, number>()
        const priceMap = new Map<string, number>()
        for (const it of items) {
          const sku = normalizeSku(it.vendorItemNo)
          if (!sku) continue
          if (it.quantity != null && it.quantity > 0) volMap.set(sku, it.quantity)
          if (it.currentPrice != null && it.currentPrice > 0) priceMap.set(sku, it.currentPrice)
        }
        if (volMap.size > 0) {
          setUsageVolumeBySku(volMap)
          setUsageLoadedCount(volMap.size)
        }
        if (priceMap.size > 0) {
          setCurrentPriceBySku(priceMap)
          setPriceLoadedCount(priceMap.size)
        }
        // Wave-2 D (consolidation round-trip): restore the saved Step-1
        // assumptions so a saved deal re-opens with ZERO re-entry. Typed
        // string states are only filled while still at their PRISTINE seed
        // (margins "40"/"25", capital "60"/"5"/"10", everything else "") so
        // a value the user already typed is never clobbered; the selects
        // (contract variant / spend category) restore via their setters.
        // Stored in UI units (whole percents) — plain String(), no ×100
        // (see lib/prospective/deal-assumptions.ts). Runs BEFORE the
        // cost-basis seed below so the analyzed internal unit cost wins.
        const fillAtPristine = (
          set: Dispatch<SetStateAction<string>>,
          pristine: string,
          value: number | string | null | undefined,
        ) => {
          if (value == null || value === "") return
          set((prev) => (prev === pristine ? String(value) : prev))
        }
        const a = detail.dealAssumptions
        if (a) {
          fillAtPristine(setTargetMargin, "40", a.targetMarginPct)
          fillAtPristine(setFloorMargin, "25", a.floorMarginPct)
          fillAtPristine(setCurrentShare, "", a.currentSharePct)
          setCategorySpends((prev) => {
            const pristine =
              prev.length === 1 && !prev[0]!.category && !prev[0]!.spend
            if (!pristine) return prev
            const saved = a.estimatedCategorySpends?.length
              ? a.estimatedCategorySpends
              : a.estimatedSpend != null || a.estimatedSpendCategory
                ? [
                    {
                      category: a.estimatedSpendCategory ?? "",
                      spend: a.estimatedSpend,
                    },
                  ]
                : null
            return saved
              ? saved.map((r) => ({
                  _uid: crypto.randomUUID(),
                  category: r.category ?? "",
                  spend: r.spend != null ? String(r.spend) : "",
                }))
              : prev
          })
          fillAtPristine(setInternalUnitCost, "", a.internalUnitCost)
          setContractVariant(a.contractVariant)
          if (a.capital) {
            fillAtPristine(setEquipmentCost, "", a.capital.equipmentCost)
            if (a.capital.annualMaintenanceCost > 0) {
              fillAtPristine(
                setMaintenanceCost,
                "",
                a.capital.annualMaintenanceCost,
              )
            }
            fillAtPristine(setTermMonths, "60", a.capital.termMonths)
            fillAtPristine(setInterestRate, "5", a.capital.interestRatePct)
            fillAtPristine(setDiscountRate, "10", a.capital.discountRatePct)
          }
        }
        // Target share already rides the persisted dealHandoff
        // (dealTargetSharePct) — restore it from there, same guard.
        fillAtPristine(setTargetShare, "", detail.dealHandoff?.targetSharePct)
        // Seed internal unit cost from the builder upload's cost-basis column
        // (quantity-weighted average) — only when the field is still blank,
        // so a typed value is never clobbered.
        const costed = items.filter(
          (it) => it.costBasis != null && it.costBasis > 0,
        )
        if (costed.length > 0) {
          const totalQty = costed.reduce((s, it) => s + (it.quantity ?? 1), 0)
          const weighted =
            costed.reduce(
              (s, it) => s + it.costBasis! * (it.quantity ?? 1),
              0,
            ) / Math.max(1, totalQty)
          setInternalUnitCost((prev) =>
            prev ? prev : String(Math.round(weighted * 100) / 100),
          )
        }
        // Restore prior benchmark picks (the saved deal) — constructs only.
        const saved = detail.dealConstructs ?? []
        if (saved.length > 0) {
          setConstructs(
            saved.map((c) =>
              makeConstruct({
                benchmarkId: c.benchmarkId,
                productName: c.productName || "(unnamed)",
                category: c.category ?? "",
                current: c.current ? String(c.current) : "",
                floor: c.floor ? String(c.floor) : "",
                target: c.target ? String(c.target) : "",
                ask: c.ask ? String(c.ask) : "",
                annualVolume: c.annualVolume ? String(c.annualVolume) : "",
                rebatePercent: c.rebatePercent ? String(c.rebatePercent) : "0",
              }),
            ),
          )
        }
        const refCount = Math.max(volMap.size, priceMap.size)
        if (saved.length > 0) {
          toast.success("Loaded your saved deal + usage/pricing from the proposal")
        } else if (refCount > 0) {
          toast.success(
            `Loaded usage + pricing for ${refCount} item${refCount === 1 ? "" : "s"} — add products from the benchmark list`,
          )
        }
      })
      .catch(() => {
        /* non-fatal: leave the grid as-is */
      })
  }, [proposalRowId])
}
