"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { queryKeys } from "@/lib/query-keys"
import { useToastMutation } from "@/hooks/use-toast-mutation"
import {
  getInvoices,
  getInvoicesForVendor,
  getInvoice,
  getInvoiceSummary,
  importInvoice,
  validateInvoice,
  approveInvoice,
  flagInvoiceLineItem,
  resolveInvoiceLineItem,
  deleteInvoice,
} from "@/lib/actions/invoices"
import {
  flagInvoiceAsDisputed,
  resolveInvoiceDispute,
} from "@/lib/actions/invoices/dispute"
import type { InvoiceFilters } from "@/lib/validators/invoices"
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
  return useToastMutation(importInvoice, {
    invalidate: [queryKeys.invoices.all],
    success: "Invoice imported successfully",
    error: "Failed to import invoice",
  })
}

export function useValidateInvoice(id: string) {
  return useQuery({
    queryKey: queryKeys.invoices.validation(id),
    queryFn: () => validateInvoice(id),
    enabled: !!id,
  })
}

export function useApproveInvoice() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: approveInvoice,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.invoices.all })
      toast.success("Invoice approved", {
        description: "Invoice has been marked as verified",
      })
    },
    onError: (e) => toast.error(e.message || "Failed to approve invoice"),
  })
}

export function useFlagInvoiceLineItem() {
  return useToastMutation(
    ({ lineItemId, notes }: { lineItemId: string; notes?: string }) =>
      flagInvoiceLineItem(lineItemId, notes),
    {
      invalidate: [queryKeys.invoices.all],
      success: "Item flagged",
      error: "Failed to flag item",
    },
  )
}

export function useDeleteInvoice() {
  return useToastMutation(deleteInvoice, {
    invalidate: [queryKeys.invoices.all],
    success: "Invoice deleted",
    error: "Failed to delete invoice",
  })
}

export function useResolveInvoiceLineItem() {
  return useToastMutation(resolveInvoiceLineItem, {
    invalidate: [queryKeys.invoices.all],
    success: "Item resolved",
    error: "Failed to resolve item",
  })
}

export function useFlagInvoiceAsDisputed() {
  return useToastMutation(
    (input: { invoiceId: string; note: string }) => flagInvoiceAsDisputed(input),
    {
      invalidate: [queryKeys.invoices.all],
      success: "Invoice flagged as disputed",
      error: "Failed to flag invoice",
    },
  )
}

export function useResolveInvoiceDispute() {
  return useToastMutation(
    (input: {
      invoiceId: string
      resolution: "resolved" | "rejected"
      note?: string
    }) => resolveInvoiceDispute(input),
    {
      invalidate: [queryKeys.invoices.all],
      success: "Dispute updated",
      error: "Failed to update dispute",
    },
  )
}
