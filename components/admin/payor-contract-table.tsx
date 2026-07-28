"use client"

import { useMemo, useState } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import {
  Plus,
  FileText,
  CheckCircle,
  Check,
  ChevronDown,
  DollarSign,
  Building2,
  Eye,
  Edit,
  Trash2,
  Search,
  Download,
} from "lucide-react"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { ConfirmDialog } from "@/components/shared/forms/confirm-dialog"
import {
  getPayorContracts,
  createPayorContract,
  deletePayorContract,
} from "@/lib/actions/admin/payor-contracts"
import { adminGetFacilityOptions } from "@/lib/actions/admin/facilities"
import { queryKeys } from "@/lib/query-keys"
import { formatCalendarDate } from "@/lib/formatting"

interface PayorContractRate {
  cptCode: string
  description?: string
  rate: number
  effectiveDate?: string
  expirationDate?: string
}

interface PayorContractGrouper {
  grouperName: string
  rate: number
  effectiveDate?: string
  expirationDate?: string
}

interface PayorContractRow {
  id: string
  payorName: string
  payorType: string
  contractNumber: string
  facilityId: string
  facilityName: string
  effectiveDate: string
  expirationDate: string
  status: string
  cptRates: PayorContractRate[]
  grouperRates: PayorContractGrouper[]
  multiProcedureRule?: { primary: number; secondary: number }
  implantPassthrough?: boolean
  implantMarkup?: number
  notes?: string | null
}

const formatCurrency = (value: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
  }).format(value)

// Payor contract effective/expiration dates are @db.Date — render UTC-pinned.
const formatDate = formatCalendarDate

// ─── Scope helpers (exported so the invariants can be unit-tested) ──
//
// `getPayorContracts` paginates (pageSize 20 by default) and returns exactly
// two whole-set numbers: `total`, and — when called with a `status` — the
// count of contracts in that status. It has no `search` parameter and returns
// no CPT-rate or payor aggregates.
//
// So this table loads the payor-contract set in ONE server page and derives
// the aggregate cards, the search and the pager from it. Before, the four stat
// cards reduced over `take: 20` rows while `total` sat unread, and there was
// no pager at all, so rows 21+ were unreachable and every card silently read
// "20" once a tenant crossed the page boundary.

/**
 * One server page wide enough to hold the whole table at any volume this
 * product has seen (production carries 2 payor contracts; the dev seed 3).
 * If a tenant ever exceeds it the UI says so rather than truncating quietly —
 * see the notice under the stat cards.
 */
export const PAYOR_CONTRACT_SCAN_LIMIT = 200

/** Rows per page in the table's own pager, over the loaded set. */
export const PAYOR_CONTRACT_PAGE_SIZE = 20

/** Case-insensitive match on payor / facility / contract number. */
export function filterPayorContracts<
  T extends {
    payorName: string
    facilityName?: string | null
    contractNumber?: string | null
  },
>(rows: T[], query: string): T[] {
  const q = query.trim().toLowerCase()
  if (!q) return rows
  return rows.filter(
    (r) =>
      r.payorName.toLowerCase().includes(q) ||
      (r.facilityName ?? "").toLowerCase().includes(q) ||
      (r.contractNumber ?? "").toLowerCase().includes(q),
  )
}

/** CPT rates across EVERY row handed in — never one page of them. */
export function countCptRates(
  rows: { cptRates?: unknown[] | null }[],
): number {
  return rows.reduce((sum, r) => sum + (r.cptRates?.length ?? 0), 0)
}

/**
 * Distinct payors. Names are canonicalized (trim + case-fold) first: the same
 * payor entered as "Aetna" and "aetna " is one payor, and a raw Set over the
 * display strings would report two.
 */
export function countDistinctPayors(rows: { payorName: string }[]): number {
  return new Set(rows.map((r) => r.payorName.trim().toLowerCase())).size
}

