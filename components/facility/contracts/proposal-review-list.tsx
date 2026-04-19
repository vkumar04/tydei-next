"use client"

import { useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { Check, X, RotateCcw, MessageSquareReply } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Textarea } from "@/components/ui/textarea"
import { formatDate } from "@/lib/formatting"
import { reviewChangeProposal } from "@/lib/actions/change-proposals"
import { queryKeys } from "@/lib/query-keys"

interface Change {
  field: string
  currentValue: string
  proposedValue: string
}

interface Proposal {
  id: string
  contractName: string
  vendorName: string
  proposalType: string
  status: string
  changes: Change[]
  vendorMessage: string | null
  submittedAt: string
}

interface ProposalReviewListProps {
  proposals: Proposal[]
  facilityId: string
  userId: string
}

export function ProposalReviewList({ proposals, facilityId, userId }: ProposalReviewListProps) {
  const qc = useQueryClient()
  const [reviewingId, setReviewingId] = useState<string | null>(null)
  const [action, setAction] = useState<"approve" | "reject" | "revision_requested">("approve")
  const [notes, setNotes] = useState("")

  const reviewMut = useMutation({
    mutationFn: ({ id, act }: { id: string; act: typeof action }) =>
      reviewChangeProposal(id, { action: act, reviewedBy: userId, notes: notes || undefined }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.changeProposals.pendingForFacility(facilityId) })
      setReviewingId(null)
      setNotes("")
      toast.success("Proposal reviewed")
    },
  })

  if (proposals.length === 0) {
    return <p className="py-8 text-center text-sm text-muted-foreground">No pending proposals.</p>
  }

  return (
    <>
      <div className="space-y-4">
        {proposals.map((p) => {
          const changes = (Array.isArray(p.changes) ? p.changes : []) as Change[]
          return (
            <Card key={p.id}>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm">{p.contractName}</CardTitle>
                  <Badge variant="outline" className="capitalize">{p.proposalType.replace("_", " ")}</Badge>
                </div>
                <p className="text-xs text-muted-foreground">From {p.vendorName} on {formatDate(p.submittedAt)}</p>
              </CardHeader>
              <CardContent className="space-y-3">
                {changes.map((c, i) => (
                  <div key={i} className="grid grid-cols-3 gap-2 text-sm">
                    <span className="font-medium">{c.field}</span>
                    <span className="text-muted-foreground line-through">{c.currentValue}</span>
                    <span className="text-emerald-600">{c.proposedValue}</span>
                  </div>
                ))}
                {p.vendorMessage && <p className="text-sm italic text-muted-foreground">{p.vendorMessage}</p>}
                <div className="flex gap-2 pt-2">
                  <Button size="sm" onClick={() => { setReviewingId(p.id); setAction("approve") }}>
                    <Check className="size-3.5" /> Approve
                  </Button>
                  <Button size="sm" variant="destructive" onClick={() => { setReviewingId(p.id); setAction("reject") }}>
                    <X className="size-3.5" /> Reject
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => { setReviewingId(p.id); setAction("revision_requested") }}>
                    <RotateCcw className="size-3.5" /> Request Revision
                  </Button>
                  {/*
                    TODO(W1.3): enable Counter-Propose. The server action
                    (counterContractChangeProposal) and `countered` status
                    are wired; this button is stubbed until a counter-terms
                    dialog lands. reviewChangeProposal also accepts
                    "counter_propose" → "countered" in its statusMap.
                  */}
                  <Button size="sm" variant="outline" disabled title="Counter-propose: coming soon (W1.3 stub)">
                    <MessageSquareReply className="size-3.5" /> Counter-Propose
                  </Button>
                </div>
              </CardContent>
            </Card>
          )
        })}
      </div>

      <Dialog open={!!reviewingId} onOpenChange={() => setReviewingId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="capitalize">{action.replace("_", " ")} Proposal</DialogTitle>
          </DialogHeader>
          <Textarea placeholder="Notes (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setReviewingId(null)}>Cancel</Button>
            <Button
              variant={action === "reject" ? "destructive" : "default"}
              onClick={() => reviewingId && reviewMut.mutate({ id: reviewingId, act: action })}
              disabled={reviewMut.isPending}
            >
              Confirm
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
