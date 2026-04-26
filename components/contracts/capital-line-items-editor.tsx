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

export interface CapitalLineItemDraft {
  /** Optional — server-generated for persisted rows; tempId for unsaved rows. */
  id?: string
  description: string
  itemNumber: string
  serialNumber: string
  contractTotal: number
  initialSales: number
  /** Per-item interest rate as percent points (5 = 5%). Stored as fraction at boundary. */
  interestRatePercent: number
  termMonths: number
  paymentType: "fixed" | "variable"
  paymentCadence: "monthly" | "quarterly" | "annual"
}

export function makeEmptyCapitalLineItem(): CapitalLineItemDraft {
  return {
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

interface CapitalLineItemsEditorProps {
  items: CapitalLineItemDraft[]
  onChange: (next: CapitalLineItemDraft[]) => void
}

export function CapitalLineItemsEditor({
  items,
  onChange,
}: CapitalLineItemsEditorProps) {
  const [expandedIdx, setExpandedIdx] = useState<Set<number>>(
    () => new Set(items.length === 0 ? [] : [0]),
  )

  const toggle = (idx: number) => {
    const next = new Set(expandedIdx)
    if (next.has(idx)) next.delete(idx)
    else next.add(idx)
    setExpandedIdx(next)
  }

  const add = () => {
    const next = [...items, makeEmptyCapitalLineItem()]
    onChange(next)
    setExpandedIdx(new Set([...expandedIdx, next.length - 1]))
  }

  const remove = (idx: number) => {
    onChange(items.filter((_, i) => i !== idx))
    const next = new Set<number>()
    for (const i of expandedIdx) {
      if (i < idx) next.add(i)
      else if (i > idx) next.add(i - 1)
    }
    setExpandedIdx(next)
  }

  const update = (idx: number, patch: Partial<CapitalLineItemDraft>) => {
    onChange(items.map((it, i) => (i === idx ? { ...it, ...patch } : it)))
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
              const isOpen = expandedIdx.has(idx)
              const financed = Math.max(0, item.contractTotal - item.initialSales)
              return (
                <div key={idx} className="rounded-md border">
                  <button
                    type="button"
                    onClick={() => toggle(idx)}
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
                              update(idx, { description: e.target.value })
                            }
                            placeholder="e.g., Stryker MAKO Robotic Arm"
                          />
                        </Field>
                        <Field label="Item #">
                          <Input
                            value={item.itemNumber}
                            onChange={(e) =>
                              update(idx, { itemNumber: e.target.value })
                            }
                            placeholder="MAKO-2024-RIO"
                          />
                        </Field>
                        <Field label="Serial #">
                          <Input
                            value={item.serialNumber}
                            onChange={(e) =>
                              update(idx, { serialNumber: e.target.value })
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
                              update(idx, {
                                contractTotal: Number(e.target.value),
                              })
                            }
                          />
                        </Field>
                        <Field label="Initial Sales / Down Payment ($)">
                          <Input
                            type="number"
                            min="0"
                            step="0.01"
                            value={item.initialSales}
                            onChange={(e) =>
                              update(idx, {
                                initialSales: Number(e.target.value),
                              })
                            }
                          />
                        </Field>
                        <Field label="Interest Rate (%)">
                          <Input
                            type="number"
                            min="0"
                            max="100"
                            step="0.01"
                            value={item.interestRatePercent}
                            onChange={(e) =>
                              update(idx, {
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
                              update(idx, { termMonths: Number(e.target.value) })
                            }
                          />
                        </Field>
                        <Field label="Payment Type">
                          <Select
                            value={item.paymentType}
                            onValueChange={(v) =>
                              update(idx, {
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
                              update(idx, {
                                paymentCadence: v as
                                  | "monthly"
                                  | "quarterly"
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
                          onClick={() => remove(idx)}
                          className="text-destructive hover:text-destructive"
                        >
                          <Trash2 className="mr-1 size-3.5" />
                          Remove
                        </Button>
                      </div>
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
