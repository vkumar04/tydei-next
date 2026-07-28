"use client"

import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import { queryKeys } from "@/lib/query-keys"
import {
  getContracts,
  getContract,
  getContractStats,
  createContractSafe,
  updateContract,
  deleteContract,
} from "@/lib/actions/contracts"
import type { ContractFilters } from "@/lib/validators/contracts"
import type { FacilityScope } from "@/lib/actions/contracts-auth"
import { toast } from "sonner"

export function useContracts(facilityId: string, filters?: Partial<ContractFilters>) {
  return useQuery({
    queryKey: queryKeys.contracts.list(facilityId, filters),
    queryFn: () => getContracts({ ...filters, facilityId }),
    // `filters.search` is now server-side (it used to be a client-side
    // pass over whatever page happened to be loaded), so the query re-keys
    // as the user types. Keeping the previous page mounted stops the table
    // from collapsing into a skeleton between keystrokes.
    placeholderData: keepPreviousData,
  })
}

/** One row of the contracts list, as returned by `getContracts`. */
export type ContractListRow = Awaited<
  ReturnType<typeof getContracts>
>["contracts"][number]

/**
 * Hard row ceiling for the contracts CSV export.
 *
 * The export used to serialize whatever rows the table already had — the
 * first page — and call the file `contracts-<date>.csv`, so a facility with
 * 45 contracts silently downloaded 20. `fetchContractsForExport` pages the
 * FULL filtered set instead; this cap only exists so an enormous portfolio
 * can't spin the browser. When it bites, the caller MUST say so (the
 * returned `capped` flag drives both the toast and the filename) — a silent
 * cap is the bug, a labelled one is a feature.
 */
export const CONTRACTS_EXPORT_ROW_CAP = 1000

/** Server page size used while walking the export set (schema max is 100). */
const EXPORT_PAGE_SIZE = 100

/**
 * Fetch every contract matching `filters` (not just the page the table is
 * showing), stopping at `CONTRACTS_EXPORT_ROW_CAP`.
 *
 * `total` is the server's count for the same filters, so callers can tell
 * the user exactly how much of it the file contains.
 */
export async function fetchContractsForExport(
  facilityId: string,
  filters?: Partial<ContractFilters>,
): Promise<{ rows: ContractListRow[]; total: number; capped: boolean }> {
  const rows: ContractListRow[] = []
  let total = 0

  for (let page = 1; rows.length < CONTRACTS_EXPORT_ROW_CAP; page++) {
    const result = await getContracts({
      ...filters,
      facilityId,
      page,
      pageSize: EXPORT_PAGE_SIZE,
    })
    total = result.total
    rows.push(...result.contracts)
    // Short page ⇒ the server has nothing left for these filters.
    if (result.contracts.length < EXPORT_PAGE_SIZE) break
    if (rows.length >= total) break
  }

  const kept = rows.slice(0, CONTRACTS_EXPORT_ROW_CAP)
  return {
    rows: kept,
    total,
    // `kept.length < total` rather than `total > CAP`: it is the same answer
    // whenever the cap is what bit, and it stays honest if the walk stopped
    // short for any other reason. `capped` means "the file does not contain
    // every matching row" — never let it read false while rows are missing.
    capped: kept.length < total,
  }
}

/**
 * Copy for the export toast + filename.
 *
 * Split out as a pure function because this is exactly where the
 * wrong-scope bug class reappears: `exportedCount` is counted AFTER the
 * client-side facility narrowing while `total` is the SERVER's count for
 * the filters it saw. Printing them next to each other as if they shared a
 * scope ("Exported 12 of 143 matching contracts") is the defect. Every
 * number below is paired with the scope it was computed over.
 */
export function summarizeContractsExport(input: {
  /** Rows actually written to the file (after client-side narrowing). */
  exportedCount: number
  /** Rows pulled from the server before any client-side narrowing. */
  fetchedCount: number
  /** Rows the SERVER matched for the same filters. */
  total: number
  /** True when the file does not contain every server-matched row. */
  capped: boolean
  /** True when a client-side facility narrowing was applied on top. */
  narrowed: boolean
  /** `YYYY-MM-DD` stamp for the filename. */
  stamp: string
}): { filename: string; message: string; tone: "success" | "warning" | "info" } {
  const { exportedCount, fetchedCount, total, capped, narrowed, stamp } = input
  const noun = exportedCount === 1 ? "contract" : "contracts"

  if (exportedCount === 0) {
    return {
      tone: "info",
      filename: `contracts-${stamp}.csv`,
      message: narrowed
        ? `None of the ${total} contracts matching the current filters belong to the selected facility — nothing to export.`
        : "No contracts match the current filters — nothing to export.",
    }
  }

  if (capped) {
    // Say WHY it is short. The row cap is the usual reason, but `capped`
    // means "rows are missing" generally, and claiming the cap bit when it
    // didn't is its own small lie.
    const reason =
      fetchedCount >= CONTRACTS_EXPORT_ROW_CAP
        ? `the export caps at ${CONTRACTS_EXPORT_ROW_CAP} rows`
        : "the server returned fewer rows than it matched"
    return {
      tone: "warning",
      // Both numbers in the filename are server-scope, so they are
      // comparable: N rows pulled out of M matches.
      filename: `contracts-${stamp}-first-${fetchedCount}-of-${total}.csv`,
      message: narrowed
        ? `Exported ${exportedCount} ${noun} for the selected facility, taken from the ${fetchedCount} most recently updated of ${total} matching contracts — ${reason}, so older rows for this facility are not in the file.`
        : `Exported the ${exportedCount} most recently updated of ${total} matching contracts — ${reason}. Narrow the filters to export the rest.`,
    }
  }

  return {
    tone: "success",
    filename: `contracts-${stamp}.csv`,
    message: narrowed
      ? `Exported ${exportedCount} of the ${total} matching ${total === 1 ? "contract" : "contracts"} (narrowed to the selected facility).`
      : `Exported ${exportedCount} ${noun}.`,
  }
}

