import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Check, X, Plus, Users, Layers } from "lucide-react"
import type { NewProposalState, ProspectiveFacility } from "./types"

export interface FacilitySelectorProps {
  newProposal: NewProposalState
  setNewProposal: React.Dispatch<React.SetStateAction<NewProposalState>>
  allFacilities: { id: string; name: string }[]
  allCategories: string[]
  showAddFacility: boolean
  setShowAddFacility: (v: boolean) => void
  newFacilityName: string
  setNewFacilityName: (v: string) => void
  showAddCategory: boolean
  setShowAddCategory: (v: boolean) => void
  newCategoryName: string
  setNewCategoryName: (v: string) => void
  setCustomFacilities: React.Dispatch<React.SetStateAction<ProspectiveFacility[]>>
  setCustomCategories: React.Dispatch<React.SetStateAction<string[]>>
}

export function FacilitySelector({
  newProposal,
  setNewProposal,
  allFacilities,
  allCategories,
  showAddFacility,
  setShowAddFacility,
  newFacilityName,
  setNewFacilityName,
  showAddCategory,
  setShowAddCategory,
  newCategoryName,
  setNewCategoryName,
  setCustomFacilities,
  setCustomCategories,
}: FacilitySelectorProps) {
  return (
    <>
      {/* Multi-facility and Grouped Options */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 p-4 rounded-lg border bg-muted/30">
        <div className="flex items-center gap-3">
          <Checkbox
            id="multiFacility"
            checked={newProposal.isMultiFacility}
            onCheckedChange={(checked) => {
              setNewProposal(prev => ({
                ...prev,
                isMultiFacility: checked === true,
                facilities: checked ? prev.facilities : [],
              }))
            }}
          />
          <div className="grid gap-0.5">
            <Label htmlFor="multiFacility" className="flex items-center gap-2 cursor-pointer">
              <Users className="h-4 w-4 text-muted-foreground" />
              Multi-Facility Proposal
            </Label>
            <p className="text-xs text-muted-foreground">Include multiple facilities in this proposal</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Checkbox
            id="grouped"
            checked={newProposal.isGrouped}
            onCheckedChange={(checked) => {
              setNewProposal(prev => ({
                ...prev,
                isGrouped: checked === true,
                groupName: checked ? prev.groupName : "",
              }))
            }}
          />
          <div className="grid gap-0.5">
            <Label htmlFor="grouped" className="flex items-center gap-2 cursor-pointer">
              <Layers className="h-4 w-4 text-muted-foreground" />
              Grouped Proposal
            </Label>
            <p className="text-xs text-muted-foreground">Multiple divisions of an organization</p>
          </div>
        </div>
      </div>

      {/* Group Name (if grouped) */}
      {newProposal.isGrouped && (
        <div className="space-y-2">
          <Label>Group Name *</Label>
          <Input
            placeholder="e.g., Southeast Health System Group Buy"
            value={newProposal.groupName}
            onChange={(e) => setNewProposal(prev => ({ ...prev, groupName: e.target.value }))}
          />
        </div>
      )}

      {/* Basic Info */}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label>{newProposal.isMultiFacility ? "Primary Facility *" : "Facility *"}</Label>
          {showAddFacility ? (
            <div className="flex gap-2">
              <Input
                placeholder="Enter facility name"
                value={newFacilityName}
                onChange={(e) => setNewFacilityName(e.target.value)}
                autoFocus
              />
              <Button
                size="sm"
                onClick={() => {
                  if (newFacilityName.trim()) {
                    const newId = `custom-${Date.now()}`
                    setCustomFacilities(prev => [...prev, { id: newId, name: newFacilityName.trim() }])
                    setNewProposal(prev => ({ ...prev, facilityId: newId }))
                    setNewFacilityName("")
                    setShowAddFacility(false)
                  }
                }}
              >
                <Check className="h-4 w-4" />
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setNewFacilityName("")
                  setShowAddFacility(false)
                }}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          ) : (
            <div className="flex gap-2">
              <Select
                value={newProposal.facilityId}
                onValueChange={(v) => setNewProposal(prev => ({ ...prev, facilityId: v }))}
              >
                <SelectTrigger className="flex-1">
                  <SelectValue placeholder="Select facility" />
                </SelectTrigger>
                <SelectContent>
                  {allFacilities.map(f => (
                    <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                size="icon"
                variant="outline"
                onClick={() => setShowAddFacility(true)}
                title="Add new facility"
              >
                <Plus className="h-4 w-4" />
              </Button>
            </div>
          )}

          {/* Multi-facility selection */}
          {newProposal.isMultiFacility && (
            <div className="mt-3 p-3 rounded-lg border bg-muted/20">
              <Label className="text-xs text-muted-foreground mb-2 block">Additional Facilities</Label>
              <div className="space-y-2 max-h-[150px] overflow-y-auto">
                {allFacilities.filter(f => f.id !== newProposal.facilityId).map(facility => (
                  <div key={facility.id} className="flex items-center gap-2">
                    <Checkbox
                      id={`facility-${facility.id}`}
                      checked={newProposal.facilities.some(f => f.id === facility.id)}
                      onCheckedChange={(checked) => {
                        setNewProposal(prev => ({
                          ...prev,
                          facilities: checked
                            ? [...prev.facilities, { id: facility.id, name: facility.name }]
                            : prev.facilities.filter(f => f.id !== facility.id),
                        }))
                      }}
                    />
                    <Label htmlFor={`facility-${facility.id}`} className="text-sm cursor-pointer">
                      {facility.name}
                    </Label>
                  </div>
                ))}
              </div>
              {newProposal.facilities.length > 0 && (
                <p className="text-xs text-muted-foreground mt-2">
                  {newProposal.facilities.length} additional facility(ies) selected
                </p>
              )}
            </div>
          )}
        </div>
        <div className="space-y-2">
          <Label>Product Categories *</Label>
          {showAddCategory ? (
            <div className="flex gap-2">
              <Input
                placeholder="Enter category name"
                value={newCategoryName}
                onChange={(e) => setNewCategoryName(e.target.value)}
                autoFocus
              />
              <Button
                size="sm"
                onClick={() => {
                  if (newCategoryName.trim()) {
                    setCustomCategories(prev => [...prev, newCategoryName.trim()])
                    setNewProposal(prev => ({
                      ...prev,
                      productCategory: prev.productCategory || newCategoryName.trim(),
                      productCategories: [...prev.productCategories, newCategoryName.trim()],
                    }))
                    setNewCategoryName("")
                    setShowAddCategory(false)
                  }
                }}
              >
                <Check className="h-4 w-4" />
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setNewCategoryName("")
                  setShowAddCategory(false)
                }}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          ) : (
            <div className="space-y-2">
              {/* Multi-select category checkboxes */}
              <div className="flex flex-wrap gap-2 p-3 rounded-lg border bg-muted/20 max-h-[150px] overflow-y-auto">
                {allCategories.map(cat => (
                  <label
                    key={cat}
                    className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-sm cursor-pointer transition-colors ${
                      newProposal.productCategories.includes(cat)
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted hover:bg-muted/80"
                    }`}
                  >
                    <input
                      type="checkbox"
                      className="sr-only"
                      checked={newProposal.productCategories.includes(cat)}
                      onChange={(e) => {
                        setNewProposal(prev => {
                          const newCategories = e.target.checked
                            ? [...prev.productCategories, cat]
                            : prev.productCategories.filter(c => c !== cat)
                          return {
                            ...prev,
                            productCategories: newCategories,
                            productCategory: newCategories[0] || "",
                          }
                        })
                      }}
                    />
                    {cat}
                  </label>
                ))}
              </div>
              <div className="flex justify-between items-center">
                <p className="text-xs text-muted-foreground">
                  {newProposal.productCategories.length > 0
                    ? `Selected: ${newProposal.productCategories.join(", ")}`
                    : "Select one or more categories"}
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setShowAddCategory(true)}
                  className="gap-1"
                >
                  <Plus className="h-3 w-3" />
                  Add Category
                </Button>
              </div>
            </div>
          )}

          {/* Divisions input for grouped proposals */}
          {newProposal.isGrouped && (
            <div className="mt-3 p-3 rounded-lg border bg-muted/20">
              <Label className="text-xs text-muted-foreground mb-2 block">Organization Divisions</Label>
              <Input
                placeholder="e.g., Orthopedics, Cardiology, Neurology"
                defaultValue=""
                onBlur={(e) => {
                  const divisions = e.target.value.split(",").map(d => d.trim()).filter(d => d)
                  setNewProposal(prev => ({
                    ...prev,
                    productCategories: divisions.length > 0 ? divisions : prev.productCategories,
                  }))
                }}
              />
              <p className="text-xs text-muted-foreground mt-1">
                Enter division names separated by commas (updates on blur)
              </p>
            </div>
          )}
        </div>
      </div>
    </>
  )
}
