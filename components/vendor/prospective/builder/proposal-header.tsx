import { Badge } from "@/components/ui/badge"

export interface ProposalHeaderProps {
  editingProposalId?: string | null
}

export function ProposalHeader({ editingProposalId }: ProposalHeaderProps) {
  return (
    <div className="flex items-center justify-between mb-6">
      <div>
        <h2 className="text-xl font-semibold flex items-center gap-2">
          {editingProposalId ? "Edit Proposal" : "New Contract Proposal"}
          <Badge variant="outline" className="font-normal text-xs">Internal Analysis</Badge>
        </h2>
        <p className="text-sm text-muted-foreground">
          {editingProposalId ? "Update proposal details for internal deal analysis" : "Create a new proposal for internal deal analysis"}
        </p>
      </div>
    </div>
  )
}
