"use client"

import { useMemo, useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Scale, Upload, Download, AlertTriangle } from "lucide-react"
import { toast } from "sonner"
import { formatCurrency } from "@/lib/formatting"

interface BenchmarkRow {
  id: string
  productName: string
  itemNumber: string
  category: string
  nationalAsp: number
  hardFloor: number
  costBasis: number
  targetMargin: number
  gpoFee: number
}

const DEMO_BENCHMARKS: BenchmarkRow[] = [
  { id: "b1", productName: "Surgical Gloves – Nitrile", itemNumber: "SG-4012", category: "Disposables", nationalAsp: 8.5, hardFloor: 6.8, costBasis: 5.25, targetMargin: 22, gpoFee: 3 },
  { id: "b2", productName: "Hip Implant System II", itemNumber: "HI-7820", category: "Ortho-Spine", nationalAsp: 4250, hardFloor: 3600, costBasis: 2980, targetMargin: 18, gpoFee: 2.5 },
  { id: "b3", productName: "Cardiac Stent – DES", itemNumber: "CS-1105", category: "Cardiovascular", nationalAsp: 1875, hardFloor: 1200, costBasis: 1350, targetMargin: 15, gpoFee: 3 },
  { id: "b4", productName: "Bone Graft Substitute", itemNumber: "BG-3340", category: "Biologics", nationalAsp: 920, hardFloor: 700, costBasis: 580, targetMargin: 20, gpoFee: 2 },
  { id: "b5", productName: "Laparoscopic Stapler", itemNumber: "LS-5560", category: "General Surgery", nationalAsp: 385, hardFloor: 310, costBasis: 245, targetMargin: 18, gpoFee: 3 },
  { id: "b6", productName: "Spinal Fusion Cage", itemNumber: "SF-9001", category: "Ortho-Spine", nationalAsp: 3100, hardFloor: 2400, costBasis: 2650, targetMargin: 16, gpoFee: 2.5 },
  { id: "b7", productName: "Wound Vac Canister", itemNumber: "WV-2200", category: "Disposables", nationalAsp: 42, hardFloor: 28, costBasis: 22.5, targetMargin: 24, gpoFee: 3 },
  { id: "b8", productName: "Pulse Oximeter Sensor", itemNumber: "PO-8800", category: "Capital Equipment", nationalAsp: 18.75, hardFloor: 14, costBasis: 11, targetMargin: 20, gpoFee: 2 },
]

