"use client"

import { useState, useRef } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Upload, FileSpreadsheet, Plus, Trash2 } from "lucide-react"
import { useCreateProposal } from "@/hooks/use-prospective"
import type { ProposedPricingItem } from "@/lib/actions/prospective"
import { DealScoreView } from "./deal-score-view"
import type { DealScore } from "@/lib/actions/prospective"

interface ProposalBuilderProps {
  vendorId: string
  facilities: { id: string; name: string }[]
}

export function ProposalBuilder({ vendorId, facilities }: ProposalBuilderProps) {
  const [selectedFacilities, setSelectedFacilities] = useState<string[]>([])
  const [items, setItems] = useState<ProposedPricingItem[]>([])
  const [contractLength, setContractLength] = useState("12")
  const [startDate, setStartDate] = useState("")
  const [score, setScore] = useState<DealScore | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const createMutation = useCreateProposal()

  function toggleFacility(id: string) {
    setSelectedFacilities((prev) =>
      prev.includes(id) ? prev.filter((f) => f !== id) : [...prev, id]
    )
  }

  function addItem() {
    setItems((prev) => [
      ...prev,
      { vendorItemNo: "", proposedPrice: 0, quantity: 1 },
    ])
  }

  function removeItem(idx: number) {
    setItems((prev) => prev.filter((_, i) => i !== idx))
  }

  function updateItem(idx: number, field: keyof ProposedPricingItem, value: string) {
    setItems((prev) =>
      prev.map((item, i) =>
        i === idx
          ? {
              ...item,
              [field]: field === "vendorItemNo" || field === "description"
                ? value
                : parseFloat(value) || 0,
            }
          : item
      )
    )
  }

  async function handleUploadPricing(file: File) {
    const text = await file.text()
    const lines = text.split("\n").filter((l) => l.trim())
    const headers = lines[0]?.split(",").map((h) => h.trim().toLowerCase()) ?? []

    const parsed: ProposedPricingItem[] = lines.slice(1).map((line) => {
      const vals = line.split(",").map((v) => v.trim())
      const get = (key: string) => vals[headers.indexOf(key)] ?? ""
      return {
        vendorItemNo: get("item_no") || get("sku"),
        description: get("description") || undefined,
        proposedPrice: parseFloat(get("price") || get("proposed_price") || "0"),
        quantity: parseInt(get("quantity") || get("qty") || "1") || 1,
      }
    })
    setItems(parsed)
  }

  async function handleSubmit() {
    if (selectedFacilities.length === 0 || items.length === 0) return
    await createMutation.mutateAsync({
      vendorId,
      facilityIds: selectedFacilities,
      pricingItems: items,
      terms: {
        contractLength: parseInt(contractLength),
        startDate,
      },
    })
  }

  return (
    <Tabs defaultValue="facilities">
      <TabsList>
        <TabsTrigger value="facilities">Facilities</TabsTrigger>
        <TabsTrigger value="pricing">Pricing</TabsTrigger>
        <TabsTrigger value="terms">Terms</TabsTrigger>
        {score && <TabsTrigger value="score">Deal Score</TabsTrigger>}
      </TabsList>

      <TabsContent value="facilities" className="mt-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Target Facilities</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-2 sm:grid-cols-2">
              {facilities.map((f) => (
                <label
                  key={f.id}
                  className="flex items-center gap-2 rounded-md border p-3 cursor-pointer hover:bg-muted/50"
                >
                  <input
                    type="checkbox"
                    checked={selectedFacilities.includes(f.id)}
                    onChange={() => toggleFacility(f.id)}
                    className="size-4"
                  />
                  <span className="text-sm">{f.name}</span>
                </label>
              ))}
              {facilities.length === 0 && (
                <p className="text-sm text-muted-foreground">No facilities available</p>
              )}
            </div>
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="pricing" className="mt-4 space-y-4">
        <div className="flex items-center gap-2">
          <input
            ref={inputRef}
            type="file"
            accept=".csv"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) handleUploadPricing(file)
            }}
          />
          <Button variant="outline" onClick={() => inputRef.current?.click()}>
            <Upload className="size-4" /> Upload CSV
          </Button>
          <Button variant="outline" onClick={addItem}>
            <Plus className="size-4" /> Add Item
          </Button>
        </div>

        {items.length > 0 && (
          <Card>
            <CardContent className="pt-4">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Item #</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead>Price</TableHead>
                    <TableHead>Qty</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((item, idx) => (
                    <TableRow key={idx}>
                      <TableCell>
                        <Input
                          value={item.vendorItemNo}
                          onChange={(e) => updateItem(idx, "vendorItemNo", e.target.value)}
                          className="h-8 w-28"
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          value={item.description ?? ""}
                          onChange={(e) => updateItem(idx, "description", e.target.value)}
                          className="h-8"
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          value={item.proposedPrice}
                          onChange={(e) => updateItem(idx, "proposedPrice", e.target.value)}
                          className="h-8 w-24"
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          value={item.quantity ?? 1}
                          onChange={(e) => updateItem(idx, "quantity", e.target.value)}
                          className="h-8 w-16"
                        />
                      </TableCell>
                      <TableCell>
                        <Button variant="ghost" size="icon" onClick={() => removeItem(idx)}>
                          <Trash2 className="size-4 text-muted-foreground" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}
      </TabsContent>

      <TabsContent value="terms" className="mt-4 space-y-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Proposal Terms</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Contract Length (months)</Label>
              <Input
                type="number"
                value={contractLength}
                onChange={(e) => setContractLength(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Start Date</Label>
              <Input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </div>
          </CardContent>
        </Card>
        <Button
          onClick={handleSubmit}
          disabled={
            createMutation.isPending ||
            selectedFacilities.length === 0 ||
            items.length === 0
          }
        >
          {createMutation.isPending ? "Submitting..." : "Submit Proposal"}
        </Button>
      </TabsContent>

      {score && (
        <TabsContent value="score" className="mt-4">
          <DealScoreView score={score} />
        </TabsContent>
      )}
    </Tabs>
  )
}