// ─── Payor name options ─────────────────────────────────────────
//
// The Payor Name picker sat two fields above the Facility picker and had the
// SAME defect in a worse form: its options were nine hard-coded national
// payors, presented as the whole payor universe. `payorName` gates submit, so
// anything outside those nine could not be created at all — and the nine do
// not cover the data that already exists. Verified 2026-07-28:
//
//   prod snapshot  "Anthem Health Plans, Inc. dba Anthem Blue Cross and
//                   Blue Shield"                                    — absent
//                  "Anthem Health Plans, Inc., dba Anthem Blue Cross and
//                   Blue Shield"                                    — absent
//   dev seed       "UnitedHealthcare" (list has "United Healthcare") — absent
//                  "Aetna Medicare Advantage" (list has "Aetna")    — absent
//                  "Blue Cross Blue Shield"                         — present
//
// So four of the five payor names in the two databases were unreachable, and
// adding a second contract for prod's Anthem forced a near-miss spelling —
// which then splits the "Payors Covered" card, since that card counts distinct
// canonicalized names. The picker now offers every payor already in the loaded
// set (real spellings win) plus these nine as a seed, and accepts free text so
// a genuinely new payor is reachable.

/** Seed suggestions only — never the whole set. See the note above. */
export const COMMON_PAYOR_NAMES = [
  "Anthem Blue Cross Blue Shield",
  "United Healthcare",
  "Cigna",
  "Aetna",
  "Humana",
  "Blue Cross Blue Shield",
  "Medicare Advantage",
  "Medicaid Managed Care",
  "Workers Compensation",
] as const

/**
 * Distinct payor names to offer, ordered alphabetically.
 *
 * Deduped on the SAME canonical key as `countDistinctPayors` (trim +
 * case-fold) so the picker and the "Payors Covered" card can never disagree
 * about what counts as one payor. When a name appears in both the data and the
 * seed list the stored spelling wins — picking the seed's "United Healthcare"
 * for a facility whose contracts all say "UnitedHealthcare" would invent a
 * second payor.
 */
export function payorNameOptions(
  rows: { payorName: string }[],
  common: readonly string[] = COMMON_PAYOR_NAMES,
): string[] {
  const byKey = new Map<string, string>()
  for (const source of [rows.map((r) => r.payorName), common]) {
    for (const raw of source) {
      const name = raw.trim()
      if (!name) continue
      const key = name.toLowerCase()
      if (!byKey.has(key)) byKey.set(key, name)
    }
  }
  return Array.from(byKey.values()).sort((a, b) =>
    a.localeCompare(b, "en", { sensitivity: "base" }),
  )
}

/** Case-insensitive substring match over the option list. */
export function filterPayorNames(options: string[], query: string): string[] {
  const q = query.trim().toLowerCase()
  if (!q) return options
  return options.filter((name) => name.toLowerCase().includes(q))
}

/**
 * Heading over the suggestion group. It labels the ROWS RENDERED, which is the
 * filtered list — not `payorOptions.length`, which would print "11 known
 * payors" over a single visible row.
 */
export function payorOptionsHeading(shown: number, total: number): string {
  const noun = `known payor${total === 1 ? "" : "s"}`
  return shown === total
    ? `${total} ${noun}`
    : `${shown} of ${total} ${noun}`
}

/**
 * The free-text name to offer as "add this one", or `null` when the typed
 * text is blank or already an option under the canonical key. Without it a
 * payor that is in neither the data nor the seed list stays uncreatable —
 * which is the original bug, just with a longer list.
 */
export function payorNameFreeTextOption(
  options: string[],
  query: string,
): string | null {
  const typed = query.trim()
  if (!typed) return null
  const key = typed.toLowerCase()
  return options.some((name) => name.toLowerCase() === key) ? null : typed
}

/**
 * Clamped page slice. `page` is clamped rather than mirrored into state so a
 * search that shrinks the result set can't strand the user on an empty page
 * (CLAUDE.md: derive, don't mirror).
 */
export function payorContractPage<T>(
  rows: T[],
  requestedPage: number,
  pageSize: number = PAYOR_CONTRACT_PAGE_SIZE,
): { rows: T[]; page: number; pageCount: number; from: number; to: number } {
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize))
  const page = Math.min(Math.max(1, requestedPage), pageCount)
  const start = (page - 1) * pageSize
  const slice = rows.slice(start, start + pageSize)
  return {
    rows: slice,
    page,
    pageCount,
    from: rows.length === 0 ? 0 : start + 1,
    to: start + slice.length,
  }
}

