"use client"

import { useState, useEffect } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { useRouter } from "next/navigation"
import {
  getVendorPendingContract,
  updatePendingContract,
} from "@/lib/actions/pending-contracts"
import { PageHeader } from "@/components/shared/page-header"
import { Field } from "@/components/shared/forms/field"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { ArrowLeft, Save, AlertCircle } from "lucide-react"
import { toast } from "sonner"
import Link from "next/link"
import type { UpdatePendingContractInput } from "@/lib/validators/pending-contracts"
import { ContractTermsCard } from "./submission/contract-terms-card"
import type { TermFormValues } from "@/lib/validators/contract-terms"

interface PendingContractEditClientProps {
  pendingContractId: string
}

/**
 * Charles 2026-04-25 (audit C3): hydrate the pending contract's
 * JSON `terms` column into TermFormValues for editing. Mirrors the
 * defaults used by extractPendingTerms in lib/actions/pending-contracts.ts
 * so a round-trip through edit -> save preserves the vendor's
 * original submission shape.
 */
function hydrateTermsForForm(termsJson: unknown): TermFormValues[] {
  if (!Array.isArray(termsJson)) return []
  const out: TermFormValues[] = []
  for (const raw of termsJson) {
    if (!raw || typeof raw !== "object") continue
    const t = raw as Record<string, unknown>
    if (typeof t.termName !== "string" || t.termName.length === 0) continue
    const tiersRaw = Array.isArray(t.tiers) ? t.tiers : []
    const tiers = tiersRaw
      .map((rawTier, idx) => {
        if (!rawTier || typeof rawTier !== "object") return null
        const tier = rawTier as Record<string, unknown>
        const tierNumber =
          typeof tier.tierNumber === "number" ? tier.tierNumber : idx + 1
        const spendMin =
          typeof tier.spendMin === "number" ? tier.spendMin : 0
        const spendMax =
          typeof tier.spendMax === "number" ? tier.spendMax : undefined
        const rebateValue =
          typeof tier.rebateValue === "number" ? tier.rebateValue : 0
        const rebateType =
          typeof tier.rebateType === "string"
            ? (tier.rebateType as TermFormValues["tiers"][number]["rebateType"])
            : "percent_of_spend"
        return {
          tierNumber,
          spendMin,
          spendMax,
          rebateType,
          rebateValue,
        } satisfies TermFormValues["tiers"][number]
      })
      .filter((x): x is NonNullable<typeof x> => x !== null)
    out.push({
      termName: t.termName,
      termType:
        typeof t.termType === "string"
          ? (t.termType as TermFormValues["termType"])
          : "spend_rebate",
      baselineType:
        typeof t.baselineType === "string"
          ? (t.baselineType as TermFormValues["baselineType"])
          : "spend_based",
      evaluationPeriod:
        typeof t.evaluationPeriod === "string" ? t.evaluationPeriod : "annual",
      paymentTiming:
        typeof t.paymentTiming === "string" ? t.paymentTiming : "quarterly",
      appliesTo:
        typeof t.appliesTo === "string" ? t.appliesTo : "all_products",
      rebateMethod:
        typeof t.rebateMethod === "string"
          ? (t.rebateMethod as TermFormValues["rebateMethod"])
          : "cumulative",
      effectiveStart:
        typeof t.effectiveStart === "string" ? t.effectiveStart : "",
      effectiveEnd:
        typeof t.effectiveEnd === "string" ? t.effectiveEnd : "",
      tiers,
    })
  }
  return out
}

const STATUS_CONFIG: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  draft: { label: "Draft", variant: "outline" },
  submitted: { label: "Submitted", variant: "secondary" },
  approved: { label: "Approved", variant: "default" },
  rejected: { label: "Rejected", variant: "destructive" },
  revision_requested: { label: "Revision Requested", variant: "secondary" },
  withdrawn: { label: "Withdrawn", variant: "outline" },
}

