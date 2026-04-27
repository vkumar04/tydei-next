// Pure data shapes for MassUpload — no JSX, no component state.

export type DocumentType =
  | "contract"
  | "amendment"
  | "invoice"
  | "purchase_order"
  | "pricing_schedule"
  | "pricing_file"
  | "cog_report"
  | "cog_data"
  | "case_data"
  | "case_procedures"
  | "case_supplies"
  | "unknown"

export interface DocumentClassification {
  type: DocumentType
  confidence: number
  vendorName: string | null
  documentDate: string | null
  contractName: string | null
  invoiceNumber: string | null
  poNumber: string | null
  suggestedCategory: string | null
  extractedData: Record<string, unknown> | null
  dataPeriod: string | null
  year: number | null
  quarter: number | null
  month: number | null
  recordCount: number | null
  totalValue: number | null
  isDuplicate: boolean
  duplicateOf: string | null
}

export interface DocumentQuestion {
  id: string
  question: string
  type: "text" | "select" | "date" | "confirm"
  options?: { value: string; label: string }[]
  required: boolean
  field: string
}

export interface QueuedDocument {
  id: string
  file: File
  status:
    | "pending"
    | "classifying"
    | "needs_input"
    | "extracting"
    | "processing"
    | "completed"
    | "error"
  classification: DocumentClassification | null
  extracted: Record<string, unknown> | null
  userOverrides: Partial<DocumentClassification> | null
  error: string | null
  progress: number
  questions: DocumentQuestion[] | null
  answers: Record<string, string>
}

export interface MassUploadProps {
  facilityId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  acceptedTypes?: DocumentType[]
  onComplete?: (documents: QueuedDocument[]) => void
  title?: string
  description?: string
}