export function PayorContractTable() {
  const qc = useQueryClient()
  const [searchQuery, setSearchQuery] = useState("")
  const [page, setPage] = useState(1)
  const [showUploadDialog, setShowUploadDialog] = useState(false)
  const [payorPickerOpen, setPayorPickerOpen] = useState(false)
  const [payorSearch, setPayorSearch] = useState("")
  const [showRatesDialog, setShowRatesDialog] = useState(false)
  const [selectedContract, setSelectedContract] = useState<PayorContractRow | null>(null)
  const [deleting, setDeleting] = useState<PayorContractRow | null>(null)

  // Form state
  const [newContract, setNewContract] = useState({
    payorName: "",
    payorType: "commercial" as
      | "commercial"
      | "medicare_advantage"
      | "medicaid_managed"
      | "workers_comp",
    facilityId: "",
    contractNumber: "",
    effectiveDate: "",
    expirationDate: "",
    notes: "",
  })

  // Key stays `payorContracts()` (no filters) so every existing invalidation
  // below keeps matching it — the scan limit is a constant, not a filter.
  const { data, isLoading } = useQuery({
    queryKey: queryKeys.admin.payorContracts(),
    queryFn: () => getPayorContracts({ pageSize: PAYOR_CONTRACT_SCAN_LIMIT }),
  })

  // Active count over the WHOLE set, straight from the server: `total` is a
  // `count()` over the same `where`, so this stays right even if the scan
  // above ever comes back truncated. Costs one row.
  const { data: activeData } = useQuery({
    queryKey: queryKeys.admin.payorContracts({ status: "active" }),
    queryFn: () => getPayorContracts({ status: "active", pageSize: 1 }),
  })

  // UNPAGINATED, deliberately — `adminGetFacilities({})` defaults to
  // pageSize 20, and `facilityId` is REQUIRED here (submit is disabled
  // without one), so a facility past alphabetical rank 20 made creating a
  // payor contract for it impossible. Same defect that made vendor user
  // creation impossible (Charles 2026-07-28); a picker must never paginate.
  const { data: facilityOptions } = useQuery({
    queryKey: queryKeys.admin.facilityOptions(),
    queryFn: () => adminGetFacilityOptions(),
  })

  /**
   * Both reads have to be refreshed by hand: `payorContracts()` builds
   * `["admin","payorContracts",undefined]`, and TanStack's partial match
   * compares that `undefined` against the active read's `{status:"active"}` —
   * different types, so it does NOT match by prefix. Invalidate both keys
   * explicitly rather than inventing a literal prefix key.
   */
  const invalidatePayorContracts = () => {
    qc.invalidateQueries({ queryKey: queryKeys.admin.payorContracts() })
    qc.invalidateQueries({
      queryKey: queryKeys.admin.payorContracts({ status: "active" }),
    })
  }

  const createMut = useMutation({
    mutationFn: createPayorContract,
    onSuccess: () => {
      invalidatePayorContracts()
      setShowUploadDialog(false)
      resetForm()
      toast.success("Payor contract created")
    },
  })

  const deleteMut = useMutation({
    mutationFn: (id: string) => deletePayorContract(id),
    onSuccess: () => {
      invalidatePayorContracts()
      setDeleting(null)
      toast.success("Payor contract deleted")
    },
  })

  const resetForm = () => {
    setPayorSearch("")
    setNewContract({
      payorName: "",
      payorType: "commercial",
      facilityId: "",
      contractNumber: "",
      effectiveDate: "",
      expirationDate: "",
      notes: "",
    })
  }

  const handleSubmit = async () => {
    if (!newContract.payorName || !newContract.facilityId) {
      toast.error("Payor name and facility are required")
      return
    }
    await createMut.mutateAsync({
      payorName: newContract.payorName,
      payorType: newContract.payorType,
      facilityId: newContract.facilityId,
      contractNumber: newContract.contractNumber || `AUTO-${Date.now()}`,
      effectiveDate:
        newContract.effectiveDate || new Date().toISOString().split("T")[0],
      expirationDate:
        newContract.expirationDate ||
        new Date(Date.now() + 365 * 24 * 60 * 60 * 1000)
          .toISOString()
          .split("T")[0],
      status: "active",
      cptRates: [],
      grouperRates: [],
      implantPassthrough: true,
      implantMarkup: 0,
      notes: newContract.notes,
    })
  }

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "active":
        return (
          <Badge className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300">
            Active
          </Badge>
        )
      case "expired":
        return <Badge variant="destructive">Expired</Badge>
      case "pending":
        return <Badge variant="secondary">Pending</Badge>
      default:
        return <Badge variant="outline">{status}</Badge>
    }
  }

  const contracts = (data?.contracts ?? []) as unknown as PayorContractRow[]
  const facilities = facilityOptions ?? []

  /**
   * `total` is a server-side `count()` over every payor contract; `contracts`
   * is one page of them. Anything labelled "Total" reads the server number.
   * The two aggregates the action can't give us (CPT rates, distinct payors)
   * are computed over the loaded set — which is the whole set unless
   * `scanTruncated`, and that case is stated in the UI below.
   */
  const scanTruncated = data ? data.total > contracts.length : false
  const totalContractedRates = countCptRates(contracts)
  const uniquePayors = countDistinctPayors(contracts)

  /** "—" until a query resolves: a placeholder 0 is also a wrong number. */
  const stat = (value: number | undefined) => value ?? "—"

  // Payor suggestions come from the same loaded set the cards do, so a
  // truncated scan narrows them too — stated in the notice below.
  const payorOptions = useMemo(() => payorNameOptions(contracts), [contracts])
  const payorMatches = filterPayorNames(payorOptions, payorSearch)
  const payorFreeText = payorNameFreeTextOption(payorOptions, payorSearch)
  const choosePayor = (name: string) => {
    setNewContract((prev) => ({ ...prev, payorName: name }))
    setPayorSearch("")
    setPayorPickerOpen(false)
  }

  const filteredContracts = filterPayorContracts(contracts, searchQuery)
  const pageSlice = payorContractPage(filteredContracts, page)

  return (
    <>
      {/* Add Contract Dialog Trigger (via header button rendered below) */}
      <div className="flex items-center justify-end">
        <Dialog
          open={showUploadDialog}
          onOpenChange={(open) => {
            setShowUploadDialog(open)
            if (!open) resetForm()
          }}
        >
          <DialogTrigger asChild>
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              Add Contract
            </Button>
          </DialogTrigger>
          <DialogContent className="w-full max-w-[calc(100vw-2rem)] sm:max-w-2xl overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Upload Payor Contract</DialogTitle>
              <DialogDescription>
                Upload a payor contract to extract reimbursement rates for case
                costing.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="payorName">Payor Name *</Label>
                  {/* Was a nine-item hard-coded <Select>. `payorName` gates
                      submit, so that list was the entire set of payors an
                      admin could ever file a contract under — and it matched
                      exactly one of the five payor names in the two live
                      databases. */}
                  <Popover
                    open={payorPickerOpen}
                    onOpenChange={setPayorPickerOpen}
                  >
                    <PopoverTrigger asChild>
                      <Button
                        id="payorName"
                        type="button"
                        variant="outline"
                        // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role, jsx-a11y/role-has-required-aria-props -- shadcn combobox pattern: Radix Popover trigger keeps role="combobox"; Radix wires aria-controls to the popover content at runtime.
                        role="combobox"
                        aria-expanded={payorPickerOpen}
                        className="w-full justify-between font-normal"
                      >
                        <span className="truncate text-left">
                          {newContract.payorName || "Select or type a payor..."}
                        </span>
                        <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent
                      className="w-[var(--radix-popover-trigger-width)] p-0"
                      align="start"
                      sideOffset={4}
                    >
                      {/* shouldFilter={false}: `filterPayorNames` already
                          filtered, and cmdk's own filter would also score the
                          free-text "add" row out of the list. */}
                      <Command shouldFilter={false}>
                        <CommandInput
                          placeholder="Search payors, or type a new one..."
                          value={payorSearch}
                          onValueChange={setPayorSearch}
                        />
                        <CommandList>
                          <CommandEmpty>
                            Type a payor name to add it.
                          </CommandEmpty>
                          {payorMatches.length > 0 && (
                            <CommandGroup
                              heading={payorOptionsHeading(
                                payorMatches.length,
                                payorOptions.length,
                              )}
                            >
                              {payorMatches.map((name) => (
                                <CommandItem
                                  key={name}
                                  value={name}
                                  onSelect={() => choosePayor(name)}
                                >
                                  <span className="truncate">{name}</span>
                                  {newContract.payorName === name && (
                                    <Check className="ml-auto h-4 w-4 shrink-0" />
                                  )}
                                </CommandItem>
                              ))}
                            </CommandGroup>
                          )}
                          {payorFreeText && (
                            <CommandGroup heading="Add a new payor">
                              <CommandItem
                                value={`new:${payorFreeText}`}
                                onSelect={() => choosePayor(payorFreeText)}
                              >
                                <Plus className="mr-2 h-4 w-4 shrink-0" />
                                <span className="truncate">
                                  Use &ldquo;{payorFreeText}&rdquo;
                                </span>
                              </CommandItem>
                            </CommandGroup>
                          )}
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  </Popover>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="payorType">Contract Type</Label>
                  <Select
                    value={newContract.payorType}
                    onValueChange={(v) =>
                      setNewContract((prev) => ({
                        ...prev,
                        payorType: v as typeof prev.payorType,
                      }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="commercial">Commercial</SelectItem>
                      <SelectItem value="medicare_advantage">
                        Medicare Advantage
                      </SelectItem>
                      <SelectItem value="medicaid_managed">
                        Medicaid Managed
                      </SelectItem>
                      <SelectItem value="workers_comp">Workers Comp</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="facility">Facility *</Label>
                  <Select
                    value={newContract.facilityId}
                    onValueChange={(v) =>
                      setNewContract((prev) => ({ ...prev, facilityId: v }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select facility..." />
                    </SelectTrigger>
                    <SelectContent>
                      {facilities.map((facility) => (
                        <SelectItem key={facility.id} value={facility.id}>
                          {facility.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="contractNumber">Contract Number</Label>
                  <Input
                    id="contractNumber"
                    value={newContract.contractNumber}
                    onChange={(e) =>
                      setNewContract((prev) => ({
                        ...prev,
                        contractNumber: e.target.value,
                      }))
                    }
                    placeholder="e.g., ASC-2024-001"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="effectiveDate">Effective Date</Label>
                  <Input
                    id="effectiveDate"
                    type="date"
                    value={newContract.effectiveDate}
                    onChange={(e) =>
                      setNewContract((prev) => ({
                        ...prev,
                        effectiveDate: e.target.value,
                      }))
                    }
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="expirationDate">Expiration Date</Label>
                  <Input
                    id="expirationDate"
                    type="date"
                    value={newContract.expirationDate}
                    onChange={(e) =>
                      setNewContract((prev) => ({
                        ...prev,
                        expirationDate: e.target.value,
                      }))
                    }
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="notes">Notes</Label>
                <Textarea
                  id="notes"
                  value={newContract.notes}
                  onChange={(e) =>
                    setNewContract((prev) => ({
                      ...prev,
                      notes: e.target.value,
                    }))
                  }
                  placeholder="Add any notes about this contract..."
                  rows={3}
                />
              </div>
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setShowUploadDialog(false)}
              >
                Cancel
              </Button>
              <Button
                onClick={handleSubmit}
                disabled={
                  !newContract.payorName ||
                  !newContract.facilityId ||
                  createMut.isPending
                }
              >
                {createMut.isPending ? "Saving..." : "Save Contract"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {/* Stats */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Total Contracts
            </CardTitle>
            <FileText className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {/* Server count over every payor contract, not `contracts.length`
                (which is one page). */}
            <div className="text-2xl font-bold">{stat(data?.total)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Active Contracts
            </CardTitle>
            <CheckCircle className="h-4 w-4 text-green-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stat(activeData?.total)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Total CPT Rates
            </CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {/* `data`, not `isLoading`: a failed read leaves isLoading false
                with no rows, and "0" is as wrong an answer as a page-scoped
                one. Matches `stat()` above. */}
            <div className="text-2xl font-bold">
              {data ? totalContractedRates : "—"}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Payors Covered
            </CardTitle>
            <Building2 className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {data ? uniquePayors : "—"}
            </div>
          </CardContent>
        </Card>
      </div>

      {/*
        A cap only stops being a bug when the UI admits to it. Total and Active
        stay server-wide either way; the other two cards, the search box and
        the table can only cover what was loaded, so name that number.
      */}
      {scanTruncated && data && (
        <p className="text-xs text-muted-foreground">
          Loaded the {contracts.length} most recently uploaded of {data.total}{" "}
          payor contracts. Total Contracts and Active Contracts count all{" "}
          {data.total}; Total CPT Rates, Payors Covered, the payor suggestions
          in the Add Contract dialog, the search box and the table below cover
          the loaded {contracts.length} only.
        </p>
      )}

      {/* Contracts Table */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Contract List</CardTitle>
              <CardDescription>
                View and manage payor contracts and reimbursement rates
              </CardDescription>
            </div>
            <div className="relative w-64">
              <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search contracts..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-8"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Payor</TableHead>
                <TableHead>Facility</TableHead>
                <TableHead>Contract #</TableHead>
                <TableHead>Effective</TableHead>
                <TableHead>Expires</TableHead>
                <TableHead>CPT Rates</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && (
                <TableRow>
                  <TableCell
                    colSpan={8}
                    className="text-center py-8 text-muted-foreground"
                  >
                    Loading contracts...
                  </TableCell>
                </TableRow>
              )}
              {!isLoading &&
                pageSlice.rows.map((contract) => (
                  <TableRow key={contract.id}>
                    <TableCell className="font-medium">
                      {contract.payorName}
                    </TableCell>
                    <TableCell>{contract.facilityName}</TableCell>
                    <TableCell className="font-mono text-sm">
                      {contract.contractNumber}
                    </TableCell>
                    <TableCell>{formatDate(contract.effectiveDate)}</TableCell>
                    <TableCell>{formatDate(contract.expirationDate)}</TableCell>
                    <TableCell>
                      <Badge variant="outline">
                        {(contract.cptRates ?? []).length} rates
                      </Badge>
                    </TableCell>
                    <TableCell>{getStatusBadge(contract.status)}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setSelectedContract(contract)
                            setShowRatesDialog(true)
                          }}
                        >
                          <Eye className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="sm">
                          <Edit className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setDeleting(contract)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              {!isLoading && filteredContracts.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={8}
                    className="text-center py-8 text-muted-foreground"
                  >
                    No contracts found. Upload your first payor contract to get
                    started.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>

          {/*
            The pager the table never had: without it the rows past the first
            page simply did not exist as far as an operator was concerned.
          */}
          {!isLoading && filteredContracts.length > 0 && (
            <div className="mt-4 flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                Showing {pageSlice.from}–{pageSlice.to} of{" "}
                {filteredContracts.length}
                {searchQuery.trim() ? " matching" : ""}
                {scanTruncated ? " loaded" : ""} contract
                {filteredContracts.length === 1 ? "" : "s"}
                {pageSlice.pageCount > 1
                  ? ` · page ${pageSlice.page} of ${pageSlice.pageCount}`
                  : ""}
              </p>
              {pageSlice.pageCount > 1 && (
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPage(pageSlice.page - 1)}
                    disabled={pageSlice.page <= 1}
                  >
                    Previous
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPage(pageSlice.page + 1)}
                    disabled={pageSlice.page >= pageSlice.pageCount}
                  >
                    Next
                  </Button>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* View Rates Dialog */}
      <Dialog open={showRatesDialog} onOpenChange={setShowRatesDialog}>
        <DialogContent className="w-full max-w-[calc(100vw-2rem)] sm:max-w-4xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {selectedContract?.payorName} - Contract Rates
            </DialogTitle>
            <DialogDescription>
              CPT code reimbursement rates for {selectedContract?.facilityName}
            </DialogDescription>
          </DialogHeader>

          {selectedContract && (
            <Tabs defaultValue="cpt-rates" className="w-full">
              <TabsList>
                <TabsTrigger value="cpt-rates">
                  CPT Rates ({(selectedContract.cptRates ?? []).length})
                </TabsTrigger>
                <TabsTrigger value="groupers">
                  Groupers ({(selectedContract.grouperRates ?? []).length})
                </TabsTrigger>
                <TabsTrigger value="terms">Contract Terms</TabsTrigger>
              </TabsList>

              <TabsContent value="cpt-rates" className="mt-4">
                <div className="rounded-md border max-h-96 overflow-y-auto">
                  <Table>
                    <TableHeader className="sticky top-0 bg-background">
                      <TableRow>
                        <TableHead>CPT Code</TableHead>
                        <TableHead>Description</TableHead>
                        <TableHead className="text-right">Rate</TableHead>
                        <TableHead>Effective</TableHead>
                        <TableHead>Expires</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(selectedContract.cptRates ?? []).length === 0 && (
                        <TableRow>
                          <TableCell
                            colSpan={5}
                            className="text-center py-6 text-muted-foreground"
                          >
                            No CPT rates configured yet.
                          </TableCell>
                        </TableRow>
                      )}
                      {(selectedContract.cptRates ?? []).map((rate, idx) => (
                        <TableRow key={idx}>
                          <TableCell className="font-mono font-medium">
                            {rate.cptCode}
                          </TableCell>
                          <TableCell>{rate.description}</TableCell>
                          <TableCell className="text-right font-medium text-green-600 dark:text-green-400">
                            {formatCurrency(rate.rate)}
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {rate.effectiveDate
                              ? formatDate(rate.effectiveDate)
                              : "—"}
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {rate.expirationDate
                              ? formatDate(rate.expirationDate)
                              : "—"}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </TabsContent>

              <TabsContent value="groupers" className="mt-4">
                <div className="rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Grouper</TableHead>
                        <TableHead className="text-right">Rate</TableHead>
                        <TableHead>Effective</TableHead>
                        <TableHead>Expires</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(selectedContract.grouperRates ?? []).length === 0 && (
                        <TableRow>
                          <TableCell
                            colSpan={4}
                            className="text-center py-6 text-muted-foreground"
                          >
                            No grouper rates configured yet.
                          </TableCell>
                        </TableRow>
                      )}
                      {(selectedContract.grouperRates ?? []).map(
                        (grouper, idx) => (
                          <TableRow key={idx}>
                            <TableCell className="font-medium">
                              {grouper.grouperName}
                            </TableCell>
                            <TableCell className="text-right font-medium text-green-600 dark:text-green-400">
                              {formatCurrency(grouper.rate)}
                            </TableCell>
                            <TableCell className="text-sm text-muted-foreground">
                              {grouper.effectiveDate
                                ? formatDate(grouper.effectiveDate)
                                : "—"}
                            </TableCell>
                            <TableCell className="text-sm text-muted-foreground">
                              {grouper.expirationDate
                                ? formatDate(grouper.expirationDate)
                                : "—"}
                            </TableCell>
                          </TableRow>
                        )
                      )}
                    </TableBody>
                  </Table>
                </div>
              </TabsContent>

              <TabsContent value="terms" className="mt-4">
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <Card>
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm">
                          Multiple Procedure Rule
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <p className="text-2xl font-bold">
                          {selectedContract.multiProcedureRule?.primary ?? 100}
                          % /{" "}
                          {selectedContract.multiProcedureRule?.secondary ?? 50}
                          %
                        </p>
                        <p className="text-sm text-muted-foreground">
                          Primary / Secondary procedure rates
                        </p>
                      </CardContent>
                    </Card>
                    <Card>
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm">
                          Implant Passthrough
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <p className="text-2xl font-bold">
                          {selectedContract.implantPassthrough ? "Yes" : "No"}
                        </p>
                        <p className="text-sm text-muted-foreground">
                          {selectedContract.implantMarkup ?? 0}% markup on
                          invoice cost
                        </p>
                      </CardContent>
                    </Card>
                  </div>
                  {selectedContract.notes && (
                    <Card>
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm">Notes</CardTitle>
                      </CardHeader>
                      <CardContent>
                        <p className="text-sm">{selectedContract.notes}</p>
                      </CardContent>
                    </Card>
                  )}
                </div>
              </TabsContent>
            </Tabs>
          )}

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowRatesDialog(false)}
            >
              Close
            </Button>
            <Button>
              <Download className="mr-2 h-4 w-4" />
              Export Rates
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!deleting}
        onOpenChange={() => setDeleting(null)}
        title="Delete Payor Contract"
        description={`Delete payor contract "${deleting?.payorName}"?`}
        onConfirm={async () => {
          if (deleting) await deleteMut.mutateAsync(deleting.id)
        }}
        isLoading={deleteMut.isPending}
        variant="destructive"
      />
    </>
  )
}
