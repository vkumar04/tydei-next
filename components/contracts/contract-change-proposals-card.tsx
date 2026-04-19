"use client"

import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Textarea } from "@/components/ui/textarea"

import {
  getPendingProposalsForContract,
  approveContractChangeProposal,
  rejectContractChangeProposal,
  requestProposalRevision,
} from "@/lib/actions/contracts/proposals"

type ProposalRow = Awaited<
  ReturnType<typeof getPendingProposalsForContract>
>[number]

interface NotesMutationInput {
  id: string
  notes: string
}

interface ContractChangeProposalsCardProps {
  contractId: string
}

export function ContractChangeProposalsCard({
  contractId,
}: ContractChangeProposalsCardProps) {
  const qc = useQueryClient()
  const { data: proposals } = useQuery({
    queryKey: ["contracts", "proposals", contractId] as const,
    queryFn: () => getPendingProposalsForContract(contractId),
  })

  const invalidate = () =>
    qc.invalidateQueries({
      queryKey: ["contracts", "proposals", contractId],
    })

  const approve = useMutation({
    mutationFn: (id: string) => approveContractChangeProposal(id),
    onSuccess: () => {
      toast.success("Proposal approved")
      invalidate()
    },
    onError: (err: unknown) => {
      toast.error(err instanceof Error ? err.message : "Approval failed")
    },
  })

  const reject = useMutation({
    mutationFn: ({ id, notes }: NotesMutationInput) =>
      rejectContractChangeProposal(id, notes),
    onSuccess: () => {
      toast.success("Proposal rejected")
      invalidate()
    },
    onError: (err: unknown) => {
      toast.error(err instanceof Error ? err.message : "Rejection failed")
    },
  })

  const revise = useMutation({
    mutationFn: ({ id, notes }: NotesMutationInput) =>
      requestProposalRevision(id, notes),
    onSuccess: () => {
      toast.success("Revision requested")
      invalidate()
    },
    onError: (err: unknown) => {
      toast.error(err instanceof Error ? err.message : "Request failed")
    },
  })

  const [notes, setNotes] = useState<Record<string, string>>({})

  if (!proposals || proposals.length === 0) return null

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          Pending Vendor Proposals
          <Badge>{proposals.length}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {proposals.map((p: ProposalRow) => {
          const payload = p.proposedTerms ?? p.changes
          const currentNote = notes[p.id] ?? ""
          return (
            <div key={p.id} className="space-y-2 rounded-md border p-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium">
                  {p.vendorName ?? "Vendor"} proposed
                  <span className="ml-2 text-xs font-normal text-muted-foreground capitalize">
                    {String(p.proposalType).replace(/_/g, " ")}
                  </span>
                </p>
                <span className="text-xs text-muted-foreground">
                  {new Date(p.submittedAt).toLocaleDateString()}
                </span>
              </div>
              {p.vendorMessage ? (
                <p className="text-xs text-muted-foreground whitespace-pre-wrap">
                  {p.vendorMessage}
                </p>
              ) : null}
              <pre className="rounded-md bg-muted p-2 text-xs overflow-x-auto">
                {JSON.stringify(payload, null, 2)}
              </pre>
              <Textarea
                placeholder="Notes (required for reject / revision)"
                value={currentNote}
                onChange={(e) =>
                  setNotes({ ...notes, [p.id]: e.target.value })
                }
                rows={2}
              />
              <div className="flex gap-2">
                <Button
                  size="sm"
                  onClick={() => approve.mutate(p.id)}
                  disabled={approve.isPending}
                >
                  Approve
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    revise.mutate({ id: p.id, notes: currentNote })
                  }
                  disabled={revise.isPending || currentNote.trim().length === 0}
                >
                  Request revision
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    reject.mutate({ id: p.id, notes: currentNote })
                  }
                  disabled={reject.isPending || currentNote.trim().length === 0}
                >
                  Reject
                </Button>
              </div>
            </div>
          )
        })}
      </CardContent>
    </Card>
  )
}
