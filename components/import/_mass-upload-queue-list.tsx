"use client"

import { FileTextIcon, RotateCcwIcon, XIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Label } from "@/components/ui/label"
import { renderStatusBadge } from "./_mass-upload-status-badge"
import { DOCUMENT_TYPE_INFO } from "./_mass-upload-doc-type-info"
import type { QueuedDocument } from "./_mass-upload-types"

interface MassUploadQueueListProps {
  documents: QueuedDocument[]
  isProcessing: boolean
  errorCount: number
  onRetryFailed: () => void
  onAnswerDocument: (doc: QueuedDocument) => void
  onRemoveDocument: (id: string) => void
}

/**
 * The document queue rows. Rows are keyed by the stable doc.id — never the
 * array index — so removing a row can't reuse another row's UI state.
 */
export function MassUploadQueueList({
  documents,
  isProcessing,
  errorCount,
  onRetryFailed,
  onAnswerDocument,
  onRemoveDocument,
}: MassUploadQueueListProps) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Label>Document Queue ({documents.length})</Label>
        {!isProcessing && errorCount > 0 && (
          <Button
            variant="outline"
            size="sm"
            onClick={onRetryFailed}
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
                    onClick={() => onAnswerDocument(doc)}
                  >
                    Answer
                  </Button>
                )}

                {!isProcessing && doc.status !== "processing" && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => onRemoveDocument(doc.id)}
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
  )
}
