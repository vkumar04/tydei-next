"use client"

import { useState, useMemo, useCallback } from "react"
import type { UseFormReturn } from "react-hook-form"
import type { CreateContractInput } from "@/lib/validators/contracts"
import { getVendors } from "@/lib/actions/vendors"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { queryKeys } from "@/lib/query-keys"
import { useCreateVendor } from "@/hooks/use-vendor-crud"
import { X, Plus } from "lucide-react"
import { suggestSimilarCategory } from "@/lib/categories/fuzzy-match"
import { Field } from "@/components/shared/forms/field"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { cn } from "@/lib/utils"

// Charles W1.W-D2 — contract-type taxonomy.
//
// Charles's rule (2026-04-20): "if a capital contract has the same terms
// as a usage contract it shouldn't be *called* capital. Tie-in should
// include both capital + usage terms."
//
// That gives us the following distinctions. Descriptions are the user's
// first line of guidance between the two overlapping types (capital vs
// tie_in), so they spell out the difference:
//
//   - capital  → stand-alone capital equipment purchase with NO rebate
//                or usage terms on the same contract. Pure asset +
//                payment plan. Pick this only when there are no
//                consumables.
//   - tie_in   → capital + consumable/usage rebate terms on the SAME
//                contract. One capital balance, paid down by rebates
//                earned across every rebate term on the contract. This
//                is the right pick whenever the contract mixes the two.
//
// Future revisit may hide `capital` from the picker entirely — v0 only
// models tie-in — but removing it today would orphan seeded `capital`
// rows and break existing reports. Descriptions first, taxonomy change
// later if it's still confusing.
const contractTypes = [
  {
    value: "usage",
    label: "Usage-Based",
    description: "Rebates on spend (no capital equipment)",
  },
  {
    value: "pricing_only",
    label: "Pricing Only",
    description: "Discounted prices, no rebate terms",
  },
  {
    value: "capital",
    label: "Capital Equipment",
    description:
      "Stand-alone equipment purchase, no rebate terms. If this contract mixes capital + consumables, pick Tie-In instead.",
  },
  {
    value: "grouped",
    label: "GPO/Group",
    description: "Collective buying",
  },
  {
    value: "tie_in",
    label: "Tie-In",
    description: "Capital equipment + rebate terms on one contract",
  },
  {
    value: "service",
    label: "Service",
    description: "Service agreements",
  },
] as const

interface VendorOption {
  id: string
  name: string
  displayName: string | null
}

interface CategoryOption {
  id: string
  name: string
}

interface BasicInformationCardProps {
  form: UseFormReturn<CreateContractInput>
  vendors: VendorOption[]
  categories: CategoryOption[]
  onCreateCategory?: (name: string) => Promise<{ id: string; name: string }>
}

