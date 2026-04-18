"use client"

/**
 * Upload + index dialog for the AI Agent Documents tab.
 *
 * Flow:
 *   1. User picks a contract + file name + pastes/uploads raw text.
 *   2. Client creates a `ContractDocument` via `createContractDocument`
 *      (existing server action).
 *   3. Client POSTs the raw text to `/api/ai/index-document` which calls
 *      the `indexContractDocument` server action.
 *   4. Upload progress + indexed status are surfaced via badges.
 *
 * No schema changes. No edits to `lib/actions/ai/*`. The real PDF → text
 * extraction pipeline is out of scope for the UI layer; for now the
 * dialog accepts a plain-text paste *or* a text file. A real PDF can be
 * dropped in and we pass its text content through (the server action
 * already knows how to split by form-feed).
 */

import { useState, type ChangeEvent, type FormEvent } from "react"
import { Loader2, Upload, FileText } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Checkbox } from "@/components/ui/checkbox"
import { createContractDocument } from "@/lib/actions/contracts"

type UploadStage = "idle" | "creating" | "indexing" | "done"

interface ContractOption {
  id: string
  name: string
}

interface UploadDocumentDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  contracts: ContractOption[]
  onUploaded: () => void
}

const DOCUMENT_TYPES: Array<{ value: string; label: string }> = [
  { value: "main", label: "Main Contract" },
  { value: "amendment", label: "Amendment" },
  { value: "addendum", label: "Addendum" },
  { value: "exhibit", label: "Exhibit" },
  { value: "pricing", label: "Pricing Schedule" },
]

async function readFileAsText(file: File): Promise<string> {
  if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) {
    // Browsers can't reliably extract text from PDFs without a library.
    // For the UI surface we stream the raw bytes as a UTF-8 string —
    // the document-index action normalizes + splits whatever text it
    // receives. A proper PDF-to-text pipeline is flagged in the spec as
    // a follow-up (subsystem 2 depends on an OCR upstream).
    const buf = await file.arrayBuffer()
    return new TextDecoder("utf-8", { fatal: false }).decode(buf)
  }
  return await file.text()
}

export function UploadDocumentDialog({
  open,
  onOpenChange,
  contracts,
  onUploaded,
}: UploadDocumentDialogProps) {
  const [contractId, setContractId] = useState("")
  const [docType, setDocType] = useState("main")
  const [name, setName] = useState("")
  const [rawText, setRawText] = useState("")
  const [file, setFile] = useState<File | null>(null)
  const [indexForAi, setIndexForAi] = useState(true)
  const [stage, setStage] = useState<UploadStage>("idle")
  const [error, setError] = useState<string | null>(null)

  function reset() {
    setContractId("")
    setDocType("main")
    setName("")
    setRawText("")
    setFile(null)
    setIndexForAi(true)
    setStage("idle")
    setError(null)
  }

  async function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null
    setFile(f)
    if (f && !name) {
      setName(f.name.replace(/\.[^.]+$/, ""))
    }
    if (f) {
      try {
        const text = await readFileAsText(f)
        setRawText(text)
      } catch (err) {
        console.warn("[upload-dialog] readFileAsText failed:", err)
      }
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!contractId || !name.trim()) {
      setError("Contract and document name are required.")
      return
    }
    setError(null)
    setStage("creating")
    try {
      const doc = await createContractDocument({
        contractId,
        name: name.trim(),
        type: docType,
      })

      if (indexForAi && rawText.trim().length > 0) {
        setStage("indexing")
        const res = await fetch("/api/ai/index-document", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ documentId: doc.id, rawText }),
        })
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string }
          throw new Error(body.error ?? `Indexing failed (${res.status})`)
        }
      }

      setStage("done")
      onUploaded()
      reset()
      onOpenChange(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed")
      setStage("idle")
    }
  }

  const busy = stage === "creating" || stage === "indexing"

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !busy) reset()
        onOpenChange(next)
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Upload Document</DialogTitle>
          <DialogDescription>
            Upload a contract, amendment, or pricing file. Optionally index it
            so the AI chat + document search surfaces can answer questions
            about it.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="upload-contract">Contract</Label>
            <Select value={contractId} onValueChange={setContractId}>
              <SelectTrigger id="upload-contract">
                <SelectValue placeholder="Pick a contract" />
              </SelectTrigger>
              <SelectContent>
                {contracts.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="upload-name">Document name</Label>
            <Input
              id="upload-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Stryker Joint Replacement Agreement"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="upload-type">Type</Label>
            <Select value={docType} onValueChange={setDocType}>
              <SelectTrigger id="upload-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DOCUMENT_TYPES.map((t) => (
                  <SelectItem key={t.value} value={t.value}>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="upload-file">File</Label>
            <div className="flex items-center gap-2">
              <Input
                id="upload-file"
                type="file"
                accept=".pdf,.txt,.md"
                onChange={(e) => void handleFileChange(e)}
              />
            </div>
            {file && (
              <div className="text-xs text-muted-foreground flex items-center gap-1">
                <FileText className="h-3 w-3" />
                {file.name} ({Math.ceil(file.size / 1024)} KB)
              </div>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="upload-raw-text">
              Extracted text{" "}
              <span className="text-muted-foreground">
                (optional — paste contract text for AI indexing)
              </span>
            </Label>
            <Textarea
              id="upload-raw-text"
              value={rawText}
              onChange={(e) => setRawText(e.target.value)}
              placeholder="Paste contract text here. Use form-feed characters (U+000C) or <<<PAGE_BREAK>>> to mark page boundaries."
              rows={5}
            />
          </div>

          <div className="flex items-center gap-2">
            <Checkbox
              id="index-for-ai"
              checked={indexForAi}
              onCheckedChange={(v) => setIndexForAi(v === true)}
            />
            <Label htmlFor="index-for-ai" className="text-sm font-normal">
              Index for AI search
            </Label>
          </div>

          {error && (
            <div className="text-sm text-destructive">{error}</div>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={busy || !contractId || !name.trim()}>
              {busy ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {stage === "indexing" ? "Indexing…" : "Uploading…"}
                </>
              ) : (
                <>
                  <Upload className="mr-2 h-4 w-4" />
                  Upload
                </>
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
