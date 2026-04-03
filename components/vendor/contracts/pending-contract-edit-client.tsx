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
import { ArrowLeft, Save, AlertCircle } from "lucide-react"
import { toast } from "sonner"
import Link from "next/link"
import type { UpdatePendingContractInput } from "@/lib/validators/pending-contracts"

interface PendingContractEditClientProps {
  pendingContractId: string
}

const STATUS_CONFIG: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  draft: { label: "Draft", variant: "outline" },
  submitted: { label: "Submitted", variant: "secondary" },
  approved: { label: "Approved", variant: "default" },
  rejected: { label: "Rejected", variant: "destructive" },
  revision_requested: { label: "Revision Requested", variant: "secondary" },
  withdrawn: { label: "Withdrawn", variant: "outline" },
}

const CONTRACT_TYPES = [
  { value: "gpo", label: "GPO" },
  { value: "direct", label: "Direct" },
  { value: "local", label: "Local" },
  { value: "custom", label: "Custom" },
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

          <Field label="Total Value ($)">
            <Input
              type="number"
              value={totalValue}
              onChange={(e) => setTotalValue(e.target.value)}
              placeholder="0"
              disabled={!isEditable}
            />
          </Field>

          <Field label="Notes">
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={4}
              placeholder="Additional notes or context..."
              disabled={!isEditable}
            />
          </Field>

          {isEditable && (
            <div className="flex justify-end pt-2">
              <Button onClick={handleSave} disabled={saving || !contractName}>
                <Save className="size-4" /> {saving ? "Saving..." : "Save Changes"}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
