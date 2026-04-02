import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import type { NewProposalState } from "./types"

export interface ContractParametersProps {
  newProposal: NewProposalState
  setNewProposal: React.Dispatch<React.SetStateAction<NewProposalState>>
}

export function ContractParameters({ newProposal, setNewProposal }: ContractParametersProps) {
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="space-y-2">
          <Label>Contract Length (months)</Label>
          <Input
            type="number"
            value={newProposal.contractLength}
            onChange={(e) => setNewProposal(prev => ({ ...prev, contractLength: parseInt(e.target.value) || 0 }))}
          />
        </div>
        <div className="space-y-2">
          <Label>Projected Annual Spend</Label>
          <Input
            type="number"
            value={newProposal.projectedSpend}
            onChange={(e) => setNewProposal(prev => ({ ...prev, projectedSpend: parseInt(e.target.value) || 0 }))}
          />
        </div>
        <div className="space-y-2">
          <Label>Projected Annual Volume</Label>
          <Input
            type="number"
            value={newProposal.projectedVolume}
            onChange={(e) => setNewProposal(prev => ({ ...prev, projectedVolume: parseInt(e.target.value) || 0 }))}
          />
        </div>
      </div>

      {/* Deal Parameters */}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label>Market Share Commitment (%)</Label>
          <Input
            type="number"
            value={newProposal.marketShareCommitment}
            onChange={(e) => setNewProposal(prev => ({ ...prev, marketShareCommitment: parseInt(e.target.value) || 0 }))}
          />
        </div>
        <div className="space-y-2">
          <Label>GPO Admin Fee (%)</Label>
          <Input
            type="number"
            step="0.5"
            value={newProposal.gpoFee}
            onChange={(e) => setNewProposal(prev => ({ ...prev, gpoFee: parseFloat(e.target.value) || 0 }))}
          />
        </div>
      </div>
    </>
  )
}
