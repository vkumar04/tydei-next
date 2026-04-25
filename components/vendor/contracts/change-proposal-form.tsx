"use client"

import { useState } from "react"
import { Plus, Trash2 } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Field } from "@/components/shared/forms/field"
import type { CreateChangeProposalInput } from "@/lib/validators/change-proposals"

interface Change {
  field: string
  currentValue: string
  proposedValue: string
}

/**
 * Charles 2026-04-25 audit re-pass: must mirror
 * `ALLOWED_CONTRACT_EDIT_FIELDS` in
 * `lib/actions/contracts/proposals.ts`. Free-text input previously
 * meant any typo silently dropped the change on approve.
 */
const CONTRACT_EDIT_FIELD_OPTIONS: ReadonlyArray<{
  value: string
  label: string
}> = [
  { value: "name", label: "Contract name" },
  { value: "vendorName", label: "Vendor name" },
  { value: "description", label: "Description" },
  { value: "totalValue", label: "Total value ($)" },
  { value: "effectiveDate", label: "Effective date" },
  { value: "expirationDate", label: "Expiration date" },
  { value: "notes", label: "Notes" },
  { value: "contractNumber", label: "Contract #" },
  { value: "annualValue", label: "Annual value ($)" },
  { value: "gpoAffiliation", label: "GPO affiliation" },
  { value: "performancePeriod", label: "Performance period" },
  { value: "rebatePayPeriod", label: "Rebate pay period" },
  { value: "autoRenewal", label: "Auto-renewal" },
  { value: "terminationNoticeDays", label: "Termination notice (days)" },
  { value: "capitalCost", label: "Capital cost ($)" },
  { value: "interestRate", label: "Interest rate" },
  { value: "termMonths", label: "Term (months)" },
  { value: "downPayment", label: "Down payment ($)" },
  { value: "paymentCadence", label: "Payment cadence" },
  { value: "amortizationShape", label: "Amortization shape" },
]

interface ChangeProposalFormProps {
  contract: { id: string; name: string; vendorId: string; vendorName: string; facilityId?: string; facilityName?: string }
  onSubmit: (proposal: CreateChangeProposalInput) => Promise<void>
}

export function ChangeProposalForm({ contract, onSubmit }: ChangeProposalFormProps) {
  const [proposalType, setProposalType] = useState<"term_change" | "new_term" | "remove_term" | "contract_edit">("term_change")
  const [changes, setChanges] = useState<Change[]>([{ field: "", currentValue: "", proposedValue: "" }])
  const [message, setMessage] = useState("")
  const [isSubmitting, setIsSubmitting] = useState(false)

  const addChange = () => setChanges([...changes, { field: "", currentValue: "", proposedValue: "" }])

  const updateChange = (index: number, key: keyof Change, value: string) => {
    setChanges(changes.map((c, i) => (i === index ? { ...c, [key]: value } : c)))
  }

  const removeChange = (index: number) => setChanges(changes.filter((_, i) => i !== index))

  const handleSubmit = async () => {
    setIsSubmitting(true)
    try {
      await onSubmit({
        contractId: contract.id,
        vendorId: contract.vendorId,
        vendorName: contract.vendorName,
        facilityId: contract.facilityId,
        facilityName: contract.facilityName,
        proposalType,
        changes,
        vendorMessage: message || undefined,
      })
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Propose Changes to {contract.name}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <Field label="Proposal Type">
          <Select value={proposalType} onValueChange={(v) => setProposalType(v as typeof proposalType)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="term_change">Term Change</SelectItem>
              <SelectItem value="new_term">New Term</SelectItem>
              <SelectItem value="remove_term">Remove Term</SelectItem>
              <SelectItem value="contract_edit">Contract Edit</SelectItem>
            </SelectContent>
          </Select>
        </Field>

        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-medium">Changes (Before / After)</h4>
            <Button type="button" variant="outline" size="sm" onClick={addChange}>
              <Plus className="size-3.5" /> Add
            </Button>
          </div>
          {changes.map((change, i) => (
            <div key={i} className="grid grid-cols-[1fr_1fr_1fr_auto] gap-2">
              {proposalType === "contract_edit" ? (
                <Select
                  value={change.field}
                  onValueChange={(v) => updateChange(i, "field", v)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Field" />
                  </SelectTrigger>
                  <SelectContent>
                    {CONTRACT_EDIT_FIELD_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Input placeholder="Field" value={change.field} onChange={(e) => updateChange(i, "field", e.target.value)} />
              )}
              <Input placeholder="Current value" value={change.currentValue} onChange={(e) => updateChange(i, "currentValue", e.target.value)} />
              <Input placeholder="Proposed value" value={change.proposedValue} onChange={(e) => updateChange(i, "proposedValue", e.target.value)} />
              <Button type="button" variant="ghost" size="icon-xs" onClick={() => removeChange(i)} disabled={changes.length === 1}>
                <Trash2 className="size-3.5" />
              </Button>
            </div>
          ))}
        </div>

        <Field label="Message (optional)">
          <Textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={3} />
        </Field>

        <Button onClick={handleSubmit} disabled={isSubmitting}>
          {isSubmitting ? "Submitting..." : "Submit Proposal"}
        </Button>
      </CardContent>
    </Card>
  )
}
