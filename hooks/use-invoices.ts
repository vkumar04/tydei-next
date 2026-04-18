"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { queryKeys } from "@/lib/query-keys"
import {
  getInvoices,
  getInvoicesForVendor,
  getInvoice,
  getInvoiceSummary,
  importInvoice,
  validateInvoice,
  flagInvoiceLineItem,
  resolveInvoiceLineItem,
  deleteInvoice,
} from "@/lib/actions/invoices"
import {
  flagInvoiceAsDisputed,
  resolveInvoiceDispute,
} from "@/lib/actions/invoices/dispute"
import type { InvoiceFilters, ImportInvoiceInput } from "@/lib/validators/invoices"
import { toast } from "sonner"

export function useInvoices(entityId: string, filters?: Partial<InvoiceFilters>) {
  return useQuery({
    queryKey: queryKeys.invoices.list(entityId, filters),
    queryFn: () => getInvoices({ ...filters }),
  })
}

export function useVendorInvoices(vendorId: string, filters?: Partial<InvoiceFilters>) {
  return useQuery({
    queryKey: queryKeys.invoices.list(`vendor:${vendorId}`, filters),
    queryFn: () => getInvoicesForVendor(filters),
    enabled: !!vendorId,
  })
}

export function useInvoiceSummary(facilityId: string) {
  return useQuery({
    queryKey: queryKeys.invoices.list(facilityId, { summary: true }),
    queryFn: () => getInvoiceSummary(facilityId),
    enabled: !!facilityId,
  })
}

export function useInvoice(id: string) {
  return useQuery({
    queryKey: queryKeys.invoices.detail(id),
    queryFn: () => getInvoice(id),
    enabled: !!id,
  })
}

export function useImportInvoice() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: importInvoice,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.invoices.all })
      toast.success("Invoice imported successfully")
    },
    onError: (e) => toast.error(e.message || "Failed to import invoice"),
  })
}

export function useValidateInvoice(id: string) {
  return useQuery({
    queryKey: queryKeys.invoices.validation(id),
    queryFn: () => validateInvoice(id),
    enabled: !!id,
  })
}

export function useFlagInvoiceLineItem() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ lineItemId, notes }: { lineItemId: string; notes?: string }) =>
      flagInvoiceLineItem(lineItemId, notes),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.invoices.all })
      toast.success("Item flagged")
    },
    onError: (e) => toast.error(e.message || "Failed to flag item"),
  })
}

export function useDeleteInvoice() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: deleteInvoice,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.invoices.all })
      toast.success("Invoice deleted")
    },
    onError: (e) => toast.error(e.message || "Failed to delete invoice"),
  })
}

export function useResolveInvoiceLineItem() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: resolveInvoiceLineItem,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.invoices.all })
      toast.success("Item resolved")
    },
    onError: (e) => toast.error(e.message || "Failed to resolve item"),
  })
}

export function useFlagInvoiceAsDisputed() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: { invoiceId: string; note: string }) =>
      flagInvoiceAsDisputed(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.invoices.all })
      toast.success("Invoice flagged as disputed")
    },
    onError: (e) => toast.error(e.message || "Failed to flag invoice"),
  })
}

export function useResolveInvoiceDispute() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: {
      invoiceId: string
      resolution: "resolved" | "rejected"
      note?: string
    }) => resolveInvoiceDispute(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.invoices.all })
      toast.success("Dispute updated")
    },
    onError: (e) => toast.error(e.message || "Failed to update dispute"),
  })
}