export function useContract(
  id: string,
  periodId?: string,
  options?: {
    initialData?: Awaited<ReturnType<typeof getContract>>
  },
) {
  return useQuery({
    queryKey: queryKeys.contracts.detail(id, periodId),
    queryFn: () => getContract(id, periodId ? { periodId } : undefined),
    enabled: !!id,
    // W2.A.5 — `initialData` seeds the React Query cache with the
    // server-rendered payload so the first client render already has
    // the full contract (no "$0" flash on the header cards). Only
    // applies when no `periodId` filter is active — the server pre-
    // fetches the all-periods view.
    initialData: periodId ? undefined : options?.initialData,
  })
}

export function useContractStats(
  facilityId: string,
  scope: FacilityScope = "this",
) {
  return useQuery({
    queryKey: queryKeys.contracts.stats(facilityId, scope),
    queryFn: () => getContractStats({ facilityScope: scope }),
  })
}

// Charles W1.X-D: `useContractMetricsBatch` + `getContractMetricsBatch`
// were removed because they duplicated the canonical reducers already
// computed in-memory by `getContracts` (rebateEarned, rebateCollected,
// currentSpend). The dual sources produced list-vs-detail drift; the
// single source now lives on each contract row returned by
// `getContracts` via the canonical helpers.

export function useCreateContract() {
  const queryClient = useQueryClient()

  return useMutation({
    // Use createContractSafe (returns an error-as-value) so the actual
    // failure reason survives Next.js 16's server-action error
    // redaction. If we threw from the action the client would only
    // ever see "An error occurred in the Server Components render"
    // and the user's toast would be the generic digest-hash fallback.
    mutationFn: async (
      input: Parameters<typeof createContractSafe>[0],
    ) => {
      const result = await createContractSafe(input)
      if (!result.ok) {
        const err = new Error(result.error)
        if (result.code) (err as { code?: string }).code = result.code
        throw err
      }
      return result.contract
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.contracts.all })
      toast.success("Contract created successfully")
    },
    onError: (error) => {
      toast.error(humanizeServerActionError(error, "Failed to create contract"))
    },
  })
}

// Bug #9: Next.js redacts server-action error messages in production
// builds to "An error occurred in the Server Components render. The
// specific message could not be production builds to avoid leaking
// sensitive details. A digest property is included on this error
// instance which may provide additional details about the nature of
// the error." That string is useless in a toast — it tells the user
// nothing about what failed and how to recover. When we detect the
// prod-redaction wrapper, replace it with a friendlier fallback that
// names the action and points the user at server logs (where the
// `console.error("[createContract]", err, …)` breadcrumb trail lives).
//
// In development mode (or when the action returned a humanized message
// via `throw new Error("Contract validation failed at …")`), the
// original message is preserved.
function humanizeServerActionError(
  error: unknown,
  fallback: string,
): string {
  const msg =
    error instanceof Error ? error.message : String(error ?? "")
  // Next.js 16 production builds redact server-action error messages
  // and attach a `digest` hash that correlates to the server log
  // entry. The hash is the only way to find the actual error in the
  // logs, so surface it in the toast — pre-fix the user got a
  // generic "ask an engineer" message with no handle into the log.
  const digest =
    error instanceof Error && "digest" in error
      ? String((error as { digest?: unknown }).digest ?? "")
      : ""
  if (!msg) return digest ? `${fallback} (digest ${digest})` : fallback
  if (
    msg.startsWith("An error occurred in the Server Components render") ||
    msg.includes("specific message could not be") ||
    msg.includes("digest property")
  ) {
    return digest
      ? `${fallback}. Server-log digest: ${digest}. Share this hash with engineering to find the underlying error.`
      : `${fallback}. The server logged the specific reason — ask an engineer to grep the server logs for the digest hash.`
  }
  return msg
}

export function useUpdateContract() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Parameters<typeof updateContract>[1] }) =>
      updateContract(id, data),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.contracts.all })
      queryClient.invalidateQueries({
        queryKey: queryKeys.contracts.detail(variables.id),
      })
      toast.success("Contract updated successfully")
    },
    onError: (error) => {
      toast.error(humanizeServerActionError(error, "Failed to update contract"))
    },
  })
}

export function useDeleteContract() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: deleteContract,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.contracts.all })
      toast.success("Contract deleted successfully")
    },
    onError: (error) => {
      toast.error(humanizeServerActionError(error, "Failed to delete contract"))
    },
  })
}
