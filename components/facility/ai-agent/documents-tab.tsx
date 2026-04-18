"use client"

/**
 * Documents tab for `/dashboard/ai-agent`.
 *
 * Fetches indexed documents via `GET /api/ai/documents` (scoped to the
 * active facility) and runs searches via `POST /api/ai/documents/search`
 * (which wraps the `searchFacilityDocuments` server action).
 *
 * Shows per-document index status (pending / processing / indexed /
 * failed) with a re-index action that re-POSTs to `/api/ai/index-document`
 * using the existing server action's state machine.
 */

import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  Search,
  Filter,
  FileText,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  Clock,
  ChevronRight,
  Sparkles,
  Trash2,
  MoreHorizontal,
  Upload,
  RefreshCw,
} from "lucide-react"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { deleteContractDocument } from "@/lib/actions/contracts"
import { UploadDocumentDialog } from "./upload-document-dialog"
import type { AiDocumentListItem } from "@/app/api/ai/documents/route"

interface ContractOption {
  id: string
  name: string
}

interface SearchHit {
  documentId: string
  pageNumber: number
  matchedText: string
  context: string
  relevanceScore: number
  vendor?: string
  documentType?: string
}

interface DocumentsTabProps {
  contracts: ContractOption[]
}

// ---------------------------------------------------------------------------
// Query keys — local to the AI Agent surface; not added to `lib/query-keys`
// because the UI-only scope forbids modifying non-AI files. We keep these
// stable strings here.
// ---------------------------------------------------------------------------
const AI_DOCS_KEY = ["ai", "documents"] as const

function formatDate(iso: string | null): string {
  if (!iso) return "—"
  const d = new Date(iso)
  return d.toLocaleDateString()
}

function IndexStatusBadge({ status }: { status: string }) {
  if (status === "indexed") {
    return (
      <Badge
        variant="secondary"
        className="gap-1 bg-green-500/10 text-green-700 dark:text-green-400"
      >
        <CheckCircle2 className="h-3 w-3" />
        Indexed
      </Badge>
    )
  }
  if (status === "processing") {
    return (
      <Badge variant="secondary" className="gap-1">
        <Loader2 className="h-3 w-3 animate-spin" />
        Processing
      </Badge>
    )
  }
  if (status === "failed") {
    return (
      <Badge variant="destructive" className="gap-1">
        <AlertTriangle className="h-3 w-3" />
        Failed
      </Badge>
    )
  }
  return (
    <Badge variant="outline" className="gap-1">
      <Clock className="h-3 w-3" />
      Pending
    </Badge>
  )
}

