"use client"

/**
 * Charles audit suggestion #4 (v0-port): per-asset capital line item
 * editor. Mirrors v0's `tie-in-contract-details.tsx` LeasedServiceItem
 * cards — vendor/facility add multiple equipment items, each with its
 * own description / item # / serial / financed amount / rate / term /
 * cadence / payment type. Aggregates into the contract's overall
 * amortization view via the line-items aggregator.
 *
 * Pure controlled component — parent owns the state. The submission
 * pipeline (vendor + facility) decides when to persist (immediately
 * via createCapitalLineItem on edit pages, or as part of the contract
 * create/approve flow).
 */

import { useState } from "react"
import { Plus, Trash2, ChevronDown, ChevronUp, Package } from "lucide-react"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { formatCurrency } from "@/lib/formatting"
import { TieInAmortizationPreview } from "@/components/contracts/tie-in-amortization-preview"

export interface CapitalLineItemDraft {
  /** Optional — server-generated for persisted rows; tempId for unsaved rows. */
  id?: string
  /**
   * UI-only stable identity. Set once via `crypto.randomUUID()` when a row
   * is created or hydrated and NEVER changes for the life of the row, so
   * React keys + per-row expand state survive a middle-row delete (which
   * reindexes the array). NOT part of the persist payload — every consumer
   * builds its create/update/delete payload field-by-field and omits this.
   * Do not conflate with `id` (the server DB id used to diff new-vs-existing
   * rows on save).
   */
  _uid: string
  description: string
  itemNumber: string
  serialNumber: string
  contractTotal: number
  initialSales: number
  /** Per-item interest rate as percent points (5 = 5%). Stored as fraction at boundary. */
  interestRatePercent: number
  termMonths: number
  paymentType: "fixed" | "variable"
  paymentCadence: "monthly" | "quarterly" | "semi_annual" | "annual"
}

export function makeEmptyCapitalLineItem(): CapitalLineItemDraft {
  return {
    _uid: crypto.randomUUID(),
    description: "",
    itemNumber: "",
    serialNumber: "",
    contractTotal: 0,
    initialSales: 0,
    interestRatePercent: 0,
    termMonths: 60,
    paymentType: "fixed",
    paymentCadence: "monthly",
  }
}

export interface SeedCapitalLineItemInput {
  /** Best-available financed total: capitalCost → totalValue → annualValue. */
  financedTotal: number
  description?: string | null
  contractName?: string | null
  downPayment?: number | null
  interestRatePercent?: number | null
  termMonths?: number | null
  paymentCadence?: CapitalLineItemDraft["paymentCadence"] | null
}

/**
 * Build a prefilled capital line item for a tie_in / capital contract so the
 * Capital / Leased Items editor never lands empty — an empty editor BLOCKS
 * save (the submit gate requires >=1 capital item). Shared by BOTH the
 * AI-extract handler and the manual contractType→tie_in/capital safety-net
 * seed in new-contract-client.tsx so the two paths can never drift. Builds on
 * makeEmptyCapitalLineItem() (same `_uid`/defaults), overriding only the
 * fields we can prefill. Vick "AI not grabbing the capital again on the Tie
 * in" 2026-06-22.
 */
/**
 * Resolve the financed total to seed a capital line item from an AI
 * extraction (or form state): prefer the explicit `capitalCost`, then the
 * `totalValue` commitment, then a caller-supplied fallback (the facility form
 * passes annualValue; the vendor form passes 0). Both the facility
 * new-contract handler and the vendor submission handler route through this
 * one resolver so the fallback order can't drift. Vick "Not grabbing capital
 * still" 2026-06-22.
 */
export function resolveSeededFinancedTotal(input: {
  capitalCost?: number | null
  totalValue?: number | null
  fallback?: number | null
}): number {
  if ((input.capitalCost ?? 0) > 0) return input.capitalCost!
  if ((input.totalValue ?? 0) > 0) return input.totalValue!
  return Math.max(0, input.fallback ?? 0)
}

export function buildSeededCapitalLineItem(
  input: SeedCapitalLineItemInput,
): CapitalLineItemDraft {
  return {
    ...makeEmptyCapitalLineItem(),
    description:
      input.description?.slice(0, 80) ||
      input.contractName ||
      "Capital equipment",
    contractTotal: input.financedTotal,
    initialSales: input.downPayment ?? 0,
    interestRatePercent: input.interestRatePercent ?? 0,
    termMonths: input.termMonths ?? 60,
    paymentCadence: input.paymentCadence ?? "monthly",
  }
}

interface CapitalLineItemsEditorProps {
  items: CapitalLineItemDraft[]
  onChange: (next: CapitalLineItemDraft[]) => void
}

