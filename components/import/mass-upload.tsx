"use client"

import React, { useState, useCallback, useRef } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import {
  ingestExtractedContracts,
  ingestExtractedInvoices,
} from "@/lib/actions/mass-upload"
import type { RichContractExtractData } from "@/lib/ai/schemas"
import {
  FileTextIcon,
  UploadIcon,
  CheckCircle2Icon,
  AlertCircleIcon,
  XIcon,
  FileStackIcon,
  SparklesIcon,
  HelpCircleIcon,
  ChevronRightIcon,
  Loader2Icon,
  FileQuestionIcon,
  ReceiptIcon,
  FileSignatureIcon,
  PackageIcon,
  ClockIcon,
  RotateCcwIcon,
} from "lucide-react"

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Textarea } from "@/components/ui/textarea"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

// ─── Types (ported from v0) ──────────────────────────────────────

export type DocumentType =
  | "contract"
  | "amendment"
  | "invoice"
  | "purchase_order"
  | "pricing_schedule"
  | "cog_report"
  | "unknown"

interface DocumentClassification {
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

interface DocumentQuestion {
  id: string
  question: string
  type: "text" | "select" | "date" | "confirm"
  options?: { value: string; label: string }[]
  required: boolean
  field: string
}

// ─── Props — additive over the existing tydei signature ─────────

interface MassUploadProps {
  facilityId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  acceptedTypes?: DocumentType[]
  onComplete?: (documents: QueuedDocument[]) => void
  title?: string
  description?: string
}

const DOCUMENT_TYPE_INFO: Record<
  DocumentType,
  { label: string; icon: React.ReactNode; color: string }
> = {
  contract: {
    label: "Contract",
    icon: <FileSignatureIcon className="h-4 w-4" />,
    color: "bg-blue-500",
  },
  amendment: {
    label: "Amendment",
    icon: <FileTextIcon className="h-4 w-4" />,
    color: "bg-purple-500",
  },
  invoice: {
    label: "Invoice",
    icon: <ReceiptIcon className="h-4 w-4" />,
    color: "bg-green-500",
  },
  purchase_order: {
    label: "Purchase Order",
    icon: <PackageIcon className="h-4 w-4" />,
    color: "bg-orange-500",
  },
  pricing_schedule: {
    label: "Pricing Schedule",
    icon: <FileTextIcon className="h-4 w-4" />,
    color: "bg-cyan-500",
  },
  cog_report: {
    label: "COG Report",
    icon: <FileTextIcon className="h-4 w-4" />,
    color: "bg-yellow-500",
  },
  unknown: {
    label: "Unknown",
    icon: <FileQuestionIcon className="h-4 w-4" />,
    color: "bg-gray-500",
  },
}

// Map the classify-document API's wider classification enum to our DocumentType.
function normalizeApiType(t: string | null | undefined): DocumentType {
  switch (t) {
    case "contract":
      return "contract"
    case "amendment":
      return "amendment"
    case "cog_data":
    case "cog_report":
      return "cog_report"
    case "pricing_file":
    case "pricing_schedule":
      return "pricing_schedule"
    case "invoice":
      return "invoice"
    case "purchase_order":
      return "purchase_order"
    default:
      return "unknown"
  }
}

export function MassUpload({
  facilityId: _facilityId,
  open,
  onOpenChange,
  acceptedTypes = [
    "contract",
    "amendment",
    "invoice",
    "purchase_order",
    "pricing_schedule",
    "cog_report",
  ],
  onComplete,
  title = "Mass Document Upload",
  description = "Upload multiple documents at once. AI will classify and extract data from each.",
}: MassUploadProps) {
  const queryClient = useQueryClient()
  const [documents, setDocuments] = useState<QueuedDocument[]>([])
  const [isDragging, setIsDragging] = useState(false)
  const [isProcessing, setIsProcessing] = useState(false)
  const [currentQuestionDoc, setCurrentQuestionDoc] = useState<QueuedDocument | null>(null)
  const [questionDialogOpen, setQuestionDialogOpen] = useState(false)
  const [currentAnswers, setCurrentAnswers] = useState<Record<string, string>>({})
  const [overallProgress, setOverallProgress] = useState(0)
  const [step, setStep] = useState<"upload" | "processing" | "review">("upload")
  const [userInstructions, setUserInstructions] = useState("")
  const [showInstructionsInput, setShowInstructionsInput] = useState(false)

  // Ref for async status tracking (avoids stale-closure issues)
  const documentStatusRef = useRef<Map<string, QueuedDocument["status"]>>(new Map())
  const documentsRef = useRef<QueuedDocument[]>([])
  documentsRef.current = documents

  const generateId = () => Math.random().toString(36).substring(2, 9)

  // ── File input handling ────────────────────────────────────────
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
  }, [])

  const addFiles = useCallback((fileList: File[]) => {
    if (fileList.length === 0) return
    const newDocs: QueuedDocument[] = fileList.map((file) => {
      const id = generateId()
      documentStatusRef.current.set(id, "pending")
      return {
        id,
        file,
        status: "pending",
        classification: null,
        extracted: null,
        userOverrides: null,
        error: null,
        progress: 0,
        questions: null,
        answers: {},
      }
    })
    setDocuments((prev) => [...prev, ...newDocs])
    toast.success(`${newDocs.length} document${newDocs.length > 1 ? "s" : ""} added to queue`)
  }, [])

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setIsDragging(false)
      const dropped = Array.from(e.dataTransfer.files)
      const allowed = dropped.filter((f) =>
        /\.(pdf|csv|xlsx?|txt)$/i.test(f.name)
      )
      if (allowed.length === 0) {
        toast.error("Please upload PDF, CSV, or Excel files")
        return
      }
      addFiles(allowed)
    },
    [addFiles]
  )

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const selected = Array.from(e.target.files || [])
      addFiles(selected)
      e.target.value = ""
    },
    [addFiles]
  )

  const removeDocument = (id: string) => {
    documentStatusRef.current.delete(id)
    setDocuments((prev) => prev.filter((d) => d.id !== id))
  }

  const updateDocument = (id: string, updates: Partial<QueuedDocument>) => {
    if (updates.status) documentStatusRef.current.set(id, updates.status)
    setDocuments((prev) => prev.map((d) => (d.id === id ? { ...d, ...updates } : d)))
  }

  // ── Duplicate detection ────────────────────────────────────────
  const calculateSimilarity = (str1: string, str2: string): number => {
    const s1 = str1.toLowerCase().replace(/[^a-z0-9]/g, "")
    const s2 = str2.toLowerCase().replace(/[^a-z0-9]/g, "")
    if (s1 === s2) return 1
    const longer = s1.length > s2.length ? s1 : s2
    const shorter = s1.length > s2.length ? s2 : s1
    if (longer.length === 0) return 1
    let matches = 0
    for (let i = 0; i < shorter.length; i++) {
      if (longer.includes(shorter[i])) matches++
    }
    return matches / longer.length
  }

  const checkForDuplicates = (
    doc: QueuedDocument,
    classification: DocumentClassification
  ): { isDuplicate: boolean; duplicateOf: string | null } => {
    for (const other of documentsRef.current) {
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
  const classifyDocument = async (
    doc: QueuedDocument
  ): Promise<DocumentClassification> => {
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

    const dup = checkForDuplicates(doc, base)
    return { ...base, ...dup }
  }

  // ── Generate questions for low-confidence classifications ─────
  const generateQuestions = (c: DocumentClassification): DocumentQuestion[] => {
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
  const extractContract = async (doc: QueuedDocument) => {
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

  // ── Process the whole queue ────────────────────────────────────
  const processAllDocuments = async () => {
    if (documents.length === 0) return
    setIsProcessing(true)
    setStep("processing")
    setOverallProgress(0)

    const total = documents.length
    let processed = 0

    for (const doc of documentsRef.current) {
      if (doc.status === "completed") {
        processed++
        continue
      }

      updateDocument(doc.id, { status: "classifying", progress: 10 })
      try {
        const classification = await classifyDocument(doc)
        updateDocument(doc.id, {
          classification,
          progress: 40,
          status: "needs_input",
        })

        const questions = generateQuestions(classification)
        if (questions.length > 0) {
          updateDocument(doc.id, { questions, status: "needs_input", progress: 40 })
          setCurrentQuestionDoc({ ...doc, questions, classification })
          setCurrentAnswers({})
          setQuestionDialogOpen(true)

          // Wait until the user answers (or timeout after 2 minutes).
          await new Promise<void>((resolve) => {
            const check = setInterval(() => {
              const status = documentStatusRef.current.get(doc.id)
              if (status === "extracting" || status === "processing" || status === "completed") {
                clearInterval(check)
                resolve()
              }
            }, 100)
            setTimeout(() => {
              clearInterval(check)
              resolve()
            }, 120_000)
          })
        } else {
          updateDocument(doc.id, { status: "extracting", progress: 60 })
        }

        // For PDF contracts/amendments, run extraction.
        const currentDoc =
          documentsRef.current.find((d) => d.id === doc.id) ?? doc
        const isPdf = /\.pdf$/i.test(currentDoc.file.name)
        const cType = currentDoc.classification?.type ?? classification.type
        if (isPdf && (cType === "contract" || cType === "amendment")) {
          try {
            updateDocument(doc.id, { status: "extracting", progress: 70 })
            const result = await extractContract(currentDoc)
            // extract-contract returns { richExtracted, extracted (legacy), ... }.
            // Store the rich shape so handleComplete can feed it directly to
            // ingestExtractedContracts without shape-shifting.
            const richData =
              (result?.richExtracted as Record<string, unknown> | undefined) ??
              (result?.extracted as Record<string, unknown> | undefined) ??
              null
            updateDocument(doc.id, {
              extracted: richData,
              status: "completed",
              progress: 100,
            })
          } catch (err) {
            updateDocument(doc.id, {
              status: "error",
              error: err instanceof Error ? err.message : "Extraction failed",
              progress: 0,
            })
          }
        } else {
          updateDocument(doc.id, { status: "completed", progress: 100 })
        }

        processed++
        setOverallProgress(Math.round((processed / total) * 100))
      } catch (err) {
        updateDocument(doc.id, {
          status: "error",
          error: err instanceof Error ? err.message : "Processing failed",
          progress: 0,
        })
        processed++
        setOverallProgress(Math.round((processed / total) * 100))
      }
    }

    setIsProcessing(false)
    setStep("review")
  }

  const handleSubmitAnswers = () => {
    if (!currentQuestionDoc) return
    const unanswered = currentQuestionDoc.questions?.filter(
      (q) => q.required && !currentAnswers[q.field]
    )
    if (unanswered && unanswered.length > 0) {
      toast.error("Please answer all required questions")
      return
    }

    const overrides: Partial<DocumentClassification> = {}
    for (const [k, v] of Object.entries(currentAnswers)) {
      if (k === "type") {
        overrides.type = v as DocumentType
      } else if (k === "vendorName") {
        overrides.vendorName = v
      } else if (k === "contractName") {
        overrides.contractName = v
      } else if (k === "invoiceNumber") {
        overrides.invoiceNumber = v
      } else if (k === "dataPeriod") {
        overrides.dataPeriod = v
      }
    }

    const existingClassification = currentQuestionDoc.classification
    const mergedClassification = existingClassification
      ? { ...existingClassification, ...overrides, confidence: 1.0 }
      : existingClassification

    updateDocument(currentQuestionDoc.id, {
      answers: currentAnswers,
      userOverrides: overrides,
      classification: mergedClassification,
      status: "extracting",
      progress: 60,
    })

    setQuestionDialogOpen(false)
    setCurrentQuestionDoc(null)
    setCurrentAnswers({})
  }

  const handleSkipQuestions = () => {
    if (!currentQuestionDoc) return
    updateDocument(currentQuestionDoc.id, {
      status: "extracting",
      progress: 60,
    })
    setQuestionDialogOpen(false)
    setCurrentQuestionDoc(null)
    setCurrentAnswers({})
  }

  const retryFailed = () => {
    const failed = documentsRef.current.filter((d) => d.status === "error")
    failed.forEach((d) =>
      updateDocument(d.id, { status: "pending", error: null, progress: 0 })
    )
    processAllDocuments()
  }

  const handleComplete = async () => {
    const completed = documentsRef.current.filter((d) => d.status === "completed")
    if (completed.length === 0) {
      toast.error("No completed documents to commit")
      return
    }

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

    // Optional callback for callers that want to react to completion.
    if (onComplete) {
      onComplete(completed)
    }

    // Invalidate relevant caches so whatever page is in view refreshes.
    queryClient.invalidateQueries({ queryKey: ["contracts"] })
    queryClient.invalidateQueries({ queryKey: ["invoices"] })
    queryClient.invalidateQueries({ queryKey: ["dashboard"] })
    queryClient.invalidateQueries({ queryKey: ["vendors"] })

    // Reset + close the dialog
    onOpenChange(false)
    setDocuments([])
    setStep("upload")
    setOverallProgress(0)

    // Final toast reflects what was actually persisted.
    if (totalCreated > 0 && totalFailed === 0) {
      toast.success(
        `Imported ${totalCreated} document${totalCreated !== 1 ? "s" : ""}`,
        {
          description:
            contractDocs.length > 0 && invoiceDocs.length > 0
              ? `${contractDocs.length} contract${
                  contractDocs.length !== 1 ? "s" : ""
                } · ${invoiceDocs.length} invoice${
                  invoiceDocs.length !== 1 ? "s" : ""
                }`
              : undefined,
        }
      )
    } else if (totalCreated > 0 && totalFailed > 0) {
      toast.warning(
        `Imported ${totalCreated} · ${totalFailed} failed`,
        { description: errorMessages.slice(0, 3).join(" · ") }
      )
    } else if (totalFailed > 0) {
      toast.error(`Import failed (${totalFailed})`, {
        description: errorMessages.slice(0, 3).join(" · "),
      })
    } else {
      // Nothing routed through an ingest action — the completed docs were
      // all types we don't persist inline yet (cog_report / pricing_schedule /
      // purchase_order). Keep them in the queue's onComplete callback and
      // toast that classification is done.
      toast.success(
        `${completed.length} document${
          completed.length !== 1 ? "s" : ""
        } classified`,
        { description: "Review in the destination tab to finalize." }
      )
    }
  }

  const statusCounts = {
    pending: documents.filter((d) => d.status === "pending").length,
    processing: documents.filter((d) =>
      ["classifying", "processing", "needs_input", "extracting"].includes(d.status)
    ).length,
    completed: documents.filter((d) => d.status === "completed").length,
    error: documents.filter((d) => d.status === "error").length,
  }

  const renderStatusBadge = (status: QueuedDocument["status"]) => {
    switch (status) {
      case "pending":
        return (
          <Badge variant="outline" className="gap-1">
            <ClockIcon className="h-3 w-3" /> Pending
          </Badge>
        )
      case "classifying":
        return (
          <Badge variant="secondary" className="gap-1">
            <Loader2Icon className="h-3 w-3 animate-spin" /> Classifying
          </Badge>
        )
      case "needs_input":
        return (
          <Badge variant="default" className="gap-1 bg-amber-500">
            <HelpCircleIcon className="h-3 w-3" /> Needs Input
          </Badge>
        )
      case "extracting":
        return (
          <Badge variant="secondary" className="gap-1">
            <Loader2Icon className="h-3 w-3 animate-spin" /> Extracting
          </Badge>
        )
      case "processing":
        return (
          <Badge variant="secondary" className="gap-1">
            <Loader2Icon className="h-3 w-3 animate-spin" /> Processing
          </Badge>
        )
      case "completed":
        return (
          <Badge variant="default" className="gap-1 bg-green-500">
            <CheckCircle2Icon className="h-3 w-3" /> Done
          </Badge>
        )
      case "error":
        return (
          <Badge variant="destructive" className="gap-1">
            <AlertCircleIcon className="h-3 w-3" /> Error
          </Badge>
        )
      default:
        return null
    }
  }

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(val) => {
          if (!val) {
            setDocuments([])
            setStep("upload")
            setOverallProgress(0)
          }
          onOpenChange(val)
        }}
      >
        <DialogContent className="sm:max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileStackIcon className="h-5 w-5" /> {title}
            </DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>

          <ScrollArea className="flex-1 pr-3">
            <Card className="border-0 shadow-none">
              <CardHeader className="px-0 pt-0">
                <CardTitle className="sr-only">Upload</CardTitle>
                <CardDescription className="sr-only">{description}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6 px-0">
                {/* User Instructions */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setShowInstructionsInput(!showInstructionsInput)}
                      className="gap-2 text-muted-foreground hover:text-foreground -ml-2"
                    >
                      <SparklesIcon className="h-4 w-4" />
                      {showInstructionsInput ? "Hide Instructions" : "Add Instructions for AI"}
                      <ChevronRightIcon
                        className={`h-4 w-4 transition-transform ${showInstructionsInput ? "rotate-90" : ""}`}
                      />
                    </Button>
                    {userInstructions && !showInstructionsInput && (
                      <Badge variant="secondary" className="gap-1">
                        <CheckCircle2Icon className="h-3 w-3" />
                        Instructions added
                      </Badge>
                    )}
                  </div>

                  {showInstructionsInput && (
                    <div className="space-y-3 p-4 bg-muted/50 rounded-lg border">
                      <div className="space-y-1">
                        <Label htmlFor="user-instructions" className="text-sm font-medium">
                          Describe what you want the system to do
                        </Label>
                        <p className="text-xs text-muted-foreground">
                          Help the AI understand your intent — what type of data, how to
                          process it, and any special considerations
                        </p>
                      </div>
                      <Textarea
                        id="user-instructions"
                        placeholder="Example: 'These are Q1 2024 invoices from Stryker for our orthopedic department.'"
                        value={userInstructions}
                        onChange={(e) => setUserInstructions(e.target.value)}
                        className="min-h-[80px] resize-none"
                        disabled={isProcessing}
                      />
                      <div className="flex flex-wrap gap-2">
                        <span className="text-xs text-muted-foreground self-center">
                          Quick prompts:
                        </span>
                        {[
                          {
                            label: "Contracts",
                            text:
                              "These are contract documents. Extract vendor name, effective dates, rebate tiers, and pricing terms.",
                          },
                          {
                            label: "Invoices",
                            text:
                              "These are invoices. Extract vendor, invoice number, line items, quantities, and prices.",
                          },
                          {
                            label: "COG Data",
                            text:
                              "This is COG (Cost of Goods) data. Import all line items and flag duplicates.",
                          },
                          {
                            label: "Pricing",
                            text:
                              "These are pricing schedules. Extract all product pricing, effective dates, and tier structures.",
                          },
                        ].map((p) => (
                          <Button
                            key={p.label}
                            variant="outline"
                            size="sm"
                            className="text-xs h-7"
                            onClick={() => setUserInstructions(p.text)}
                            disabled={isProcessing}
                          >
                            {p.label}
                          </Button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* Active instructions indicator */}
                {userInstructions && isProcessing && (
                  <div className="p-3 bg-primary/5 border border-primary/20 rounded-lg">
                    <div className="flex items-start gap-2">
                      <SparklesIcon className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                      <div className="space-y-1">
                        <p className="text-xs font-medium text-primary">
                          AI Instructions Active
                        </p>
                        <p className="text-xs text-muted-foreground">{userInstructions}</p>
                      </div>
                    </div>
                  </div>
                )}

                {/* Overall progress */}
                {documents.length > 0 && (
                  <div className="flex items-center gap-4 p-4 bg-muted/50 rounded-lg">
                    <div className="flex-1 space-y-2">
                      <div className="flex items-center justify-between text-sm">
                        <span>
                          {statusCounts.completed} of {documents.length} processed
                        </span>
                        <span className="text-muted-foreground">{overallProgress}%</span>
                      </div>
                      <Progress value={overallProgress} />
                    </div>
                    <div className="flex gap-2">
                      {statusCounts.error > 0 && (
                        <Badge variant="destructive">{statusCounts.error} failed</Badge>
                      )}
                      {statusCounts.processing > 0 && (
                        <Badge variant="secondary">
                          {statusCounts.processing} in progress
                        </Badge>
                      )}
                    </div>
                  </div>
                )}

                {/* Drop zone */}
                <div
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                  className={`relative flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-8 transition-colors ${
                    isDragging
                      ? "border-primary bg-primary/5"
                      : "border-muted-foreground/25 hover:border-muted-foreground/50"
                  } ${isProcessing ? "pointer-events-none opacity-50" : ""}`}
                >
                  <div className="flex items-center justify-center h-16 w-16 rounded-full bg-primary/10 mb-4">
                    <UploadIcon className="h-8 w-8 text-primary" />
                  </div>
                  <p className="mb-1 text-lg font-medium">Drop files here</p>
                  <p className="text-sm text-muted-foreground mb-4">
                    Upload contracts, invoices, purchase orders, and more — all at once
                  </p>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground mb-4">
                    <SparklesIcon className="h-3 w-3" />
                    AI will automatically classify and extract data from each document
                  </div>
                  <label>
                    <Button variant="outline" asChild disabled={isProcessing}>
                      <span>Select Files</span>
                    </Button>
                    <input
                      type="file"
                      accept=".pdf,.csv,.xlsx,.xls,.txt"
                      multiple
                      className="hidden"
                      onChange={handleFileSelect}
                      disabled={isProcessing}
                    />
                  </label>
                </div>

                {/* Document queue */}
                {documents.length > 0 && (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <Label>Document Queue ({documents.length})</Label>
                      {!isProcessing && statusCounts.error > 0 && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={retryFailed}
                          className="gap-1"
                        >
                          <RotateCcwIcon className="h-3 w-3" />
                          Retry Failed
                        </Button>
                      )}
                    </div>

                    <div className="space-y-2">
                      {documents.map((doc) => {
                        const typeInfo = doc.classification?.type
                          ? DOCUMENT_TYPE_INFO[doc.classification.type]
                          : null

                        return (
                          <div
                            key={doc.id}
                            className={`flex items-center gap-3 p-3 rounded-lg border bg-card transition-colors ${
                              doc.status === "needs_input"
                                ? "border-amber-500 bg-amber-500/5"
                                : ""
                            }`}
                          >
                            <div
                              className={`h-10 w-10 rounded flex items-center justify-center ${
                                typeInfo ? typeInfo.color : "bg-muted"
                              } text-white`}
                            >
                              {typeInfo?.icon ?? <FileTextIcon className="h-5 w-5" />}
                            </div>

                            <div className="flex-1 min-w-0">
                              <p className="font-medium text-sm truncate">
                                {doc.file.name}
                              </p>
                              <div className="flex items-center gap-2 mt-1">
                                {doc.classification && (
                                  <Badge variant="outline" className="text-xs">
                                    {DOCUMENT_TYPE_INFO[doc.classification.type].label}
                                    {doc.classification.confidence < 1 &&
                                      ` (${Math.round(doc.classification.confidence * 100)}%)`}
                                  </Badge>
                                )}
                                {doc.classification?.vendorName && (
                                  <span className="text-xs text-muted-foreground">
                                    {doc.classification.vendorName}
                                  </span>
                                )}
                                {doc.classification?.dataPeriod && (
                                  <span className="text-xs text-muted-foreground">
                                    · {doc.classification.dataPeriod}
                                  </span>
                                )}
                              </div>
                              {doc.error && (
                                <p className="text-xs text-destructive mt-1">
                                  {doc.error}
                                </p>
                              )}
                            </div>

                            <div className="flex items-center gap-2">
                              {renderStatusBadge(doc.status)}

                              {doc.status === "needs_input" && !isProcessing && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => {
                                    setCurrentQuestionDoc(doc)
                                    setCurrentAnswers(doc.answers || {})
                                    setQuestionDialogOpen(true)
                                  }}
                                >
                                  Answer
                                </Button>
                              )}

                              {!isProcessing && doc.status !== "processing" && (
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8"
                                  onClick={() => removeDocument(doc.id)}
                                >
                                  <XIcon className="h-4 w-4" />
                                </Button>
                              )}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </ScrollArea>

          <DialogFooter className="flex justify-between sm:justify-between">
            <Button
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isProcessing}
            >
              Cancel
            </Button>
            <div className="flex gap-2">
              {step === "review" && statusCounts.completed > 0 && (
                <Button onClick={handleComplete}>
                  <CheckCircle2Icon className="mr-2 h-4 w-4" />
                  Complete ({statusCounts.completed} documents)
                </Button>
              )}
              {step !== "review" && documents.length > 0 && (
                <Button
                  onClick={processAllDocuments}
                  disabled={isProcessing || statusCounts.pending === 0}
                >
                  {isProcessing ? (
                    <>
                      <Loader2Icon className="mr-2 h-4 w-4 animate-spin" />
                      Processing...
                    </>
                  ) : (
                    <>
                      <SparklesIcon className="mr-2 h-4 w-4" />
                      Process All ({statusCounts.pending})
                    </>
                  )}
                </Button>
              )}
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Per-document Question Dialog */}
      <Dialog open={questionDialogOpen} onOpenChange={setQuestionDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <HelpCircleIcon className="h-5 w-5 text-amber-500" />
              Additional Information Needed
            </DialogTitle>
            <DialogDescription>
              {currentQuestionDoc && (
                <>
                  Please answer these questions about:{" "}
                  <strong>{currentQuestionDoc.file.name}</strong>
                </>
              )}
            </DialogDescription>
          </DialogHeader>

          {currentQuestionDoc?.questions && (
            <div className="space-y-4 py-4">
              {currentQuestionDoc.questions.map((q) => (
                <div key={q.id} className="space-y-2">
                  <Label className="flex items-center gap-1">
                    {q.question}
                    {q.required && <span className="text-destructive">*</span>}
                  </Label>

                  {q.type === "text" && (
                    <Input
                      value={currentAnswers[q.field] || ""}
                      onChange={(e) =>
                        setCurrentAnswers((prev) => ({
                          ...prev,
                          [q.field]: e.target.value,
                        }))
                      }
                      placeholder={`Enter ${q.field.replace(/_/g, " ")}`}
                    />
                  )}

                  {q.type === "select" && q.options && (
                    <Select
                      value={currentAnswers[q.field] || ""}
                      onValueChange={(value) =>
                        setCurrentAnswers((prev) => ({ ...prev, [q.field]: value }))
                      }
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select an option" />
                      </SelectTrigger>
                      <SelectContent>
                        {q.options.map((opt) => (
                          <SelectItem key={opt.value} value={opt.value}>
                            {opt.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}

                  {q.type === "date" && (
                    <Input
                      type="date"
                      value={currentAnswers[q.field] || ""}
                      onChange={(e) =>
                        setCurrentAnswers((prev) => ({
                          ...prev,
                          [q.field]: e.target.value,
                        }))
                      }
                    />
                  )}
                </div>
              ))}
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={handleSkipQuestions}>
              Skip
            </Button>
            <Button onClick={handleSubmitAnswers}>
              <ChevronRightIcon className="mr-2 h-4 w-4" />
              Continue
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
