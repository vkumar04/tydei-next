"use client"

import { useState, useTransition } from "react"
import { Plus, Trash2, Sparkles } from "lucide-react"
import { AmendmentExtractor } from "@/components/contracts/amendment-extractor"
import { ProposedPricingEditor } from "@/components/vendor/contracts/proposed-pricing-editor"
import type { ProposedPricingItem } from "@/lib/contracts/pricing-match"
import type { AmendmentChange } from "@/app/api/ai/extract-amendment/route"
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
  /** Stable row identity — index keys reuse the wrong row's state on delete. */
  id: string
  field: string
  currentValue: string
  proposedValue: string
}

let rowSeq = 0
const newRow = (patch: Partial<Change> = {}): Change => ({
  id: `row-${rowSeq++}`,
  field: "",
  currentValue: "",
  proposedValue: "",
  ...patch,
})

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
  // Charles audit suggestion #4 (v0-port): legacy capital fields
  // (capitalCost / interestRate / termMonths / downPayment /
  // paymentCadence) removed — capital lives in
  // ContractCapitalLineItem. Edits to capital must go through the
  // line-item flow (future per-item proposal type).
  { value: "amortizationShape", label: "Amortization shape" },
]

interface ChangeProposalFormProps {
  contract: { id: string; name: string; vendorId: string; vendorName: string; facilityId?: string; facilityName?: string }
  onSubmit: (proposal: CreateChangeProposalInput) => Promise<void>
}

export function ChangeProposalForm({ contract, onSubmit }: ChangeProposalFormProps) {
  const [proposalType, setProposalType] = useState<"term_change" | "new_term" | "remove_term" | "contract_edit">("term_change")
  const [changes, setChanges] = useState<Change[]>([newRow()])
  const [message, setMessage] = useState("")
  const [extractorOpen, setExtractorOpen] = useState(false)
  const [pricingItems, setPricingItems] = useState<ProposedPricingItem[]>([])
  const [isPending, startTransition] = useTransition()

  const addChange = () => setChanges((rows) => [...rows, newRow()])

  const updateChange = (id: string, key: keyof Change, value: string) => {
    setChanges((rows) =>
      rows.map((c) => (c.id === id ? { ...c, [key]: value } : c)),
    )
  }

  const removeChange = (id: string) =>
    setChanges((rows) => rows.filter((c) => c.id !== id))

  // AI-extracted amendment → proposal rows. `contract_edit` is the only type
  // approval actually applies, and only for whitelisted fields, so fall back to
  // term_change when the document touches anything outside that set rather than
  // letting the field Select silently drop it.
  const seedFromAmendment = (
    extracted: AmendmentChange[],
    effectiveDate: string | null,
  ) => {
    const rows = extracted
      .filter((c) => c.type !== "removed")
      .map((c) =>
        newRow({
          field: c.field,
          currentValue: c.oldValue,
          proposedValue: c.newValue,
        }),
      )
    if (rows.length === 0) return

    const allowed = new Set(CONTRACT_EDIT_FIELD_OPTIONS.map((o) => o.value))
    setProposalType(rows.every((r) => allowed.has(r.field)) ? "contract_edit" : "term_change")
    setChanges(rows)
    setMessage((m) =>
      m ||
      `Proposed from an amendment document${effectiveDate ? `, effective ${effectiveDate}` : ""}.`,
    )
  }

  const handleSubmit = () => {
    startTransition(async () => {
      await onSubmit({
        contractId: contract.id,
        vendorId: contract.vendorId,
        vendorName: contract.vendorName,
        facilityId: contract.facilityId,
        facilityName: contract.facilityName,
        proposalType,
        changes: changes.map(({ field, currentValue, proposedValue }) => ({
          field,
          currentValue,
          proposedValue,
        })),
        proposedTerms: pricingItems.length ? { pricingItems } : undefined,
        vendorMessage: message || undefined,
      })
    })
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
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setExtractorOpen(true)}
              >
                <Sparkles className="size-3.5" /> Read amendment doc
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={addChange}>
                <Plus className="size-3.5" /> Add
              </Button>
            </div>
          </div>
          {changes.map((change) => (
            <div key={change.id} className="grid grid-cols-[1fr_1fr_1fr_auto] gap-2">
              {proposalType === "contract_edit" ? (
                <Select
                  value={change.field}
                  onValueChange={(v) => updateChange(change.id, "field", v)}
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
                <Input placeholder="Field" value={change.field} onChange={(e) => updateChange(change.id, "field", e.target.value)} />
              )}
              <Input
                placeholder="Current value"
                value={change.currentValue}
                onChange={(e) => updateChange(change.id, "currentValue", e.target.value)}
              />
              <Input
                placeholder="Proposed value"
                value={change.proposedValue}
                onChange={(e) => updateChange(change.id, "proposedValue", e.target.value)}
              />
              <Button type="button" variant="ghost" size="icon-xs" onClick={() => removeChange(change.id)} disabled={changes.length === 1}>
                <Trash2 className="size-3.5" />
              </Button>
            </div>
          ))}
        </div>

        <ProposedPricingEditor
          contractId={contract.id}
          items={pricingItems}
          onChange={setPricingItems}
        />

        <AmendmentExtractor
          contractId={contract.id}
          open={extractorOpen}
          onOpenChange={setExtractorOpen}
          onApplied={() => setExtractorOpen(false)}
          onProposeChanges={seedFromAmendment}
        />

        <Field label="Message (optional)">
          <Textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={3} />
        </Field>

        <Button onClick={handleSubmit} disabled={isPending}>
          {isPending ? "Submitting..." : "Submit Proposal"}
        </Button>
      </CardContent>
    </Card>
  )
}