export function BasicInformationCard({
  form,
  vendors,
  categories,
  onCreateCategory,
}: BasicInformationCardProps) {
  const {
    register,
    setValue,
    watch,
    formState: { errors },
  } = form

  const selectedCategoryIds = watch("categoryIds") ?? []

  // Live vendor list — kept in sync via React Query.
  const queryClient = useQueryClient()
  const { data: liveVendorsData } = useQuery({
    queryKey: queryKeys.vendors.all,
    queryFn: () => getVendors(),
    initialData: vendors,
  })
  const liveVendors = useMemo<VendorOption[]>(
    () => (liveVendorsData ?? vendors) as VendorOption[],
    [liveVendorsData, vendors],
  )
  const createVendorMutation = useCreateVendor()
  const [addVendorOpen, setAddVendorOpen] = useState(false)

  // Inline "Add category" state — Charles R5.17. Typed name is
  // fuzzy-matched against `categories` so we suggest an existing
  // row before creating a duplicate.
  const [newCategoryName, setNewCategoryName] = useState("")
  const [creatingCategory, setCreatingCategory] = useState(false)
  const categorySuggestion = useMemo(() => {
    const trimmed = newCategoryName.trim()
    if (!trimmed) return null
    // Don't suggest when the typed name already exactly matches
    // (user will just tick the existing checkbox).
    const exact = categories.find(
      (c) => c.name.toLowerCase() === trimmed.toLowerCase(),
    )
    if (exact) return null
    return suggestSimilarCategory(trimmed, categories)
  }, [newCategoryName, categories])

  // Inline vendor creation dialog state
  const [newVendorName, setNewVendorName] = useState("")
  const [newVendorDisplayName, setNewVendorDisplayName] = useState("")
  const [newVendorContactName, setNewVendorContactName] = useState("")
  const [newVendorContactEmail, setNewVendorContactEmail] = useState("")
  const [newVendorError, setNewVendorError] = useState<string | null>(null)

  const handleCreateVendor = useCallback(async () => {
    setNewVendorError(null)
    const name = newVendorName.trim()
    if (!name) {
      setNewVendorError("Name is required")
      return
    }
    const existing = liveVendors.find(
      (v) => v.name.toLowerCase() === name.toLowerCase(),
    )
    if (existing) {
      setNewVendorError("A vendor with that name already exists")
      return
    }
    try {
      const created = await createVendorMutation.mutateAsync({
        name,
        displayName: newVendorDisplayName.trim() || undefined,
        contactName: newVendorContactName.trim() || undefined,
        contactEmail: newVendorContactEmail.trim() || undefined,
        tier: "standard",
      })
      await queryClient.invalidateQueries({ queryKey: queryKeys.vendors.all })
      setValue("vendorId", created.id)
      setAddVendorOpen(false)
      setNewVendorName("")
      setNewVendorDisplayName("")
      setNewVendorContactName("")
      setNewVendorContactEmail("")
    } catch (err) {
      setNewVendorError(err instanceof Error ? err.message : "Failed to create vendor")
    }
  }, [
    createVendorMutation,
    liveVendors,
    newVendorContactEmail,
    newVendorContactName,
    newVendorDisplayName,
    newVendorName,
    queryClient,
    setValue,
  ])

  const selectCategoryId = useCallback(
    (id: string) => {
      const current = form.getValues("categoryIds") ?? []
      if (current.includes(id)) return
      const next = [...current, id]
      setValue("categoryIds", next)
      setValue("productCategoryId", next[0])
    },
    [form, setValue],
  )

  const handleCreateNewCategory = useCallback(async () => {
    if (!onCreateCategory) return
    const name = newCategoryName.trim()
    if (!name) return
    setCreatingCategory(true)
    try {
      const created = await onCreateCategory(name)
      selectCategoryId(created.id)
      setNewCategoryName("")
    } finally {
      setCreatingCategory(false)
    }
  }, [newCategoryName, onCreateCategory, selectCategoryId])

  const handleUseSuggestedCategory = useCallback(() => {
    if (!categorySuggestion) return
    selectCategoryId(categorySuggestion.id)
    setNewCategoryName("")
  }, [categorySuggestion, selectCategoryId])

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Basic Information</CardTitle>
          <CardDescription>Enter the contract details</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Contract Name"
              error={errors.name?.message}
              required
            >
              <Input
                {...register("name")}
                placeholder="e.g., Arthrex2024"
              />
            </Field>

            <Field
              label="Contract ID"
              error={errors.contractNumber?.message}
            >
              <Input
                {...register("contractNumber")}
                placeholder="e.g., ART-2024-001"
              />
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Vendor" error={errors.vendorId?.message} required>
              <Select
                value={watch("vendorId")}
                onValueChange={(v) => {
                  if (v === "__add_new__") {
                    setAddVendorOpen(true)
                    return
                  }
                  setValue("vendorId", v)
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select vendor" />
                </SelectTrigger>
                <SelectContent>
                  {liveVendors.map((v) => (
                    <SelectItem key={v.id} value={v.id}>
                      {v.displayName || v.name}
                    </SelectItem>
                  ))}
                  <SelectSeparator />
                  <SelectItem value="__add_new__" className="text-primary font-medium">
                    <span className="flex items-center gap-2">
                      <Plus className="h-4 w-4" />
                      Add new vendor
                    </span>
                  </SelectItem>
                </SelectContent>
              </Select>
            </Field>

            <Field
              label="Contract Type"
              error={errors.contractType?.message}
              required
            >
              <Select
                value={watch("contractType")}
                onValueChange={(v) =>
                  setValue(
                    "contractType",
                    v as CreateContractInput["contractType"]
                  )
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select type" />
                </SelectTrigger>
                <SelectContent>
                  {contractTypes.map((t) => (
                    <SelectItem key={t.value} value={t.value}>
                      <div className="flex items-center justify-between w-full gap-2">
                        <span>{t.label}</span>
                        <span className="text-xs text-muted-foreground">
                          {t.description}
                        </span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Categories"
              error={errors.categoryIds?.message}
            >
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    role="combobox"
                    className="w-full justify-between font-normal"
                  >
                    {selectedCategoryIds.length > 0
                      ? `${selectedCategoryIds.length} selected`
                      : "Select categories"}
                    <span className="ml-auto text-xs text-muted-foreground">
                      {selectedCategoryIds.length > 0 && selectedCategoryIds.length}
                    </span>
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[--radix-popover-trigger-width] p-2" align="start">
                  {onCreateCategory && (
                    <div className="border-b pb-2 mb-2 space-y-1.5">
                      <Label className="text-xs text-muted-foreground">Add category</Label>
                      <div className="flex gap-1">
                        <Input
                          value={newCategoryName}
                          onChange={(e) => setNewCategoryName(e.target.value)}
                          placeholder="e.g., Trauma Implants"
                          className="h-8 text-sm"
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault()
                              if (categorySuggestion) {
                                handleUseSuggestedCategory()
                              } else {
                                void handleCreateNewCategory()
                              }
                            }
                          }}
                        />
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="h-8 px-2"
                          disabled={!newCategoryName.trim() || creatingCategory}
                          onClick={() => void handleCreateNewCategory()}
                        >
                          <Plus className="h-3 w-3" />
                        </Button>
                      </div>
                      {categorySuggestion && (
                        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs space-y-1.5">
                          <div>
                            Similar category exists: <span className="font-medium">&quot;{categorySuggestion.name}&quot;</span> — use that instead?
                          </div>
                          <div className="flex gap-1.5">
                            <Button
                              type="button"
                              size="sm"
                              variant="default"
                              className="h-6 text-xs"
                              onClick={handleUseSuggestedCategory}
                            >
                              Use &quot;{categorySuggestion.name}&quot;
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              className="h-6 text-xs"
                              disabled={creatingCategory}
                              onClick={() => void handleCreateNewCategory()}
                            >
                              Create new &quot;{newCategoryName.trim()}&quot;
                            </Button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                  <div className="max-h-[200px] overflow-y-auto space-y-1">
                    {categories.map((c) => {
                      const checked = selectedCategoryIds.includes(c.id)
                      return (
                        <label
                          key={c.id}
                          className={cn(
                            "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm cursor-pointer hover:bg-accent",
                            checked && "bg-accent"
                          )}
                        >
                          <input
                            type="checkbox"
                            className="sr-only"
                            checked={checked}
                            onChange={() => {
                              const next = checked
                                ? selectedCategoryIds.filter((id) => id !== c.id)
                                : [...selectedCategoryIds, c.id]
                              setValue("categoryIds", next)
                              setValue("productCategoryId", next[0] || undefined)
                            }}
                          />
                          <div className={cn(
                            "h-4 w-4 rounded border flex items-center justify-center",
                            checked ? "bg-primary border-primary text-primary-foreground" : "border-input"
                          )}>
                            {checked && <span className="text-xs">&#10003;</span>}
                          </div>
                          {c.name}
                        </label>
                      )
                    })}
                  </div>
                </PopoverContent>
              </Popover>
              {selectedCategoryIds.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1">
                  {selectedCategoryIds.map((id) => {
                    const cat = categories.find((c) => c.id === id)
                    return cat ? (
                      <Badge key={id} variant="secondary" className="text-xs gap-1">
                        {cat.name}
                        <button
                          type="button"
                          className="ml-0.5 hover:text-destructive"
                          onClick={() => {
                            const next = selectedCategoryIds.filter((cid) => cid !== id)
                            setValue("categoryIds", next)
                            setValue("productCategoryId", next[0] || undefined)
                          }}
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </Badge>
                    ) : null
                  })}
                </div>
              )}
            </Field>

            <Field
              label="GPO Affiliation"
              error={errors.gpoAffiliation?.message}
            >
              <Input
                {...register("gpoAffiliation")}
                placeholder="e.g., Vizient, Premier"
              />
            </Field>
          </div>

          <Field label="Description" error={errors.description?.message}>
            <Textarea
              {...register("description")}
              placeholder="Contract notes and details..."
              rows={3}
            />
          </Field>
        </CardContent>
      </Card>

      {/* Add Vendor Dialog */}
      <Dialog open={addVendorOpen} onOpenChange={setAddVendorOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add new vendor</DialogTitle>
            <DialogDescription>
              Create a new vendor inline. Only the name is required.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Field label="Name" required>
              <Input
                value={newVendorName}
                onChange={(e) => setNewVendorName(e.target.value)}
                placeholder="e.g., Acme Medical"
                autoFocus
              />
            </Field>
            <Field label="Display name">
              <Input
                value={newVendorDisplayName}
                onChange={(e) => setNewVendorDisplayName(e.target.value)}
                placeholder="Optional"
              />
            </Field>
            <Field label="Contact name">
              <Input
                value={newVendorContactName}
                onChange={(e) => setNewVendorContactName(e.target.value)}
                placeholder="Optional"
              />
            </Field>
            <Field label="Contact email">
              <Input
                type="email"
                value={newVendorContactEmail}
                onChange={(e) => setNewVendorContactEmail(e.target.value)}
                placeholder="Optional"
              />
            </Field>
            {newVendorError && (
              <p className="text-sm text-destructive">{newVendorError}</p>
            )}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setAddVendorOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={handleCreateVendor}
              disabled={createVendorMutation.isPending}
            >
              {createVendorMutation.isPending ? "Creating..." : "Create vendor"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
