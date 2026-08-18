"use client"

import { useState } from "react"
import { FileText, Download, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { toast } from "sonner"
import { getDownloadUrlSafe } from "@/lib/actions/uploads"
import type { ProposedDocumentInput } from "@/lib/validators/change-proposals"

/**
 * Documents attached to a change proposal — typically the amendment PDF the AI
 * read to produce the diff.
 *
 * Downloads re-authorize through `assertKeyVisibleToUser`, which scopes
 * proposal attachments to BOTH parties: the vendor who attached it and the
 * facility reviewing it. Nothing here is trusted to grant access.
 */
export function ProposalDocumentsList({
  documents,
}: {
  documents: ProposedDocumentInput[]
}) {
  const [busy, setBusy] = useState<string | null>(null)

  if (documents.length === 0) return null

  async function download(doc: ProposedDocumentInput) {
    setBusy(doc.url)
    try {
      const res = await getDownloadUrlSafe(doc.url, doc.name)
      if (!res.ok) throw new Error(res.error)
      window.location.assign(res.data)
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Could not open that document",
      )
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="space-y-1">
      <p className="text-xs font-medium">Attached documents</p>
      <div className="flex flex-col gap-1">
        {documents.map((doc) => (
          <div
            key={doc.url}
            className="flex items-center justify-between gap-3 rounded-md border px-2 py-1.5"
          >
            <span className="flex min-w-0 items-center gap-2">
              <FileText className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="truncate text-xs">{doc.name}</span>
            </span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 gap-1 text-xs"
              disabled={busy === doc.url}
              onClick={() => void download(doc)}
            >
              {busy === doc.url ? (
                <Loader2 className="size-3 animate-spin" />
              ) : (
                <Download className="size-3" />
              )}
              Open
            </Button>
          </div>
        ))}
      </div>
    </div>
  )
}
