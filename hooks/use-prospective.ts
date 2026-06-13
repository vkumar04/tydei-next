"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { queryKeys } from "@/lib/query-keys"
import {
  createProposal,
  deleteProposal,
  getVendorProposals,
  getVendorBenchmarks,
} from "@/lib/actions/prospective"
import {
  importVendorBenchmarks,
  type VendorBenchmarkImportInput,
} from "@/lib/actions/benchmarks"
import { importInChunks } from "@/components/shared/uploads/chunked-import"
import { toast } from "sonner"

// Feature 5 (uploader improvement 5, 2026-06-13): a benchmark file can be
// 10k+ rows. Import in 2000-row chunks so each importVendorBenchmarks call
// stays well under the 120s transaction budget, and the dropzone can render
// a progress bar. Per-chunk replace is idempotent (each call only deletes
// its OWN chunk's SKUs' priors), so re-importing the same file lands
// identically — verified by lib/actions/__tests__/vendor-benchmark-import.test.ts.
const BENCHMARK_CHUNK_SIZE = 2000

// NOTE: useScoreDeal / useFinancialProjections were removed on
// 2026-06-10 (audit H2) — both hooks had zero consumers. Proposal
// scoring now flows through the Deal Scorer
// (getVendorProspectiveAnalysis with a proposalRowId).

export function useCreateProposal() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: createProposal,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["prospective"] })
      toast.success("Proposal draft created")
    },
    onError: (err) => toast.error(err.message || "Failed to create proposal"),
  })
}

export function useVendorProposals(vendorId: string) {
  return useQuery({
    queryKey: queryKeys.prospective.vendorProposals(vendorId),
    queryFn: () => getVendorProposals(vendorId),
  })
}

export function useVendorBenchmarks(vendorId: string) {
  return useQuery({
    queryKey: ["prospective", "vendorBenchmarks", vendorId],
    queryFn: () => getVendorBenchmarks(),
    enabled: !!vendorId,
  })
}

// Benchmarks-tab import ("Need to be able to add data for the benchmarks",
// Vick 2026-06-12). Invalidates the vendorBenchmarks query so the table
// refreshes with the new rows.
export function useImportVendorBenchmarks(vendorId: string) {
  const qc = useQueryClient()
  return useMutation({
    // Feature 5: chunk the import (2000 rows/call) and surface progress.
    // The aggregate inserted/replaced is summed across chunks by
    // importInChunks; importVendorBenchmarks already returns both.
    mutationFn: (input: {
      items: VendorBenchmarkImportInput[]
      onProgress?: (done: number, total: number) => void
    }) =>
      importInChunks({
        items: input.items,
        chunkSize: BENCHMARK_CHUNK_SIZE,
        importChunk: (chunk) => importVendorBenchmarks(chunk),
        onProgress: input.onProgress,
      }),
    onSuccess: (res) => {
      qc.invalidateQueries({
        queryKey: ["prospective", "vendorBenchmarks", vendorId],
      })
      toast.success(
        `Imported ${res.inserted} benchmark row${res.inserted === 1 ? "" : "s"}` +
          (res.replaced > 0 ? ` (replaced ${res.replaced} prior upload row${res.replaced === 1 ? "" : "s"})` : ""),
      )
    },
    // No onError toast here (feature 5): the caller awaits mutateAsync inside
    // the dropzone's onImport, whose catch shows the single named error toast
    // (importVendorBenchmarks + importInChunks already produce descriptive
    // messages). A mutation onError would double-toast and re-enable the
    // dialog's button while the dropzone keeps it open for a retry.
  })
}

export function useDeleteProposal() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => deleteProposal(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["prospective"] })
      toast.success("Proposal deleted")
    },
    onError: (err) => toast.error(err.message || "Failed to delete proposal"),
  })
}
