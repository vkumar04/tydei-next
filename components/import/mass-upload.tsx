"use client"

import React, { useState, useCallback, useRef } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { toRichExtractedContract } from "@/lib/ai/contract-extract-mapper"
import { queryKeys } from "@/lib/query-keys"
import { generateId } from "./_mass-upload-helpers"
import {
  classifyDocument,
  generateQuestions,
  extractContract,
} from "./_mass-upload-classify"
import { commitCompletedDocuments } from "./_mass-upload-commit"
import { MassUploadDropZone } from "./_mass-upload-drop-zone"
import { MassUploadInstructionsPanel } from "./_mass-upload-instructions-panel"
import { MassUploadQueueList } from "./_mass-upload-queue-list"
import { MassUploadQuestionDialog } from "./_mass-upload-question-dialog"
import { MassUploadHeader } from "./_mass-upload-header"
import { MassUploadProgressSummary } from "./_mass-upload-progress-summary"
import { MassUploadFooter } from "./_mass-upload-footer"

import { Dialog, DialogContent } from "@/components/ui/dialog"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { ScrollArea } from "@/components/ui/scroll-area"

// ─── Types (ported from v0) ──────────────────────────────────────

export type { DocumentType, QueuedDocument } from "./_mass-upload-types"
import type {
  DocumentType,
  DocumentClassification,
  QueuedDocument,
  MassUploadProps,
} from "./_mass-upload-types"

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
        const classification = await classifyDocument(doc, () => documentsRef.current)
        updateDocument(doc.id, {
          classification,
          progress: 40,
          status: "needs_input",
        })

        const questions = generateQuestions(classification, acceptedTypes)
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
            const result = await extractContract(currentDoc, userInstructions)
            // extract-contract returns the FLAT `extracted` shape
            // (capitalCost/termMonths/…). ingestExtractedContracts reads the
            // RICH `tieInDetails` shape, so lift flat→rich here — otherwise a
            // perfectly-extracted capital value is dropped at import (Vick
            // 2026-06-15 "still not getting the capital").
            const rawExtract =
              (result?.richExtracted as Record<string, unknown> | undefined) ??
              (result?.extracted as Record<string, unknown> | undefined) ??
              null
            const richData = rawExtract
              ? (toRichExtractedContract(rawExtract) as unknown as Record<
                  string,
                  unknown
                >)
              : null
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

    const { totalCreated, totalFailed, errorMessages, groupCounts } =
      await commitCompletedDocuments(completed)

    // Optional callback for callers that want to react to completion.
    if (onComplete) {
      onComplete(completed)
    }

    // Invalidate relevant caches so whatever page is in view refreshes.
    queryClient.invalidateQueries({ queryKey: queryKeys.contracts.all })
    queryClient.invalidateQueries({ queryKey: queryKeys.invoices.all })
    queryClient.invalidateQueries({ queryKey: queryKeys.dashboard.all })
    queryClient.invalidateQueries({ queryKey: queryKeys.vendors.all })
    queryClient.invalidateQueries({ queryKey: queryKeys.cases.all })
    // case-costing reads aren't on the factory yet; keep the literal so it
    // stays prefix-aligned with case-costing-client's queries.
    queryClient.invalidateQueries({ queryKey: ["case-costing"] })

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
            groupCounts.contracts > 0 && groupCounts.invoices > 0
              ? `${groupCounts.contracts} contract${
                  groupCounts.contracts !== 1 ? "s" : ""
                } · ${groupCounts.invoices} invoice${
                  groupCounts.invoices !== 1 ? "s" : ""
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
          <MassUploadHeader title={title} description={description} />

          <ScrollArea className="flex-1 pr-3">
            <Card className="border-0 shadow-none">
              <CardHeader className="px-0 pt-0">
                <CardTitle className="sr-only">Upload</CardTitle>
                <CardDescription className="sr-only">{description}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6 px-0">
                <MassUploadInstructionsPanel
                  showInstructionsInput={showInstructionsInput}
                  onToggleInstructions={() =>
                    setShowInstructionsInput(!showInstructionsInput)
                  }
                  userInstructions={userInstructions}
                  onUserInstructionsChange={setUserInstructions}
                  isProcessing={isProcessing}
                />

                {/* Overall progress */}
                {documents.length > 0 && (
                  <MassUploadProgressSummary
                    completedCount={statusCounts.completed}
                    documentCount={documents.length}
                    overallProgress={overallProgress}
                    errorCount={statusCounts.error}
                    processingCount={statusCounts.processing}
                  />
                )}

                <MassUploadDropZone
                  isDragging={isDragging}
                  isProcessing={isProcessing}
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                  onFileSelect={handleFileSelect}
                />

                {documents.length > 0 && (
                  <MassUploadQueueList
                    documents={documents}
                    isProcessing={isProcessing}
                    errorCount={statusCounts.error}
                    onRetryFailed={retryFailed}
                    onAnswerDocument={(doc) => {
                      setCurrentQuestionDoc(doc)
                      setCurrentAnswers(doc.answers || {})
                      setQuestionDialogOpen(true)
                    }}
                    onRemoveDocument={removeDocument}
                  />
                )}
              </CardContent>
            </Card>
          </ScrollArea>

          <MassUploadFooter
            isProcessing={isProcessing}
            step={step}
            completedCount={statusCounts.completed}
            pendingCount={statusCounts.pending}
            documentCount={documents.length}
            onCancel={() => onOpenChange(false)}
            onComplete={handleComplete}
            onProcessAll={processAllDocuments}
          />
        </DialogContent>
      </Dialog>

      <MassUploadQuestionDialog
        open={questionDialogOpen}
        onOpenChange={setQuestionDialogOpen}
        doc={currentQuestionDoc}
        answers={currentAnswers}
        onAnswersChange={setCurrentAnswers}
        onSkip={handleSkipQuestions}
        onSubmit={handleSubmitAnswers}
      />
    </>
  )
}
