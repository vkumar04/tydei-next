"use client"

import type { Dispatch, SetStateAction } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Trash2, Plus } from "lucide-react"

import { ALL_CATEGORIES } from "./construct-form"

/** Facility estimated spend, ONE ROW PER CATEGORY (Charles 2026-07-05
 *  "should be able to enter more than one category spend"). */
interface CategorySpendRow {
  _uid: string
  category: string
  spend: string
}

interface AssumptionFieldsProps {
  targetMargin: string
  setTargetMargin: Dispatch<SetStateAction<string>>
  floorMargin: string
  setFloorMargin: Dispatch<SetStateAction<string>>
  currentShare: string
  setCurrentShare: Dispatch<SetStateAction<string>>
  targetShare: string
  setTargetShare: Dispatch<SetStateAction<string>>
  categorySpends: CategorySpendRow[]
  setCategorySpends: Dispatch<SetStateAction<CategorySpendRow[]>>
  benchmarkCategories: string[]
  /** Seeds a BLANK spend row from the loaded usage + price files (or two-way
   *  actuals) — see estimate-category-spend.ts; the parent binds the loaded
   *  reference maps. */
  estimateCategorySpendFromFiles: (category: string) => number
  internalUnitCost: string
  setInternalUnitCost: Dispatch<SetStateAction<string>>
  isCapital: boolean
  equipmentCost: string
  setEquipmentCost: Dispatch<SetStateAction<string>>
  maintenanceCost: string
  setMaintenanceCost: Dispatch<SetStateAction<string>>
  termMonths: string
  setTermMonths: Dispatch<SetStateAction<string>>
  interestRate: string
  setInterestRate: Dispatch<SetStateAction<string>>
  discountRate: string
  setDiscountRate: Dispatch<SetStateAction<string>>
}

export function AssumptionFields({
  targetMargin,
  setTargetMargin,
  floorMargin,
  setFloorMargin,
  currentShare,
  setCurrentShare,
  targetShare,
  setTargetShare,
  categorySpends,
  setCategorySpends,
  benchmarkCategories,
  estimateCategorySpendFromFiles,
  internalUnitCost,
  setInternalUnitCost,
  isCapital,
  equipmentCost,
  setEquipmentCost,
  maintenanceCost,
  setMaintenanceCost,
  termMonths,
  setTermMonths,
  interestRate,
  setInterestRate,
  discountRate,
  setDiscountRate,
}: AssumptionFieldsProps) {
  return (
    <>
      <div className="grid gap-4 md:grid-cols-4">
        <div className="space-y-2">
          <Label htmlFor="target-margin">Target margin %</Label>
          <Input
            id="target-margin"
            type="number"
            value={targetMargin}
            onChange={(e) => setTargetMargin(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="floor-margin">Floor margin %</Label>
          <Input
            id="floor-margin"
            type="number"
            value={floorMargin}
            onChange={(e) => setFloorMargin(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="current-share">Current share %</Label>
          <Input
            id="current-share"
            type="number"
            placeholder="optional"
            value={currentShare}
            onChange={(e) => setCurrentShare(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="target-share">Target share %</Label>
          <Input
            id="target-share"
            type="number"
            placeholder="optional"
            value={targetShare}
            onChange={(e) => setTargetShare(e.target.value)}
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="estimated-spend-0">
          Facility estimated annual category spend ($)
        </Label>
        {categorySpends.map((row, i) => (
          <div key={row._uid} className="flex flex-col gap-2 sm:flex-row">
            <Input
              id={`estimated-spend-${i}`}
              type="number"
              placeholder="leave blank to estimate from your own sales"
              value={row.spend}
              onChange={(e) =>
                setCategorySpends((prev) =>
                  prev.map((r) =>
                    r._uid === row._uid
                      ? { ...r, spend: e.target.value }
                      : r,
                  ),
                )
              }
              className="flex-1 min-w-0"
            />
            <Select
              value={row.category || ALL_CATEGORIES}
              onValueChange={(v) => {
                const category = v === ALL_CATEGORIES ? "" : v
                // Seed a BLANK spend from the loaded usage + price files
                // (or two-way actuals) — an editable starting point, never
                // clobbering a typed value (bugs.rtfd 2026-07-07).
                const seeded = estimateCategorySpendFromFiles(category)
                setCategorySpends((prev) =>
                  prev.map((r) =>
                    r._uid === row._uid
                      ? {
                          ...r,
                          category,
                          spend:
                            !r.spend && seeded > 0
                              ? String(Math.round(seeded))
                              : r.spend,
                        }
                      : r,
                  ),
                )
              }}
            >
              <SelectTrigger className="w-full sm:w-[220px]">
                <SelectValue placeholder="Category" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_CATEGORIES}>
                  {i === 0 ? "All categories" : "Pick a category"}
                </SelectItem>
                {benchmarkCategories.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {categorySpends.length > 1 ? (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="shrink-0"
                onClick={() =>
                  setCategorySpends((prev) =>
                    prev.filter((r) => r._uid !== row._uid),
                  )
                }
              >
                <Trash2 className="h-4 w-4" />
                <span className="sr-only">Remove category spend</span>
              </Button>
            ) : null}
          </div>
        ))}
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() =>
            setCategorySpends((prev) => [
              ...prev,
              { _uid: crypto.randomUUID(), category: "", spend: "" },
            ])
          }
        >
          <Plus className="mr-1.5 h-3.5 w-3.5" />
          Add another category spend
        </Button>
        <p className="text-xs text-muted-foreground">
          The facility&apos;s TOTAL category spend across all vendors.
          Left blank, it&apos;s estimated from your own trailing-12mo
          sales to this facility — divided by Current share % when you
          provide one; otherwise penetration deltas are approximate.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="internal-unit-cost">Internal unit cost ($ / unit)</Label>
        <Input
          id="internal-unit-cost"
          type="number"
          inputMode="decimal"
          placeholder="leave blank to assume a 55% gross margin"
          value={internalUnitCost}
          onChange={(e) => setInternalUnitCost(e.target.value)}
        />
        <p className="text-xs text-muted-foreground">
          Your true COGS per unit. Drives the gross-margin verdict for every
          scenario. Left blank, the analysis falls back to a 55% gross-margin
          (45% COGS) assumption.
        </p>
      </div>

      {isCapital && (
        <div className="grid gap-4 rounded-md border bg-muted/20 p-3 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="equipment-cost">Equipment cost ($)</Label>
            <Input
              id="equipment-cost"
              type="number"
              value={equipmentCost}
              onChange={(e) => setEquipmentCost(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="maint-cost">Annual maintenance ($)</Label>
            <Input
              id="maint-cost"
              type="number"
              value={maintenanceCost}
              onChange={(e) => setMaintenanceCost(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="term-months">Term (months)</Label>
            <Input
              id="term-months"
              type="number"
              inputMode="numeric"
              value={termMonths}
              onChange={(e) => setTermMonths(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="interest-rate">Interest %</Label>
            <Input
              id="interest-rate"
              type="number"
              inputMode="decimal"
              value={interestRate}
              onChange={(e) => setInterestRate(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="discount-rate">Discount %</Label>
            <Input
              id="discount-rate"
              type="number"
              inputMode="decimal"
              value={discountRate}
              onChange={(e) => setDiscountRate(e.target.value)}
            />
          </div>
        </div>
      )}
    </>
  )
}