// Charles 2026-04-25 (audit follow-up): the prior list was bogus —
// "gpo", "direct", "local", "custom" are NOT members of the
// `ContractType` enum. Saving with any of those values would throw
// a Zod validation error at the server boundary. Match the actual
// schema enum so the dropdown is round-trippable.
const CONTRACT_TYPES = [
  { value: "usage", label: "Usage" },
  { value: "capital", label: "Capital" },
  { value: "service", label: "Service" },
  { value: "tie_in", label: "Tie-In" },
  { value: "grouped", label: "Grouped" },
  { value: "pricing_only", label: "Pricing Only" },
]

export function PendingContractEditClient({ pendingContractId }: PendingContractEditClientProps) {
  const router = useRouter()
  const queryClient = useQueryClient()

  const { data: contract, isLoading } = useQuery({
    queryKey: ["pendingContracts", "detail", pendingContractId],
    queryFn: () => getVendorPendingContract(pendingContractId),
  })

  const [contractName, setContractName] = useState("")
  const [contractType, setContractType] = useState("")
  const [effectiveDate, setEffectiveDate] = useState("")
  const [expirationDate, setExpirationDate] = useState("")
  const [totalValue, setTotalValue] = useState("")
  const [notes, setNotes] = useState("")
  // Charles 2026-04-25 (audit follow-up): Phase-2 fields. The prior
  // edit form dropped all of these on save even though the schema +
  // validator + create path support them — vendor revisions
  // couldn't actually revise most of what was originally submitted.
  const [contractNumber, setContractNumber] = useState("")
  const [annualValue, setAnnualValue] = useState("")
  const [autoRenewal, setAutoRenewal] = useState(false)
  const [terminationNoticeDays, setTerminationNoticeDays] = useState("90")
  const [gpoAffiliation, setGpoAffiliation] = useState("")
  const [performancePeriod, setPerformancePeriod] = useState("")
  const [rebatePayPeriod, setRebatePayPeriod] = useState("")
  const [capitalCost, setCapitalCost] = useState("")
  const [interestRate, setInterestRate] = useState("")
  const [termMonths, setTermMonths] = useState("")
  const [downPayment, setDownPayment] = useState("")
  const [paymentCadence, setPaymentCadence] = useState<
    "monthly" | "quarterly" | "annual"
  >("monthly")
  const [amortizationShape, setAmortizationShape] = useState<
    "symmetrical" | "custom"
  >("symmetrical")
  // Charles 2026-04-25 (audit C3): the prior edit form had no UI for
  // `terms`, so a vendor responding to "fix tier 2 rebate %" had to
  // withdraw + resubmit, losing thread continuity. Hydrated from the
  // pending contract's JSON column on load and persisted via the same
  // updatePendingContract action (which already accepts `terms`).
  const [contractTerms, setContractTerms] = useState<TermFormValues[]>([])
  const [saving, setSaving] = useState(false)

  // Populate form when contract loads
  useEffect(() => {
    if (contract) {
      setContractName(contract.contractName ?? "")
      setContractType(contract.contractType ?? "")
      setEffectiveDate(
        contract.effectiveDate
          ? String(contract.effectiveDate).slice(0, 10)
          : ""
      )
      setExpirationDate(
        contract.expirationDate
          ? String(contract.expirationDate).slice(0, 10)
          : ""
      )
      setTotalValue(contract.totalValue != null ? String(contract.totalValue) : "")
      setNotes(contract.notes ?? "")
      // Phase-2 hydration — preserve every value the vendor sent on
      // initial submission so a "revision" round-trip doesn't silently
      // erase fields the reviewer didn't ask about.
      setContractNumber(contract.contractNumber ?? "")
      setAnnualValue(
        contract.annualValue != null ? String(contract.annualValue) : "",
      )
      setAutoRenewal(Boolean(contract.autoRenewal))
      setTerminationNoticeDays(
        contract.terminationNoticeDays != null
          ? String(contract.terminationNoticeDays)
          : "90",
      )
      setGpoAffiliation(contract.gpoAffiliation ?? "")
      setPerformancePeriod(contract.performancePeriod ?? "")
      setRebatePayPeriod(contract.rebatePayPeriod ?? "")
      setCapitalCost(
        contract.capitalCost != null ? String(contract.capitalCost) : "",
      )
      setInterestRate(
        contract.interestRate != null
          ? String(Number(contract.interestRate) * 100) // schema = fraction; UI = %
          : "",
      )
      setTermMonths(
        contract.termMonths != null ? String(contract.termMonths) : "",
      )
      setDownPayment(
        contract.downPayment != null ? String(contract.downPayment) : "",
      )
      setPaymentCadence(
        (contract.paymentCadence as "monthly" | "quarterly" | "annual") ??
          "monthly",
      )
      setAmortizationShape(
        (contract.amortizationShape as "symmetrical" | "custom") ??
          "symmetrical",
      )
      // Charles 2026-04-25 (audit C3): hydrate the JSON `terms` blob
      // into TermFormValues so ContractTermsEntry can edit it. The
      // submission UI persists this exact shape, so a round-trip
      // through the revision form preserves what the vendor sent.
      // Defensive — we walk the array element-by-element and fall
      // back to schema defaults rather than throwing on malformed
      // entries (mirrors extractPendingTerms server-side).
      setContractTerms(hydrateTermsForForm(contract.terms))
    }
  }, [contract])

  const isEditable = contract?.status === "draft" || contract?.status === "revision_requested"

  const handleSave = async () => {
    setSaving(true)
    try {
      const updates: UpdatePendingContractInput = {
        contractName: contractName || undefined,
        contractType: contractType as UpdatePendingContractInput["contractType"],
        effectiveDate: effectiveDate || undefined,
        expirationDate: expirationDate || undefined,
        totalValue: totalValue ? Number(totalValue) : undefined,
        notes: notes || undefined,
        // Charles 2026-04-25 (audit follow-up): persist the Phase-2
        // fields on save so the revision loop preserves vendor's
        // original submission instead of silently zeroing them.
        contractNumber: contractNumber || undefined,
        annualValue: annualValue ? Number(annualValue) : undefined,
        autoRenewal,
        terminationNoticeDays: terminationNoticeDays
          ? Number(terminationNoticeDays)
          : undefined,
        gpoAffiliation: gpoAffiliation || undefined,
        performancePeriod: (performancePeriod || undefined) as
          | "monthly"
          | "quarterly"
          | "semi_annual"
          | "annual"
          | undefined,
        rebatePayPeriod: (rebatePayPeriod || undefined) as
          | "monthly"
          | "quarterly"
          | "semi_annual"
          | "annual"
          | undefined,
        ...(contractType === "capital" || contractType === "tie_in"
          ? {
              capitalCost: capitalCost ? Number(capitalCost) : undefined,
              interestRate: interestRate
                ? Number(interestRate) / 100 // UI = %, schema = fraction
                : undefined,
              termMonths: termMonths ? Number(termMonths) : undefined,
              downPayment: downPayment ? Number(downPayment) : undefined,
              paymentCadence,
              amortizationShape,
            }
          : {}),
        // Charles 2026-04-25 (audit C3): persist edited terms back to
        // the JSON column. updatePendingContract already accepts
        // `terms` (validator typed as z.any().optional(); action
        // forwards verbatim to Prisma). Sending an empty array is
        // meaningful — it clears all terms — so we always send the
        // current array rather than gating on length.
        terms: contractTerms,
      }
      await updatePendingContract(pendingContractId, updates)
      await queryClient.invalidateQueries({
        queryKey: ["pendingContracts", "detail", pendingContractId],
      })
      toast.success("Pending contract updated successfully")
      router.push("/vendor/contracts")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to update pending contract")
    } finally {
      setSaving(false)
    }
  }

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  if (!contract) {
    return (
      <div className="space-y-6">
        <PageHeader title="Pending Contract Not Found" />
        <p className="text-sm text-muted-foreground">The pending contract could not be found.</p>
      </div>
    )
  }

  const cfg = STATUS_CONFIG[contract.status] ?? STATUS_CONFIG.draft

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Edit Pending Contract: ${contract.contractName}`}
        description={
          isEditable
            ? "Edit and resubmit this contract for review"
            : "This contract cannot be edited in its current status"
        }
        action={
          <div className="flex items-center gap-2">
            <Badge variant={cfg.variant}>{cfg.label}</Badge>
            <Button variant="outline" size="sm" asChild>
              <Link href="/vendor/contracts">
                <ArrowLeft className="size-4" /> Back
              </Link>
            </Button>
          </div>
        }
      />

      {!isEditable && (
        <Card className="border-yellow-500/50 bg-yellow-50/50 dark:bg-yellow-950/20">
          <CardContent className="flex items-center gap-3 pt-6">
            <AlertCircle className="size-5 text-yellow-600 dark:text-yellow-400 shrink-0" />
            <p className="text-sm text-yellow-800 dark:text-yellow-200">
              This contract is in <strong>{cfg.label.toLowerCase()}</strong> status and cannot be
              edited. Only contracts in draft or revision requested status can be modified.
            </p>
          </CardContent>
        </Card>
      )}

      {contract.reviewNotes && (
        <Card className="border-blue-500/50 bg-blue-50/50 dark:bg-blue-950/20">
          <CardContent className="pt-6">
            <p className="text-sm font-medium text-blue-800 dark:text-blue-200 mb-1">
              Reviewer Notes
            </p>
            <p className="text-sm text-blue-700 dark:text-blue-300">{contract.reviewNotes}</p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Contract Details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Contract Name" required>
              <Input
                value={contractName}
                onChange={(e) => setContractName(e.target.value)}
                placeholder="Contract name"
                disabled={!isEditable}
              />
            </Field>

            <Field label="Contract Type">
              <Select
                value={contractType}
                onValueChange={setContractType}
                disabled={!isEditable}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select type" />
                </SelectTrigger>
                <SelectContent>
                  {CONTRACT_TYPES.map((ct) => (
                    <SelectItem key={ct.value} value={ct.value}>
                      {ct.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Effective Date">
              <Input
                type="date"
                value={effectiveDate}
                onChange={(e) => setEffectiveDate(e.target.value)}
                disabled={!isEditable}
              />
            </Field>

            <Field label="Expiration Date">
              <Input
                type="date"
                value={expirationDate}
                onChange={(e) => setExpirationDate(e.target.value)}
                disabled={!isEditable}
              />
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Total Value ($)">
              <Input
                type="number"
                value={totalValue}
                onChange={(e) => setTotalValue(e.target.value)}
                placeholder="0"
                disabled={!isEditable}
              />
            </Field>
            <Field label="Annual Value ($)">
              <Input
                type="number"
                value={annualValue}
                onChange={(e) => setAnnualValue(e.target.value)}
                placeholder="0"
                disabled={!isEditable}
              />
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Contract Number">
              <Input
                value={contractNumber}
                onChange={(e) => setContractNumber(e.target.value)}
                placeholder="e.g. STK-2026-001"
                disabled={!isEditable}
              />
            </Field>
            <Field label="GPO Affiliation">
              <Input
                value={gpoAffiliation}
                onChange={(e) => setGpoAffiliation(e.target.value)}
                placeholder="e.g. Vizient, Premier"
                disabled={!isEditable}
              />
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Performance Period">
              <Select
                value={performancePeriod || ""}
                onValueChange={setPerformancePeriod}
                disabled={!isEditable}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="monthly">Monthly</SelectItem>
                  <SelectItem value="quarterly">Quarterly</SelectItem>
                  <SelectItem value="semi_annual">Semi-Annual</SelectItem>
                  <SelectItem value="annual">Annual</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="Rebate Pay Period">
              <Select
                value={rebatePayPeriod || ""}
                onValueChange={setRebatePayPeriod}
                disabled={!isEditable}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="monthly">Monthly</SelectItem>
                  <SelectItem value="quarterly">Quarterly</SelectItem>
                  <SelectItem value="semi_annual">Semi-Annual</SelectItem>
                  <SelectItem value="annual">Annual</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="Termination Notice (days)">
              <Input
                type="number"
                min="0"
                value={terminationNoticeDays}
                onChange={(e) => setTerminationNoticeDays(e.target.value)}
                disabled={!isEditable}
              />
            </Field>
          </div>

          <div className="flex items-center justify-between rounded-md border p-3">
            <div>
              <p className="text-sm font-medium">Auto-Renewal</p>
              <p className="text-xs text-muted-foreground">
                Contract renews automatically at the end of the term unless
                terminated.
              </p>
            </div>
            <Switch
              checked={autoRenewal}
              onCheckedChange={setAutoRenewal}
              disabled={!isEditable}
            />
          </div>

          {(contractType === "capital" || contractType === "tie_in") && (
            <div className="space-y-3 rounded-md border bg-muted/30 p-3">
              <div>
                <p className="text-sm font-medium">Capital amortization</p>
                <p className="text-xs text-muted-foreground">
                  Required for capital + tie-in contracts so the facility
                  can render the amortization schedule on approve.
                </p>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Capital Cost ($)">
                  <Input
                    type="number"
                    step="0.01"
                    value={capitalCost}
                    onChange={(e) => setCapitalCost(e.target.value)}
                    placeholder="0"
                    disabled={!isEditable}
                  />
                </Field>
                <Field label="Interest Rate (%)">
                  <Input
                    type="number"
                    step="0.01"
                    value={interestRate}
                    onChange={(e) => setInterestRate(e.target.value)}
                    placeholder="0"
                    disabled={!isEditable}
                  />
                </Field>
                <Field label="Term (months)">
                  <Input
                    type="number"
                    min="0"
                    value={termMonths}
                    onChange={(e) => setTermMonths(e.target.value)}
                    placeholder="60"
                    disabled={!isEditable}
                  />
                </Field>
                <Field label="Down Payment ($)">
                  <Input
                    type="number"
                    step="0.01"
                    value={downPayment}
                    onChange={(e) => setDownPayment(e.target.value)}
                    placeholder="0"
                    disabled={!isEditable}
                  />
                </Field>
                <Field label="Payment Cadence">
                  <Select
                    value={paymentCadence}
                    onValueChange={(v) =>
                      setPaymentCadence(v as "monthly" | "quarterly" | "annual")
                    }
                    disabled={!isEditable}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="monthly">Monthly</SelectItem>
                      <SelectItem value="quarterly">Quarterly</SelectItem>
                      <SelectItem value="annual">Annual</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Amortization">
                  <Select
                    value={amortizationShape}
                    onValueChange={(v) =>
                      setAmortizationShape(v as "symmetrical" | "custom")
                    }
                    disabled={!isEditable}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="symmetrical">
                        Symmetrical (PMT)
                      </SelectItem>
                      <SelectItem value="custom">Custom rows</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
              </div>
            </div>
          )}

          <Field label="Notes">
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={4}
              placeholder="Additional notes or context..."
              disabled={!isEditable}
            />
          </Field>

        </CardContent>
      </Card>

      {/*
       * Charles 2026-04-25 (audit C3): terms editor. When the
       * contract isn't editable (approved/rejected/withdrawn) we
       * still want the vendor to SEE the terms — render disabled
       * via the wrapper container's pointer-events suppression so
       * the existing ContractTermsEntry component can stay
       * unchanged. The save button moves below this card so it
       * commits both Phase-2 scalars and edited terms in one
       * round-trip.
       */}
      {isEditable ? (
        <ContractTermsCard
          contractTerms={contractTerms}
          onContractTermsChange={setContractTerms}
        />
      ) : (
        <div className="pointer-events-none opacity-60">
          <ContractTermsCard
            contractTerms={contractTerms}
            onContractTermsChange={setContractTerms}
          />
        </div>
      )}

      {isEditable && (
        <div className="flex justify-end pt-2">
          <Button onClick={handleSave} disabled={saving || !contractName}>
            <Save className="size-4" /> {saving ? "Saving..." : "Save Changes"}
          </Button>
        </div>
      )}
    </div>
  )
}
