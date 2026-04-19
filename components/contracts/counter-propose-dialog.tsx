"use client"

import { useEffect, useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"

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
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"

import { counterContractChangeProposal } from "@/lib/actions/contracts/proposals"
import { queryKeys } from "@/lib/query-keys"

export interface CounterProposeDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  proposalId: string | null
  contractId?: string
  facilityId?: string
  onSuccess?: () => void
}

/**
 * Facility-side dialog to submit a counter-proposal against a pending
 * `ContractChangeProposal`. Composes `counterTerms` (required, multi-line)
 * + optional `message` (one-line note) into the single `notes` string the
 * server action expects. See W1.3 (`counterContractChangeProposal`) and
 * W1.7 (this dialog).
 */
export function CounterProposeDialog({
  open,
  onOpenChange,
  proposalId,
  contractId,
  facilityId,
  onSuccess,
}: CounterProposeDialogProps) {
  const qc = useQueryClient()
  const [counterTerms, setCounterTerms] = useState("")
  const [message, setMessage] = useState("")

  // Reset form whenever the dialog closes so reopening is a clean slate.
  useEffect(() => {
    if (!open) {
      setCounterTerms("")
      setMessage("")
    }
  }, [open])

  const mutation = useMutation({
    mutationFn: async ({ id, notes }: { id: string; notes: string }) => {
      await counterContractChangeProposal(id, notes)
    },
    onSuccess: () => {
      toast.success("Counter-proposal sent")
      // Proposals list query (contract-change-proposals-card).
      if (contractId) {
        qc.invalidateQueries({
          queryKey: ["contracts", "proposals", contractId],
        })
        qc.invalidateQueries({
          queryKey: queryKeys.contracts.detail(contractId),
        })
        qc.invalidateQueries({
          queryKey: queryKeys.changeProposals.byContract(contractId),
        })
      }
      if (facilityId) {
        qc.invalidateQueries({
          queryKey: queryKeys.changeProposals.pendingForFacility(facilityId),
        })
      }
      onOpenChange(false)
      onSuccess?.()
    },
    onError: (err: unknown) => {
      toast.error(
        err instanceof Error ? err.message : "Counter-proposal failed",
      )
    },
  })

  const trimmedTerms = counterTerms.trim()
  const trimmedMessage = message.trim()
  // Server action requires notes ≥ 10 chars (see
  // lib/actions/contracts/proposals.ts). Enforce client-side too.
  const combinedNotes = trimmedMessage
    ? `${trimmedTerms}\n\n${trimmedMessage}`
    : trimmedTerms
  const canSubmit =
    !!proposalId && combinedNotes.length >= 10 && !mutation.isPending

  function handleSubmit() {
    if (!proposalId || !canSubmit) return
    mutation.mutate({ id: proposalId, notes: combinedNotes })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Counter-Propose Terms</DialogTitle>
          <DialogDescription>
            Reply to this proposal with alternative terms. The vendor will
            be notified.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="counter-terms">
              Counter terms <span className="text-destructive">*</span>
            </Label>
            <Textarea
              id="counter-terms"
              placeholder="Describe the terms you're proposing instead..."
              value={counterTerms}
              onChange={(e) => setCounterTerms(e.target.value)}
              rows={4}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="counter-message">Message (optional)</Label>
            <Input
              id="counter-message"
              placeholder="Short note to the vendor"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={mutation.isPending}
          >
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={!canSubmit}>
            {mutation.isPending ? "Sending..." : "Send counter-proposal"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
