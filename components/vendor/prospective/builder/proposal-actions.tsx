import { Button } from "@/components/ui/button"
import { Plus, Check, Loader2 } from "lucide-react"

export interface ProposalActionsProps {
  editingProposalId?: string | null
  isPending: boolean
  onCancel: () => void
  onSubmit: () => void
}

export function ProposalActions({
  editingProposalId,
  isPending,
  onCancel,
  onSubmit,
}: ProposalActionsProps) {
  return (
    <div className="flex justify-end gap-3">
      <Button variant="outline" onClick={onCancel}>
        Cancel
      </Button>
      <Button onClick={onSubmit} disabled={isPending}>
        {isPending ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Submitting...
          </>
        ) : editingProposalId ? (
          <>
            <Check className="mr-2 h-4 w-4" />
            Save Changes
          </>
        ) : (
          <>
            <Plus className="mr-2 h-4 w-4" />
            Save Proposal
          </>
        )}
      </Button>
    </div>
  )
}
