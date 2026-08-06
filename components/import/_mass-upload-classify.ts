// Classification-stage helpers for MassUpload — the component's former
// closure helpers, parameterized. No JSX, no component state. The component
// passes a `getDocuments` getter (reading its documentsRef) so duplicate
// detection reads the freshest queue at the same moment the original
// closure did.

import type {
  DocumentType,
  DocumentClassification,
  DocumentQuestion,
  QueuedDocument,
} from "./_mass-upload-types"
import { calculateSimilarity } from "./_mass-upload-helpers"
import { DOCUMENT_TYPE_INFO, normalizeApiType } from "./_mass-upload-doc-type-info"

// ── Duplicate detection ────────────────────────────────────────
export function checkForDuplicates(
  doc: QueuedDocument,
  classification: DocumentClassification,
  allDocuments: QueuedDocument[]
): { isDuplicate: boolean; duplicateOf: string | null } {
  for (const other of allDocuments) {
    if (other.id === doc.id) continue
    const oc = other.classification
    if (!oc) continue
    if (
      oc.vendorName === classification.vendorName &&
      oc.dataPeriod === classification.dataPeriod &&
      oc.type === classification.type
    ) {
      return { isDuplicate: true, duplicateOf: other.file.name }
    }
    if (calculateSimilarity(doc.file.name, other.file.name) > 0.8) {
      return { isDuplicate: true, duplicateOf: other.file.name }
    }
  }
  return { isDuplicate: false, duplicateOf: null }
}

// ── Classify a single document via the real API ────────────────
export async function classifyDocument(
  doc: QueuedDocument,
  getDocuments: () => QueuedDocument[]
): Promise<DocumentClassification> {
  const form = new FormData()
  form.append("file", doc.file)
  form.append("fileName", doc.file.name)

  const res = await fetch("/api/ai/classify-document", {
    method: "POST",
    body: form,
  })
  if (!res.ok) {
    throw new Error("Classification request failed")
  }
  const data = await res.json()

  const type = normalizeApiType(data.type ?? data.classification)
  const base: DocumentClassification = {
    type,
    confidence: typeof data.confidence === "number" ? data.confidence : 0.5,
    vendorName: data.vendorName ?? null,
    documentDate: data.documentDate ?? null,
    contractName: data.contractName ?? null,
    invoiceNumber: data.invoiceNumber ?? null,
    poNumber: data.poNumber ?? null,
    suggestedCategory: data.suggestedCategory ?? null,
    extractedData: null,
    dataPeriod: data.dataPeriod ?? null,
    year: data.year ?? null,
    quarter: data.quarter ?? null,
    month: data.month ?? null,
    recordCount: data.recordCount ?? null,
    totalValue: data.totalValue ?? null,
    isDuplicate: false,
    duplicateOf: null,
  }

  const dup = checkForDuplicates(doc, base, getDocuments())
  return { ...base, ...dup }
}

// ── Generate questions for low-confidence classifications ─────
export function generateQuestions(
  c: DocumentClassification,
  acceptedTypes: DocumentType[]
): DocumentQuestion[] {
  const questions: DocumentQuestion[] = []

  if (c.confidence < 0.7 || c.type === "unknown") {
    questions.push({
      id: "doc_type",
      question: "What type of document is this?",
      type: "select",
      options: acceptedTypes.map((t) => ({
        value: t,
        label: DOCUMENT_TYPE_INFO[t].label,
      })),
      required: true,
      field: "type",
    })
  }

  if (!c.vendorName) {
    questions.push({
      id: "vendor",
      question: "Which vendor is this document from?",
      type: "text",
      required: true,
      field: "vendorName",
    })
  }

  if (c.type === "contract" && !c.contractName) {
    questions.push({
      id: "contract_name",
      question: "What is the contract name?",
      type: "text",
      required: true,
      field: "contractName",
    })
  }

  if (c.type === "invoice" && !c.invoiceNumber) {
    questions.push({
      id: "invoice_number",
      question: "What is the invoice number?",
      type: "text",
      required: true,
      field: "invoiceNumber",
    })
  }

  if (c.type === "cog_report" && !c.dataPeriod) {
    questions.push({
      id: "data_period",
      question: "What time period does this data cover?",
      type: "select",
      options: [
        { value: "Q1", label: "Q1 (Jan-Mar)" },
        { value: "Q2", label: "Q2 (Apr-Jun)" },
        { value: "Q3", label: "Q3 (Jul-Sep)" },
        { value: "Q4", label: "Q4 (Oct-Dec)" },
        { value: "annual", label: "Full Year" },
        { value: "monthly", label: "Single Month" },
      ],
      required: true,
      field: "dataPeriod",
    })
  }

  if (c.isDuplicate) {
    questions.push({
      id: "duplicate_confirm",
      question: `This file appears similar to "${c.duplicateOf}". Do you want to continue?`,
      type: "select",
      options: [
        { value: "yes", label: "Yes, import anyway" },
        { value: "no", label: "No, skip this file" },
      ],
      required: true,
      field: "duplicateAction",
    })
  }

  return questions
}

// ── Extract contract data for PDFs classified as contract/amendment ─
export async function extractContract(
  doc: QueuedDocument,
  userInstructions: string
) {
  const form = new FormData()
  form.append("file", doc.file)
  if (userInstructions.trim()) {
    form.append("userInstructions", userInstructions.trim())
  }
  const res = await fetch("/api/ai/extract-contract", {
    method: "POST",
    body: form,
  })
  if (!res.ok) throw new Error("Extraction failed")
  return await res.json()
}
