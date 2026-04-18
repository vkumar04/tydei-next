"use client"

import { useState } from "react"
import type { ContractDocument } from "@prisma/client"
import { FileText, Loader2, Sparkles, Trash2, Upload } from "lucide-react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { deleteContractDocument } from "@/lib/actions/contracts"
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
}

export function ContractDocumentsList({
  documents,
  contractId,
  onUpload,
}: ContractDocumentsListProps) {
  const queryClient = useQueryClient()
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null)
  const [reindexingId, setReindexingId] = useState<string | null>(null)

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
      if (doc.url) {
        try {
          const fileRes = await fetch(doc.url)
          if (fileRes.ok) {
            const buf = await fileRes.arrayBuffer()
            rawText = new TextDecoder("utf-8", { fatal: false }).decode(buf)
          }
        } catch (err) {
          console.warn("[contract-documents-list] fetch doc url failed:", err)
        }
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
                    <p className="text-sm font-medium truncate">{doc.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatDate(doc.uploadDate)}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Badge variant="outline" className="capitalize">
                    {doc.type}
                  </Badge>
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
