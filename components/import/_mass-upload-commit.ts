// Commit-stage logic for MassUpload — routes each completed document group
// to its ingest path (server action or multipart route handler). Client-side
// caller only; the server actions themselves live in lib/actions/imports/*
// and must not move (action-id stability). Cache invalidation, toasts, and
// dialog reset stay in the component next to the queryClient.

import { ingestExtractedContracts } from "@/lib/actions/imports/contract-import"
import { ingestExtractedInvoices } from "@/lib/actions/imports/invoice-import"
import {
  ingestCaseDataCSV,
  ingestCaseProceduresCSV,
  ingestCaseSuppliesCSV,
} from "@/lib/actions/imports/case-costing-import"
import type { RichContractExtractData } from "@/lib/ai/schemas"
import type { QueuedDocument } from "./_mass-upload-types"

export interface CommitResult {
  totalCreated: number
  totalFailed: number
  errorMessages: string[]
  groupCounts: {
    contracts: number
    invoices: number
    caseData: number
    caseProcedures: number
    caseSupplies: number
    cog: number
    pricing: number
  }
}

export async function commitCompletedDocuments(
  completed: QueuedDocument[]
): Promise<CommitResult> {
  // Partition completed docs by document type so we can route each group
  // to the appropriate server action. Each group becomes its own inline
  // commit — no navigation, no page redirects, no toast-lies.
  const contractDocs = completed.filter(
    (d) =>
      (d.classification?.type === "contract" ||
        d.classification?.type === "amendment") &&
      d.extracted !== null
  )
  const invoiceDocs = completed.filter(
    (d) => d.classification?.type === "invoice"
  )
  const caseDataDocs = completed.filter(
    (d) => d.classification?.type === "case_data"
  )
  const caseProcedureDocs = completed.filter(
    (d) => d.classification?.type === "case_procedures"
  )
  const caseSupplyDocs = completed.filter(
    (d) => d.classification?.type === "case_supplies"
  )
  const cogDocs = completed.filter(
    (d) =>
      d.classification?.type === "cog_data" ||
      d.classification?.type === "cog_report"
  )
  const pricingDocs = completed.filter(
    (d) =>
      d.classification?.type === "pricing_file" ||
      d.classification?.type === "pricing_schedule"
  )

  let totalCreated = 0
  let totalFailed = 0
  const errorMessages: string[] = []

  // ── Contracts ────────────────────────────────────────────────
  if (contractDocs.length > 0) {
    try {
      const result = await ingestExtractedContracts(
        contractDocs.map((d) => ({
          extracted: d.extracted as unknown as RichContractExtractData,
          sourceFilename: d.file.name,
        }))
      )
      totalCreated += result.created
      totalFailed += result.failed
      for (const r of result.results) {
        if (!r.ok) errorMessages.push(`${r.name}: ${r.error}`)
      }
    } catch (err) {
      totalFailed += contractDocs.length
      errorMessages.push(
        `Contract ingest failed: ${
          err instanceof Error ? err.message : String(err)
        }`
      )
    }
  }

  // ── Invoices ─────────────────────────────────────────────────
  if (invoiceDocs.length > 0) {
    try {
      const result = await ingestExtractedInvoices(
        invoiceDocs.map((d) => ({
          invoiceNumber:
            d.classification?.invoiceNumber ??
            d.userOverrides?.invoiceNumber ??
            null,
          vendorName:
            d.classification?.vendorName ??
            d.userOverrides?.vendorName ??
            null,
          invoiceDate:
            d.classification?.documentDate ??
            d.userOverrides?.documentDate ??
            null,
          totalAmount: d.classification?.totalValue ?? null,
          sourceFilename: d.file.name,
        }))
      )
      totalCreated += result.created
      totalFailed += result.failed
      for (const r of result.results) {
        if (!r.ok) errorMessages.push(`${r.invoiceNumber}: ${r.error}`)
      }
    } catch (err) {
      totalFailed += invoiceDocs.length
      errorMessages.push(
        `Invoice ingest failed: ${
          err instanceof Error ? err.message : String(err)
        }`
      )
    }
  }

  // ── Case Data CSVs — ingest patient-level case metadata ────
  // Ingest case data BEFORE procedures so procedures find parent cases.
  for (const d of caseDataDocs) {
    try {
      const csvText = await d.file.text()
      const r = await ingestCaseDataCSV(csvText, d.file.name)
      totalCreated += r.created + r.updated
      totalFailed += r.failed
      for (const e of r.errors) errorMessages.push(`${d.file.name}: ${e}`)
    } catch (err) {
      totalFailed++
      errorMessages.push(
        `${d.file.name}: ${err instanceof Error ? err.message : String(err)}`
      )
    }
  }

  // ── Case Procedures CSVs ───────────────────────────────────
  for (const d of caseProcedureDocs) {
    try {
      const csvText = await d.file.text()
      const r = await ingestCaseProceduresCSV(csvText, d.file.name)
      totalCreated += r.created
      totalFailed += r.failed
      for (const e of r.errors) errorMessages.push(`${d.file.name}: ${e}`)
    } catch (err) {
      totalFailed++
      errorMessages.push(
        `${d.file.name}: ${err instanceof Error ? err.message : String(err)}`
      )
    }
  }

  // ── Case Supplies CSVs (ingest AFTER case data + procedures
  //     so parent Case rows exist first) ───────────────────────
  for (const d of caseSupplyDocs) {
    try {
      const csvText = await d.file.text()
      const r = await ingestCaseSuppliesCSV(csvText, d.file.name)
      totalCreated += r.created
      totalFailed += r.failed
      for (const e of r.errors) errorMessages.push(`${d.file.name}: ${e}`)
    } catch (err) {
      totalFailed++
      errorMessages.push(
        `${d.file.name}: ${err instanceof Error ? err.message : String(err)}`
      )
    }
  }

  // ── COG Records — .xlsx + .csv via /api/import-cog ─────────
  // Bug 2026-05-18 (Vick "Primary full COG.xlsx" — Maximum array
  // nesting exceeded): previously `await d.file.text()` on an .xlsx
  // produced binary garbage AND the resulting Server Action payload
  // tripped RSC's array-leaf cap. Route Handler + multipart formData
  // is the Next.js-recommended path for arbitrary tabular uploads;
  // mirrors the /api/import-pricing fix.
  for (const d of cogDocs) {
    try {
      const form = new FormData()
      form.append("file", d.file)
      const res = await fetch("/api/import-cog", {
        method: "POST",
        body: form,
      })
      if (!res.ok) {
        const errBody = (await res
          .json()
          .catch(() => null)) as { error?: string } | null
        throw new Error(errBody?.error ?? `import-cog ${res.status}`)
      }
      const r = (await res.json()) as {
        imported: number
        skipped: number
        errors: number
      }
      totalCreated += r.imported
      totalFailed += r.errors
    } catch (err) {
      totalFailed++
      errorMessages.push(
        `${d.file.name}: ${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }

  // ── Pricing Files — CSV goes direct, xlsx via /api/parse-file ──
  for (const d of pricingDocs) {
    try {
      // Bug 2026-05-18 (Vick "Primary full COG.xlsx" — Maximum
      // array nesting exceeded): parse-on-client → send-rows-to-
      // Server-Action tripped RSC's 1M-array-leaf cap on a
      // 46k-row × 25-col file. Server Actions are the wrong
      // transport for arbitrary tabular uploads — Next.js docs
      // recommend Route Handlers with multipart formData.
      // /api/import-pricing handles parse + ingest in one request;
      // the rows array never crosses the wire as RSC.
      const form = new FormData()
      form.append("file", d.file)
      const res = await fetch("/api/import-pricing", {
        method: "POST",
        body: form,
      })
      if (!res.ok) {
        const errBody = (await res
          .json()
          .catch(() => null)) as { error?: string } | null
        throw new Error(errBody?.error ?? `import-pricing ${res.status}`)
      }
      const r = (await res.json()) as {
        imported: number
        failed: number
        vendorUsed: string | null
      }
      totalCreated += r.imported
      totalFailed += r.failed
    } catch (err) {
      totalFailed++
      errorMessages.push(
        `${d.file.name}: ${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }

  return {
    totalCreated,
    totalFailed,
    errorMessages,
    groupCounts: {
      contracts: contractDocs.length,
      invoices: invoiceDocs.length,
      caseData: caseDataDocs.length,
      caseProcedures: caseProcedureDocs.length,
      caseSupplies: caseSupplyDocs.length,
      cog: cogDocs.length,
      pricing: pricingDocs.length,
    },
  }
}
