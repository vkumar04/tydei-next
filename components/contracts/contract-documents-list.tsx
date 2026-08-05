"use client"

import { useState } from "react"
import type { ContractDocument } from "@/lib/generated/prisma/client"
import { Download, FileText, Loader2, Sparkles, Trash2, Upload } from "lucide-react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { deleteContractDocument } from "@/lib/actions/contracts"
import { getDownloadUrlSafe } from "@/lib/actions/uploads"
import { queryKeys } from "@/lib/query-keys"
import { formatDate } from "@/lib/formatting"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ConfirmDialog } from "@/components/shared/forms/confirm-dialog"

interface ContractDocumentsListProps {
  documents: ContractDocument[]
  contractId: string
  onUpload?: () => void
  /**
   * Re-index and Delete call facility-scoped actions (`requireFacility`) —
   * they always fail on the vendor portal, so vendor surfaces pass false to
   * hide them. Download works for both roles.
   */
  canManage?: boolean
}

export function ContractDocumentsList({
  documents,
  contractId,
  onUpload,
  canManage = true,
}: ContractDocumentsListProps) {
  const queryClient = useQueryClient()
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null)
  const [reindexingId, setReindexingId] = useState<string | null>(null)
  const [downloadingIds, setDownloadingIds] = useState<ReadonlySet<string>>(
    new Set(),
  )

  function markDownloading(id: string, on: boolean) {
    setDownloadingIds((prev) => {
      const next = new Set(prev)
      if (on) next.add(id)
      else next.delete(id)
      return next
    })
  }

  // `url` holds an S3 object key (see /api/upload) — it must be exchanged
  // for a presigned URL before the browser can fetch it, and the server
  // action enforces tenant visibility on every exchange. Rows holding an
  // absolute URL are NOT navigable: no writer legitimately stores one, and
  // pending-contract `documents` JSON is counterparty-supplied, so treating
  // such a row as a link would let a planted URL send users to an attacker's
  // origin dressed up as the contract PDF (stored phishing).
  function isDownloadable(doc: ContractDocument): boolean {
    return !!doc.url && !/^[a-z][a-z0-9+.-]*:/i.test(doc.url)
  }

  // `downloadName` signs an attachment Content-Disposition so navigating to
  // the presigned URL saves the file and keeps the page.
  async function resolveFileUrl(
    doc: ContractDocument,
    opts?: { downloadName?: string },
  ): Promise<string | null> {
    if (!isDownloadable(doc)) return null
    const res = await getDownloadUrlSafe(doc.url!, opts?.downloadName)
    if (!res.ok) throw new Error(res.error)
    return res.data
  }

  async function handleDownload(doc: ContractDocument) {
    markDownloading(doc.id, true)
    try {
      const url = await resolveFileUrl(doc, { downloadName: doc.name })
      if (!url) {
        toast.error("No downloadable file is attached to this document")
        return
      }
      // The attachment disposition means this saves the file and keeps the
      // page — no popup, so Safari's post-await popup blocking never applies.
      window.location.assign(url)
    } catch (err) {
      toast.error(
        err instanceof Error && err.message
          ? `Could not download ${doc.name}: ${err.message}`
          : `Could not download ${doc.name}`,
      )
    } finally {
      markDownloading(doc.id, false)
    }
  }

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteContractDocument(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.contracts.detail(contractId) })
      queryClient.invalidateQueries({ queryKey: queryKeys.contracts.all })
      toast.success("Document deleted")
    },
    onError: (err) => toast.error(err.message || "Failed to delete document"),
  })

  async function handleReindex(doc: ContractDocument) {
    setReindexingId(doc.id)
    try {
      let rawText = ""
      try {
        // `doc.url` is an S3 key, not a fetchable path — resolve it to a
        // presigned URL first (fetching the bare key returned this app's own
        // 404 HTML, which then got indexed as the document text).
        const fileUrl = await resolveFileUrl(doc)
        if (fileUrl) {
          const fileRes = await fetch(fileUrl)
          if (fileRes.ok) {
            const buf = await fileRes.arrayBuffer()
            rawText = new TextDecoder("utf-8", { fatal: false }).decode(buf)
          }
        }
      } catch (err) {
        console.warn("[contract-documents-list] fetch doc url failed:", err)
      }

      const res = await fetch("/api/ai/index-document", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ documentId: doc.id, rawText }),
      })

      if (res.ok) {
        queryClient.invalidateQueries({ queryKey: queryKeys.contracts.detail(contractId) })
        toast.success("Indexed for AI search")
      } else {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        toast.error(body.error ?? "Re-index failed")
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Re-index failed")
    } finally {
      setReindexingId(null)
    }
  }

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle>Documents</CardTitle>
        {onUpload && (
          <Button variant="outline" size="sm" onClick={onUpload}>
            <Upload className="size-4" /> Upload
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {documents.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No documents uploaded yet
          </p>
        ) : (
          <div className="space-y-2">
            {documents.map((doc) => (
              <div
                key={doc.id}
                className="flex items-center justify-between rounded-md border p-3"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <FileText className="size-4 text-muted-foreground shrink-0" />
                  <div className="min-w-0">
                    {isDownloadable(doc) ? (
                      <button
                        type="button"
                        className="block max-w-full text-sm font-medium truncate text-left hover:underline"
                        onClick={() => void handleDownload(doc)}
                        disabled={downloadingIds.has(doc.id)}
                      >
                        {doc.name}
                      </button>
                    ) : (
                      <p className="text-sm font-medium truncate">{doc.name}</p>
                    )}
                    <p className="text-xs text-muted-foreground">
                      {formatDate(doc.uploadDate)}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Badge variant="outline" className="capitalize">
                    {doc.type}
                  </Badge>
                  {isDownloadable(doc) && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => void handleDownload(doc)}
                      disabled={downloadingIds.has(doc.id)}
                    >
                      {downloadingIds.has(doc.id) ? (
                        <Loader2 className="mr-2 h-3 w-3 animate-spin" />
                      ) : (
                        <Download className="mr-2 h-3 w-3" />
                      )}
                      Download
                    </Button>
                  )}
                  {canManage && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => void handleReindex(doc)}
                      disabled={reindexingId === doc.id}
                    >
                      {reindexingId === doc.id ? (
                        <Loader2 className="mr-2 h-3 w-3 animate-spin" />
                      ) : (
                        <Sparkles className="mr-2 h-3 w-3" />
                      )}
                      Re-index for AI
                    </Button>
                  )}
                  {canManage && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-muted-foreground hover:text-destructive"
                      onClick={() => setPendingDeleteId(doc.id)}
                      disabled={deleteMutation.isPending && pendingDeleteId === doc.id}
                    >
                      {deleteMutation.isPending && pendingDeleteId === doc.id ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <Trash2 className="size-4" />
                      )}
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>

      <ConfirmDialog
        open={!!pendingDeleteId}
        onOpenChange={(open) => {
          if (!open) setPendingDeleteId(null)
        }}
        title="Delete document?"
        description="This will permanently remove the document from this contract. This cannot be undone."
        variant="destructive"
        isLoading={deleteMutation.isPending}
        onConfirm={async () => {
          if (!pendingDeleteId) return
          await deleteMutation.mutateAsync(pendingDeleteId)
          setPendingDeleteId(null)
        }}
      />
    </Card>
  )
}