export function CapitalLineItemsEditor({
  items: itemsProp,
  onChange,
}: CapitalLineItemsEditorProps) {
  // Defensive: a parent passing undefined (e.g. serialized draft without
  // capitalLineItems) must not crash the whole entry form with
  // "Cannot read properties of undefined (reading 'length')".
  const items = itemsProp ?? []
  // Track expand state by the row's stable `_uid`, never by array index —
  // deleting a middle row reindexes survivors, so an index-keyed Set would
  // leave the wrong panel open / reuse a sibling row's state.
  const [expandedIds, setExpandedIds] = useState<Set<string>>(
    () => new Set(items.length === 0 ? [] : [items[0]._uid]),
  )

  const toggle = (uid: string) => {
    const next = new Set(expandedIds)
    if (next.has(uid)) next.delete(uid)
    else next.add(uid)
    setExpandedIds(next)
  }

  const add = () => {
    const created = makeEmptyCapitalLineItem()
    onChange([...items, created])
    setExpandedIds(new Set([...expandedIds, created._uid]))
  }

  const remove = (uid: string) => {
    onChange(items.filter((it) => it._uid !== uid))
    const next = new Set(expandedIds)
    next.delete(uid)
    setExpandedIds(next)
  }

  const update = (uid: string, patch: Partial<CapitalLineItemDraft>) => {
    onChange(items.map((it) => (it._uid === uid ? { ...it, ...patch } : it)))
  }

  const totalFinanced = items.reduce(
    (acc, i) => acc + Math.max(0, i.contractTotal - i.initialSales),
    0,
  )
  const totalContract = items.reduce((acc, i) => acc + i.contractTotal, 0)

  return (
    <Card>
      <CardHeader>
        <div className="flex items-baseline justify-between gap-4">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Package className="size-4 text-muted-foreground" />
              Capital / Leased Items
              {items.length > 0 && (
                <Badge variant="secondary" className="text-[10px]">
                  {items.length}
                </Badge>
              )}
            </CardTitle>
            <CardDescription>
              One row per piece of financed equipment. Each item amortizes
              against its own rate, term, and cadence; the contract&apos;s
              total amortization is the sum.
            </CardDescription>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={add}>
            <Plus className="mr-1 size-3.5" />
            Add Item
          </Button>
        </div>
        {items.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-xs tabular-nums">
            <span>
              <span className="text-muted-foreground">Contract total:</span>{" "}
              <span className="font-medium">{formatCurrency(totalContract)}</span>
            </span>
            <span>
              <span className="text-muted-foreground">Financed:</span>{" "}
              <span className="font-medium">{formatCurrency(totalFinanced)}</span>
            </span>
          </div>
        )}
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
            No capital items yet. Click <strong>Add Item</strong> to add a
            piece of financed equipment.
          </div>
        ) : (
          <div className="space-y-2">
            {items.map((item, idx) => {
              const isOpen = expandedIds.has(item._uid)
              const financed = Math.max(0, item.contractTotal - item.initialSales)
              return (
                <div key={item._uid} className="rounded-md border">
                  <button
                    type="button"
                    onClick={() => toggle(item._uid)}
                    className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left hover:bg-muted/40"
                  >
                    <div className="flex min-w-0 flex-1 items-baseline gap-2">
                      <span className="text-xs text-muted-foreground tabular-nums">
                        #{idx + 1}
                      </span>
                      <span className="font-medium text-sm truncate">
                        {item.description || "Untitled item"}
                      </span>
                      <span className="text-xs text-muted-foreground tabular-nums">
                        · {formatCurrency(financed)} financed @{" "}
                        {item.interestRatePercent}%
                      </span>
                    </div>
                    <div className="flex items-center gap-1">
                      {isOpen ? (
                        <ChevronUp className="size-4 text-muted-foreground" />
                      ) : (
                        <ChevronDown className="size-4 text-muted-foreground" />
                      )}
                    </div>
                  </button>
                  {isOpen && (
                    <div className="space-y-3 border-t p-3">
                      <div className="grid gap-3 sm:grid-cols-2">
                        <Field label="Description" required>
                          <Input
                            value={item.description}
                            onChange={(e) =>
                              update(item._uid, { description: e.target.value })
                            }
                            placeholder="e.g., Stryker MAKO Robotic Arm"
                          />
                        </Field>
                        <Field label="Item #">
                          <Input
                            value={item.itemNumber}
                            onChange={(e) =>
                              update(item._uid, { itemNumber: e.target.value })
                            }
                            placeholder="MAKO-2024-RIO"
                          />
                        </Field>
                        <Field label="Serial #">
                          <Input
                            value={item.serialNumber}
                            onChange={(e) =>
                              update(item._uid, { serialNumber: e.target.value })
                            }
                            placeholder="SN-12345"
                          />
                        </Field>
                        <Field label="Contract Total ($)">
                          <Input
                            type="number"
                            min="0"
                            step="0.01"
                            value={item.contractTotal}
                            onChange={(e) =>
                              update(item._uid, {
                                contractTotal: Number(e.target.value),
                              })
                            }
                          />
                        </Field>
                        <Field label="Initial Sales / Down Payment ($)">
                          <Input
                            type="number"
                            min="0"
                            // Bug #11: cap down payment at the contract total
                            // so a user can't enter a value that zeroes out
                            // financed principal and silently breaks the
                            // amortization schedule (every column $0).
                            max={item.contractTotal || undefined}
                            step="0.01"
                            value={item.initialSales}
                            onChange={(e) => {
                              const next = Number(e.target.value)
                              update(item._uid, {
                                initialSales: Math.min(
                                  Math.max(0, next),
                                  item.contractTotal || next,
                                ),
                              })
                            }}
                          />
                          {item.initialSales >= item.contractTotal &&
                            item.contractTotal > 0 && (
                              <p className="mt-1 text-[11px] text-amber-700 dark:text-amber-400">
                                Down payment equals contract total — nothing
                                will be financed and the amortization schedule
                                will be empty. Set this lower than the contract
                                total to amortize.
                              </p>
                            )}
                        </Field>
                        <Field label="Interest Rate (%)">
                          <Input
                            type="number"
                            min="0"
                            max="100"
                            step="0.01"
                            value={item.interestRatePercent}
                            onChange={(e) =>
                              update(item._uid, {
                                interestRatePercent: Number(e.target.value),
                              })
                            }
                          />
                        </Field>
                        <Field label="Term (months)">
                          <Input
                            type="number"
                            min="0"
                            step="1"
                            value={item.termMonths}
                            onChange={(e) =>
                              update(item._uid, { termMonths: Number(e.target.value) })
                            }
                          />
                        </Field>
                        <Field label="Payment Type">
                          <Select
                            value={item.paymentType}
                            onValueChange={(v) =>
                              update(item._uid, {
                                paymentType: v as "fixed" | "variable",
                              })
                            }
                          >
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="fixed">
                                Fixed (even split)
                              </SelectItem>
                              <SelectItem value="variable">
                                Variable (per-period amounts)
                              </SelectItem>
                            </SelectContent>
                          </Select>
                        </Field>
                        <Field label="Payment Cadence">
                          <Select
                            value={item.paymentCadence}
                            onValueChange={(v) =>
                              update(item._uid, {
                                paymentCadence: v as
                                  | "monthly"
                                  | "quarterly"
                                  | "semi_annual"
                                  | "annual",
                              })
                            }
                          >
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="monthly">Monthly</SelectItem>
                              <SelectItem value="quarterly">Quarterly</SelectItem>
                              <SelectItem value="semi_annual">Semi-Annual</SelectItem>
                              <SelectItem value="annual">Annual</SelectItem>
                            </SelectContent>
                          </Select>
                        </Field>
                      </div>
                      <div className="flex items-center justify-between gap-2 border-t pt-2 text-xs text-muted-foreground tabular-nums">
                        <span>
                          Financed: {formatCurrency(financed)} ={" "}
                          {formatCurrency(item.contractTotal)} −{" "}
                          {formatCurrency(item.initialSales)}
                        </span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => remove(item._uid)}
                          className="text-destructive hover:text-destructive"
                        >
                          <Trash2 className="mr-1 size-3.5" />
                          Remove
                        </Button>
                      </div>
                      {/* Charles 2026-04-26 (Image #73): inline
                          amortization preview restored. The dead-code
                          purge removed the contract-capital-entry
                          wrapper that used to host this; readd at the
                          per-item level so each capital row shows its
                          own schedule live as the user types. */}
                      {financed > 0 && item.termMonths > 0 && (
                        <div className="border-t pt-3">
                          <TieInAmortizationPreview
                            capitalCost={item.contractTotal}
                            downPayment={item.initialSales}
                            interestRate={item.interestRatePercent / 100}
                            termMonths={item.termMonths}
                            paymentCadence={item.paymentCadence}
                            effectiveStart={new Date()
                              .toISOString()
                              .slice(0, 10)}
                            // 2026-04-28: respect paymentType — Charles
                            // reported "Variable does not work on the
                            // schedule only fixed". Pre-fix the preview
                            // was hardcoded to symmetrical regardless
                            // of the picker.
                            amortizationShape={
                              item.paymentType === "variable"
                                ? "custom"
                                : "symmetrical"
                            }
                            onCustomRowsChange={() => {}}
                          />
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function Field({
  label,
  required,
  children,
}: {
  label: string
  required?: boolean
  children: React.ReactNode
}) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">
        {label}
        {required && <span className="ml-0.5 text-destructive">*</span>}
      </Label>
      {children}
    </div>
  )
}
