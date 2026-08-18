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
import { CounterProposeDialog } from "@/components/contracts/counter-propose-dialog"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { ProposedPricingDiff } from "@/components/contracts/proposed-pricing-diff"
import {
  extractProposedDocuments,
  extractProposedPricingItems,
} from "@/lib/contracts/proposed-pricing"
import { ProposalDocumentsList } from "@/components/contracts/proposal-documents-list"
import { queryKeys } from "@/lib/query-keys"

interface ProposedFieldChange {
  field: string
  currentValue: string
  proposedValue: string
}

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
    queryKey: queryKeys.contracts.proposals(contractId),
    queryFn: () => getPendingProposalsForContract(contractId),
  })

  const invalidate = () =>
    qc.invalidateQueries({
      queryKey: queryKeys.contracts.proposals(contractId),
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
  const [counterProposalId, setCounterProposalId] = useState<string | null>(
    null,
  )

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
          // `proposedTerms ?? changes` used to HIDE the field changes whenever a
          // structured payload existed. They are different things — render both.
          const fieldChanges = Array.isArray(p.changes)
            ? (p.changes as unknown as ProposedFieldChange[])
            : []
          const pricingItems = extractProposedPricingItems(p.proposedTerms)
          const documents = extractProposedDocuments(p.proposedTerms)
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
              {fieldChanges.length > 0 && (
                <div className="overflow-x-auto rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Field</TableHead>
                        <TableHead>Current</TableHead>
                        <TableHead>Proposed</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {fieldChanges.map((c, i) => (
                        <TableRow key={`${c.field}-${i}`}>
                          <TableCell className="text-xs font-medium">
                            {c.field || "—"}
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {c.currentValue || "—"}
                          </TableCell>
                          <TableCell className="text-xs">
                            {c.proposedValue || "—"}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}

              <ProposedPricingDiff
                contractId={contractId}
                items={pricingItems}
              />

              <ProposalDocumentsList documents={documents} />

              {fieldChanges.length === 0 &&
                pricingItems.length === 0 &&
                documents.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  This proposal carries no field changes, pricing, or documents.
                </p>
              )}
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
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setCounterProposalId(p.id)}
                >
                  Counter-Propose
                </Button>
              </div>
            </div>
          )
        })}
      </CardContent>
      <CounterProposeDialog
        open={counterProposalId !== null}
        onOpenChange={(next) => {
          if (!next) setCounterProposalId(null)
        }}
        proposalId={counterProposalId}
        contractId={contractId}
      />
    </Card>
  )
}