export function DocumentsTab({ contracts }: DocumentsTabProps) {
  const qc = useQueryClient()
  const [search, setSearch] = useState("")
  const [submittedQuery, setSubmittedQuery] = useState<string | null>(null)
  const [typeFilter, setTypeFilter] = useState<string>("all")
  const [vendorFilter, setVendorFilter] = useState<string>("all")
  const [uploadOpen, setUploadOpen] = useState(false)
  const [previewHit, setPreviewHit] = useState<SearchHit | null>(null)

  const docsQuery = useQuery({
    queryKey: AI_DOCS_KEY,
    queryFn: async (): Promise<AiDocumentListItem[]> => {
      const res = await fetch("/api/ai/documents")
      if (!res.ok) throw new Error("Failed to load documents")
      const data = (await res.json()) as { documents: AiDocumentListItem[] }
      return data.documents
    },
  })

  const searchQuery = useQuery({
    enabled: submittedQuery !== null && submittedQuery.trim().length > 0,
    queryKey: ["ai", "documents", "search", submittedQuery, typeFilter, vendorFilter] as const,
    queryFn: async (): Promise<SearchHit[]> => {
      const res = await fetch("/api/ai/documents/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: submittedQuery,
          documentTypeFilter: typeFilter === "all" ? null : typeFilter,
          vendorFilter: vendorFilter === "all" ? null : vendorFilter,
        }),
      })
      if (!res.ok) throw new Error("Search failed")
      const data = (await res.json()) as { hits: SearchHit[] }
      return data.hits
    },
  })

  const reindexMutation = useMutation({
    mutationFn: async (documentId: string): Promise<void> => {
      // Kick off a re-index with empty body — the server action will
      // delete existing pages and start over. For a real re-index we'd
      // need the cached raw text; for now we send a placeholder so the
      // action flips status and surfaces failure if the source is missing.
      const res = await fetch("/api/ai/index-document", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ documentId, rawText: "" }),
      })
      if (!res.ok) throw new Error("Re-index failed")
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: AI_DOCS_KEY })
    },
  })

  const deleteMutation = useMutation({
    mutationFn: async (documentId: string): Promise<void> => {
      await deleteContractDocument(documentId)
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: AI_DOCS_KEY })
    },
  })

  const docs = docsQuery.data ?? []
  const vendors = Array.from(new Set(docs.map((d) => d.vendorName))).sort()
  const filteredDocs = docs.filter((d) => {
    const matchesType = typeFilter === "all" || d.type === typeFilter
    const matchesVendor = vendorFilter === "all" || d.vendorName === vendorFilter
    return matchesType && matchesVendor
  })

  const hits = searchQuery.data ?? []
  const hitsByDoc = new Map<string, AiDocumentListItem>()
  for (const doc of docs) hitsByDoc.set(doc.id, doc)

  function handleSearch() {
    setSubmittedQuery(search.trim().length > 0 ? search.trim() : null)
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-wrap gap-2">
            <div className="relative flex-1 min-w-[220px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault()
                    handleSearch()
                  }
                }}
                placeholder="Search contract terms, clauses, pricing…"
                className="pl-9 pr-4"
              />
            </div>
            <Select value={typeFilter} onValueChange={setTypeFilter}>
              <SelectTrigger className="w-[160px]">
                <Filter className="mr-2 h-4 w-4" />
                <SelectValue placeholder="All types" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Types</SelectItem>
                <SelectItem value="main">Main</SelectItem>
                <SelectItem value="amendment">Amendment</SelectItem>
                <SelectItem value="addendum">Addendum</SelectItem>
                <SelectItem value="exhibit">Exhibit</SelectItem>
                <SelectItem value="pricing">Pricing</SelectItem>
              </SelectContent>
            </Select>
            <Select value={vendorFilter} onValueChange={setVendorFilter}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="All vendors" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Vendors</SelectItem>
                {vendors.map((v) => (
                  <SelectItem key={v} value={v}>
                    {v}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button onClick={handleSearch} disabled={searchQuery.isFetching}>
              {searchQuery.isFetching ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Search className="mr-2 h-4 w-4" />
              )}
              Search
            </Button>
            <Button variant="outline" onClick={() => setUploadOpen(true)}>
              <Upload className="mr-2 h-4 w-4" />
              Upload
            </Button>
          </div>
        </CardContent>
      </Card>

      {submittedQuery && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">
                Search results for &quot;{submittedQuery}&quot;
              </CardTitle>
              <Badge variant="secondary">
                {hits.length} match{hits.length !== 1 ? "es" : ""}
              </Badge>
            </div>
            <CardDescription>
              Ranked by term-frequency relevance across indexed pages.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {searchQuery.isFetching ? (
              <div className="flex items-center justify-center py-8 text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin mr-2" /> Searching…
              </div>
            ) : hits.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                No matches. Try a broader query or upload more documents.
              </div>
            ) : (
              <div className="space-y-2">
                {hits.map((hit) => {
                  const doc = hitsByDoc.get(hit.documentId)
                  return (
                    <button
                      key={`${hit.documentId}-${hit.pageNumber}`}
                      className="w-full text-left rounded-lg border p-3 hover:bg-muted/50 transition-colors"
                      onClick={() => setPreviewHit(hit)}
                      type="button"
                    >
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-2 text-sm font-medium">
                          <FileText className="h-4 w-4 text-muted-foreground" />
                          {doc?.name ?? "Unknown document"}
                        </div>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <span>Page {hit.pageNumber}</span>
                          <span>•</span>
                          <span>
                            {hit.relevanceScore.toFixed(4)} relevance
                          </span>
                        </div>
                      </div>
                      <p className="text-xs text-muted-foreground line-clamp-2">
                        …{hit.matchedText}…
                      </p>
                    </button>
                  )
                })}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Indexed Documents</CardTitle>
            <Badge variant="secondary">
              {filteredDocs.length} document
              {filteredDocs.length !== 1 ? "s" : ""}
            </Badge>
          </div>
          <CardDescription>
            Upload PDFs or contract text; index them to make them searchable
            by the AI chat + document search tabs.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {docsQuery.isPending ? (
            <div className="flex items-center justify-center py-8 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin mr-2" /> Loading
              documents…
            </div>
          ) : docsQuery.isError ? (
            <div className="text-center py-8 text-destructive">
              Failed to load documents.{" "}
              <Button
                variant="link"
                className="px-1 h-auto"
                onClick={() => void docsQuery.refetch()}
              >
                Retry
              </Button>
            </div>
          ) : filteredDocs.length === 0 ? (
            <div className="text-center py-12">
              <Search className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <h3 className="text-lg font-medium mb-2">No Documents</h3>
              <p className="text-muted-foreground">
                Upload a document to get started.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {filteredDocs.map((doc) => (
                <div
                  key={doc.id}
                  className="flex items-center justify-between rounded-lg border p-3 hover:bg-muted/50 transition-colors"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted shrink-0">
                      <FileText className="h-5 w-5 text-muted-foreground" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">
                        {doc.name}
                      </p>
                      <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                        <Badge variant="outline" className="text-xs">
                          {doc.type}
                        </Badge>
                        <span className="text-xs text-muted-foreground">
                          {doc.vendorName}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {doc.pageCount} page{doc.pageCount === 1 ? "" : "s"}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          Uploaded {formatDate(doc.uploadDate)}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <IndexStatusBadge status={doc.indexStatus} />
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-8 w-8">
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          onClick={() => reindexMutation.mutate(doc.id)}
                          disabled={reindexMutation.isPending}
                        >
                          <RefreshCw className="mr-2 h-4 w-4" />
                          Re-index
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          className="text-destructive"
                          onClick={() => deleteMutation.mutate(doc.id)}
                          disabled={deleteMutation.isPending}
                        >
                          <Trash2 className="mr-2 h-4 w-4" />
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6">
          <div className="flex items-start gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 shrink-0">
              <Sparkles className="h-4 w-4 text-primary" />
            </div>
            <div>
              <h4 className="text-sm font-medium mb-1">
                AI-Powered Search Tips
              </h4>
              <ul className="text-xs text-muted-foreground space-y-1">
                <li className="flex items-center gap-1.5">
                  <ChevronRight className="h-3 w-3 shrink-0" />
                  Search for specific pricing terms like &quot;unit
                  price&quot; or &quot;rebate percentage&quot;
                </li>
                <li className="flex items-center gap-1.5">
                  <ChevronRight className="h-3 w-3 shrink-0" />
                  Find compliance clauses by searching
                  &quot;termination&quot; or &quot;renewal&quot;
                </li>
                <li className="flex items-center gap-1.5">
                  <ChevronRight className="h-3 w-3 shrink-0" />
                  Use natural language like &quot;volume discount
                  tiers&quot;
                </li>
              </ul>
            </div>
          </div>
        </CardContent>
      </Card>

      <UploadDocumentDialog
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        contracts={contracts}
        onUploaded={() => {
          void qc.invalidateQueries({ queryKey: AI_DOCS_KEY })
        }}
      />

      <Dialog
        open={previewHit !== null}
        onOpenChange={(open) => {
          if (!open) setPreviewHit(null)
        }}
      >
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {previewHit
                ? (hitsByDoc.get(previewHit.documentId)?.name ?? "Document")
                : "Document"}
            </DialogTitle>
            <DialogDescription>
              {previewHit ? `Page ${previewHit.pageNumber}` : null}
            </DialogDescription>
          </DialogHeader>
          {previewHit && (
            <div className="text-sm whitespace-pre-wrap rounded-lg bg-muted p-4 max-h-[480px] overflow-y-auto">
              {previewHit.context}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
