"use client"

import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Checkbox } from "@/components/ui/checkbox"
import { Badge } from "@/components/ui/badge"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Users, Building2, X } from "lucide-react"

const CONTRACT_TYPE_OPTIONS = [
  { value: "usage", label: "Usage-Based", hint: "Rebates on spend" },
  { value: "pricing_only", label: "Pricing Only", hint: "Discounted prices" },
  { value: "capital", label: "Capital Equipment", hint: "Equipment + service" },
  { value: "grouped", label: "GPO/Group", hint: "Collective buying" },
  { value: "tie_in", label: "Tie-In", hint: "Bundled products" },
  { value: "service", label: "Service", hint: "Service agreements" },
] as const

const DIVISION_OPTIONS = [
  "Orthopedic Implants",
  "Spine",
  "Trauma",
  "Sports Medicine",
  "Biologics",
  "Robotics & Navigation",
  "Instruments",
  "General",
  "Other",
] as const

export interface FacilityOption {
  id: string
  name: string
}

export interface BasicInformationCardProps {
  contractName: string
  onContractNameChange: (value: string) => void
  contractType: string
  onContractTypeChange: (value: string) => void
  division: string
  onDivisionChange: (value: string) => void
  facilityId: string
  onFacilityIdChange: (value: string) => void
  facilities: FacilityOption[]
  isMultiFacility: boolean
  onIsMultiFacilityChange: (checked: boolean) => void
  selectedFacilities: string[]
  onSelectedFacilitiesChange: (facilities: string[]) => void
  capitalTieIn: boolean
  onCapitalTieInChange: (checked: boolean) => void
  tieInRef: string
  onTieInRefChange: (value: string) => void
  description: string
  onDescriptionChange: (value: string) => void
}

export function BasicInformationCard({
  contractName,
  onContractNameChange,
  contractType,
  onContractTypeChange,
  division,
  onDivisionChange,
  facilityId,
  onFacilityIdChange,
  facilities,
  isMultiFacility,
  onIsMultiFacilityChange,
  selectedFacilities,
  onSelectedFacilitiesChange,
  capitalTieIn,
  onCapitalTieInChange,
  tieInRef,
  onTieInRefChange,
  description,
  onDescriptionChange,
}: BasicInformationCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Basic Information</CardTitle>
        <CardDescription>Enter the contract details</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="contractName">Contract Name *</Label>
            <Input
              id="contractName"
              value={contractName}
              onChange={(e) => onContractNameChange(e.target.value)}
              placeholder="e.g., Biologics Supply Agreement 2024"
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="contractType">Contract Type *</Label>
            <Select value={contractType} onValueChange={onContractTypeChange}>
              <SelectTrigger>
                <SelectValue placeholder="Select type" />
              </SelectTrigger>
              <SelectContent>
                {CONTRACT_TYPE_OPTIONS.map((t) => (
                  <SelectItem key={t.value} value={t.value}>
                    <div className="flex items-center justify-between w-full gap-2">
                      <span>{t.label}</span>
                      <span className="text-xs text-muted-foreground">
                        {t.hint}
                      </span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="division">Division</Label>
            <Select value={division} onValueChange={onDivisionChange}>
              <SelectTrigger>
                <SelectValue placeholder="Select division" />
              </SelectTrigger>
              <SelectContent>
                {DIVISION_OPTIONS.map((d) => (
                  <SelectItem key={d} value={d}>
                    {d}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Facility Selection */}
        <div className="space-y-3">
          <div className="flex items-center gap-3 p-3 rounded-lg border bg-muted/30">
            <Checkbox
              id="multiFacility"
              checked={isMultiFacility}
              onCheckedChange={(checked) => {
                onIsMultiFacilityChange(checked === true)
              }}
            />
            <div className="grid gap-0.5">
              <label
                htmlFor="multiFacility"
                className="flex items-center gap-2 cursor-pointer font-medium"
              >
                <Users className="h-4 w-4 text-muted-foreground" />
                Multi-Facility Contract
              </label>
              <p className="text-xs text-muted-foreground">
                Apply this contract to multiple facilities
              </p>
            </div>
          </div>

          {isMultiFacility ? (
            <div className="space-y-2">
              <Label className="flex items-center gap-2">
                <Building2 className="h-4 w-4" />
                Select Participating Facilities *
              </Label>
              {selectedFacilities.length > 0 && (
                <div className="flex flex-wrap gap-2 p-2 rounded-md border bg-muted/30">
                  {selectedFacilities.map((fId) => {
                    const fac = facilities.find((f) => f.id === fId)
                    return fac ? (
                      <Badge
                        key={fId}
                        variant="secondary"
                        className="flex items-center gap-1"
                      >
                        {fac.name}
                        <button
                          type="button"
                          onClick={() =>
                            onSelectedFacilitiesChange(
                              selectedFacilities.filter((id) => id !== fId)
                            )
                          }
                          className="ml-1 hover:text-destructive"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </Badge>
                    ) : null
                  })}
                </div>
              )}
              <Select
                value=""
                onValueChange={(value) => {
                  if (value && !selectedFacilities.includes(value)) {
                    onSelectedFacilitiesChange([...selectedFacilities, value])
                  }
                }}
              >
                <SelectTrigger>
                  <SelectValue
                    placeholder={
                      selectedFacilities.length > 0
                        ? "Add another facility..."
                        : "Select facilities"
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  {facilities
                    .filter(
                      (f) => !selectedFacilities.includes(f.id)
                    )
                    .map((f) => (
                      <SelectItem key={f.id} value={f.id}>
                        {f.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
          ) : (
            <div className="space-y-2">
              <Label htmlFor="facility">Target Facility *</Label>
              <Select value={facilityId} onValueChange={onFacilityIdChange}>
                <SelectTrigger>
                  <SelectValue placeholder="Select facility" />
                </SelectTrigger>
                <SelectContent>
                  {facilities.map((f) => (
                    <SelectItem key={f.id} value={f.id}>
                      {f.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>

        {/* Capital Tie-In */}
        <div className="space-y-3">
          <div className="flex items-center gap-3 p-3 rounded-lg border bg-muted/30">
            <Checkbox
              id="capitalTieIn"
              checked={capitalTieIn}
              onCheckedChange={(checked) => {
                onCapitalTieInChange(checked === true)
              }}
            />
            <div className="grid gap-0.5">
              <label
                htmlFor="capitalTieIn"
                className="flex items-center gap-2 cursor-pointer font-medium"
              >
                Capital Tie-In
              </label>
              <p className="text-xs text-muted-foreground">
                Link this contract to a capital equipment agreement
              </p>
            </div>
          </div>
          {capitalTieIn && (
            <div className="space-y-2">
              <Label htmlFor="tieInRef">Capital Contract Reference</Label>
              <Input
                id="tieInRef"
                value={tieInRef}
                onChange={(e) => onTieInRefChange(e.target.value)}
                placeholder="e.g., CAP-2024-001"
              />
            </div>
          )}
        </div>

        {/* Description / Special Terms */}
        <div className="space-y-2">
          <Label htmlFor="description">
            Description / Special Terms
          </Label>
          <Textarea
            id="description"
            value={description}
            onChange={(e) => onDescriptionChange(e.target.value)}
            placeholder="Additional contract notes, special conditions, etc."
            rows={3}
          />
        </div>
      </CardContent>
    </Card>
  )
}
