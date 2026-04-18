"use client"

/**
 * Renewal notes list + inline create form.
 *
 * Wires directly to the `listRenewalNotes` / `createRenewalNote` /
 * `deleteRenewalNote` server actions via TanStack Query. Mutations
 * invalidate the list query on success so the timeline re-renders.
 *
 * Notes are sorted newest-first on the server side (the action applies
 * `sortNotesNewestFirst`), so we render them in array order.
 */

import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { formatDistanceToNow } from "date-fns"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Trash2, MessageSquare, Loader2 } from "lucide-react"
import { toast } from "sonner"
import {
  listRenewalNotes,
  createRenewalNote,
  deleteRenewalNote,
} from "@/lib/actions/renewals/notes"

interface RenewalNotesSectionProps {
  contractId: string
  /** Current authenticated user id — used to show delete only on own notes. */
  currentUserId: string
}

const notesQueryKey = (contractId: string) =>
  ["renewals", "notes", contractId] as const

export function RenewalNotesSection({
  contractId,
  currentUserId,
}: RenewalNotesSectionProps) {
  const qc = useQueryClient()
  const [draft, setDraft] = useState("")

  const { data, isLoading, isError } = useQuery({
    queryKey: notesQueryKey(contractId),
    queryFn: () => listRenewalNotes(contractId),
    enabled: contractId.length > 0,
  })

  const createMutation = useMutation({
    mutationFn: (note: string) => createRenewalNote({ contractId, note }),
    onSuccess: () => {
      setDraft("")
      void qc.invalidateQueries({ queryKey: notesQueryKey(contractId) })
      toast.success("Note added")
    },
    onError: (err: unknown) => {
      const msg = err instanceof Error ? err.message : "Failed to add note"
      toast.error(msg)
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteRenewalNote(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: notesQueryKey(contractId) })
      toast.success("Note deleted")
    },
    onError: (err: unknown) => {
      const msg = err instanceof Error ? err.message : "Failed to delete note"
      toast.error(msg)
    },
  })

  const trimmed = draft.trim()
  const canSubmit = trimmed.length > 0 && !createMutation.isPending

  function handleSubmit() {
    if (!canSubmit) return
    createMutation.mutate(trimmed)
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Add a renewal note — negotiation touchpoints, action items, etc."
          rows={3}
          aria-label="New renewal note"
          disabled={createMutation.isPending}
        />
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">
            {trimmed.length}/5000
          </span>
          <Button
            size="sm"
            onClick={handleSubmit}
            disabled={!canSubmit}
          >
            {createMutation.isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Saving…
              </>
            ) : (
              "Add Note"
            )}
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
        </div>
      ) : isError ? (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
          Failed to load renewal notes.
        </div>
      ) : !data || data.length === 0 ? (
        <div className="flex items-center gap-2 rounded-md border border-dashed p-6 text-sm text-muted-foreground">
          <MessageSquare className="h-4 w-4" />
          No notes yet. Add the first one above.
        </div>
      ) : (
        <ul className="space-y-2">
          {data.map((n) => (
            <li key={n.id}>
              <Card>
                <CardContent className="flex items-start justify-between gap-3 p-4">
                  <div className="min-w-0 flex-1">
                    <p className="whitespace-pre-wrap text-sm">{n.note}</p>
                    <p className="mt-2 text-xs text-muted-foreground">
                      {formatDistanceToNow(new Date(n.createdAt), {
                        addSuffix: true,
                      })}
                    </p>
                  </div>
                  {n.authorId === currentUserId ? (
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label="Delete note"
                      disabled={deleteMutation.isPending}
                      onClick={() => deleteMutation.mutate(n.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  ) : null}
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
