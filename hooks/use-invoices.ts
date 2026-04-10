"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { queryKeys } from "@/lib/query-keys"
import {
  getInvoices,
  getInvoice,
  getInvoiceSummary,
  importInvoice,
  validateInvoice,
  flagInvoiceLineItem,
  resolveInvoiceLineItem,
  deleteInvoice,
} from "@/lib/actions/invoices"
import type { InvoiceFilters, ImportInvoiceInput } from "@/lib/validators/invoices"
import { toast } from "sonner"

export function useInvoices(entityId: string, filters?: Partial<InvoiceFilters>) {
  return useQuery({
    queryKey: queryKeys.invoices.list(entityId, filters),
    queryFn: () => getInvoices({ ...filters }),
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