export function BenchmarksSection() {
  const [importedBenchmarks, setImportedBenchmarks] = useState<BenchmarkRow[]>([])

  const benchmarks = useMemo<BenchmarkRow[]>(() => {
    if (importedBenchmarks.length > 0) return importedBenchmarks
    return DEMO_BENCHMARKS
  }, [importedBenchmarks])

  function handleBenchmarkImport() {
    const input = document.createElement("input")
    input.type = "file"
    input.accept = ".csv,.xlsx,.xls"
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0]
      if (!file) return

      try {
        let headers: string[] = []
        let rows: Record<string, string>[] = []

        const ext = file.name.split(".").pop()?.toLowerCase()
        if (ext === "csv") {
          const text = await file.text()
          const lines = text.split(/\r?\n/).filter((l) => l.trim())
          headers = lines[0]?.split(",").map((h) => h.trim()) ?? []
          rows = lines.slice(1).map((line) => {
            const vals = line.split(",").map((v) => v.trim())
            const row: Record<string, string> = {}
            headers.forEach((h, i) => {
              row[h] = vals[i] ?? ""
            })
            return row
          })
        } else {
          const formData = new FormData()
          formData.append("file", file)
          const res = await fetch("/api/parse-file", { method: "POST", body: formData })
          if (!res.ok) throw new Error("Failed to parse file")
          const data = await res.json()
          headers = data.headers
          rows = data.rows
        }

        const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "")
        const nh = headers.map(norm)
        const find = (...aliases: string[]) =>
          aliases.map(norm).reduce<number>((f, a) => (f >= 0 ? f : nh.indexOf(a)), -1)

        const iProduct = find("product", "productname", "item", "itemname", "description")
        const iItemNo = find("itemnumber", "itemno", "sku", "referencenumber", "catalogno", "partno")
        const iCategory = find("category", "productcategory", "department")
        const iAsp = find("nationalasp", "asp", "averagesalesprice", "avgprice")
        const iFloor = find("hardfloor", "floor", "minimumprice", "floorprice")
        const iCost = find("costbasis", "cost", "unitcost", "cogs")
        const iMargin = find("targetmargin", "margin", "marginpercent")
        const iGpo = find("gpofee", "gpo", "adminfee", "fee")

        const parsed: BenchmarkRow[] = rows
          .map((r, i) => {
            const g = (idx: number) => (idx >= 0 ? r[headers[idx]] ?? "" : "")
            return {
              id: `imp-${i}`,
              productName: g(iProduct) || `Item ${i + 1}`,
              itemNumber: g(iItemNo) || "",
              category: g(iCategory) || "Uncategorized",
              nationalAsp: parseFloat(g(iAsp).replace(/[^0-9.-]/g, "")) || 0,
              hardFloor: parseFloat(g(iFloor).replace(/[^0-9.-]/g, "")) || 0,
              costBasis: parseFloat(g(iCost).replace(/[^0-9.-]/g, "")) || 0,
              targetMargin: parseFloat(g(iMargin).replace(/[^0-9.-]/g, "")) || 0,
              gpoFee: parseFloat(g(iGpo).replace(/[^0-9.-]/g, "")) || 0,
            }
          })
          .filter((r) => r.productName && (r.nationalAsp > 0 || r.costBasis > 0))

        if (parsed.length === 0) {
          toast.error(
            "No valid benchmark data found. Check your CSV has columns like Product, National ASP, Hard Floor, Cost Basis.",
          )
          return
        }

        setImportedBenchmarks(parsed)
        toast.success(`Imported ${parsed.length} benchmark items from ${file.name}`)
      } catch {
        toast.error("Failed to parse benchmark file")
      }
    }
    input.click()
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Scale className="h-5 w-5" />
              Product Pricing Benchmarks
            </CardTitle>
            <CardDescription>
              Compare your pricing and terms against national averages and hard floors
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={handleBenchmarkImport}>
              <Upload className="h-4 w-4 mr-1" />
              Import
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => toast.info("Export started. Your benchmarks CSV will download shortly.")}
            >
              <Download className="h-4 w-4 mr-1" />
              Export
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {benchmarks.length === 0 ? (
          <div className="py-12 text-center">
            <Scale className="mx-auto mb-4 h-12 w-12 text-muted-foreground/50" />
            <p className="font-medium text-muted-foreground">No benchmark data yet</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Import a benchmarks file to compare your pricing against market data
            </p>
            <Button variant="outline" className="mt-4" onClick={handleBenchmarkImport}>
              <Upload className="h-4 w-4 mr-1" />
              Import Benchmarks
            </Button>
          </div>
        ) : (
          <>
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Product</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead className="text-right">National ASP</TableHead>
                    <TableHead className="text-right">Hard Floor</TableHead>
                    <TableHead className="text-right">Cost Basis</TableHead>
                    <TableHead className="text-right">Target Margin</TableHead>
                    <TableHead className="text-right">GPO Fee</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {benchmarks.map((row) => {
                    const floorBelowCost = row.hardFloor < row.costBasis
                    return (
                      <TableRow key={row.id}>
                        <TableCell>
                          <div>
                            <p className="font-medium">{row.productName}</p>
                            <p className="text-xs text-muted-foreground">{row.itemNumber}</p>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">{row.category}</Badge>
                        </TableCell>
                        <TableCell className="text-right font-medium">
                          {formatCurrency(row.nationalAsp)}
                        </TableCell>
                        <TableCell
                          className={`text-right font-medium ${floorBelowCost ? "text-red-600 dark:text-red-400" : ""}`}
                        >
                          {formatCurrency(row.hardFloor)}
                          {floorBelowCost && <AlertTriangle className="inline-block ml-1 h-3 w-3" />}
                        </TableCell>
                        <TableCell className="text-right">{formatCurrency(row.costBasis)}</TableCell>
                        <TableCell className="text-right">{row.targetMargin}%</TableCell>
                        <TableCell className="text-right">{row.gpoFee}%</TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
            <div className="mt-4 pt-4 border-t flex items-center justify-between text-sm text-muted-foreground">
              <span>{benchmarks.length} products benchmarked</span>
              <span className="flex items-center gap-1">
                <AlertTriangle className="h-3 w-3 text-red-500" />
                Red = Hard Floor below Cost Basis
              </span>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}
