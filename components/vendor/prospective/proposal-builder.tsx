"use client"

import { useState, useRef, useCallback } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { Textarea } from "@/components/ui/textarea"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import {
  Upload,
  Plus,
  Trash2,
  Check,
  X,
  Users,
  Layers,
  History,
  Package,
  Sparkles,
  Calculator,
  TrendingUp,
  DollarSign,
  PieChart as PieChartIcon,
  Percent,
  HelpCircle,
  CheckCircle2,
  AlertTriangle,
  Clock,
  FileText,
  Target,
  Loader2,
} from "lucide-react"
import { toast } from "sonner"
import { useCreateProposal } from "@/hooks/use-prospective"
import type { ProposedPricingItem } from "@/lib/actions/prospective"
import { formatCurrency } from "@/lib/formatting"
import { DealScoreView } from "./deal-score-view"
import type { DealScore } from "@/lib/actions/prospective"

// ─── Types ──────────────────────────────────────────────────────

interface ProspectiveFacility {
  id: string
  name: string
}

interface ProspectiveTerm {
  id: string
  termType: "spend_rebate" | "volume_rebate" | "market_share_rebate" | "price_reduction"
  name: string
  targetType: "spend" | "volume" | "market_share"
  targetValue: number
  rebatePercent: number
  tiers: { threshold: number; rebatePercent: number }[]
}

interface MonthlyUsage {
  month: string
  volume: number
  revenue: number
  avgPrice: number
}

interface ProposalProduct {
  benchmarkId: string
  productName: string
  refNumber?: string
  proposedPrice: number
  projectedVolume: number
  historicalAvgPrice?: number
  historicalAvgVolume?: number
  costBasis?: number
  monthlyUsage?: MonthlyUsage[]
  fromPricingFile?: boolean
}

// ─── Constants ──────────────────────────────────────────────────

const PRODUCT_CATEGORIES = [
  "Biologics",
  "Ortho-Spine",
  "Disposables",
  "Capital Equipment",
  "Instruments",
  "Cardiovascular",
  "General Surgery",
]

const TERM_TYPES = [
  { value: "spend_rebate", label: "Spend Rebate", description: "Rebate calculated based on total dollar spend thresholds. Higher spend = higher rebate tier.", icon: DollarSign },
  { value: "volume_rebate", label: "Volume Rebate", description: "Rebate based on unit/case volume purchased. Ideal for high-volume consumables.", icon: TrendingUp },
  { value: "market_share_rebate", label: "Market Share Rebate", description: "Rebate earned when facility purchases a target % of category from your products.", icon: PieChartIcon },
  { value: "price_reduction", label: "Price Reduction", description: "Once spend/volume threshold is met, future purchases receive discounted unit prices.", icon: Percent },
]

// ─── Helper ─────────────────────────────────────────────────────

function formatCurrencyShort(value: number) {
  if (isNaN(value) || value === null || value === undefined) return "$0"
  if (value >= 1000000) return `$${(value / 1000000).toFixed(1)}M`
  if (value >= 1000) return `$${(value / 1000).toFixed(0)}K`
  return `$${value.toFixed(0)}`
}

function parseCSVLine(line: string): string[] {
  const result: string[] = []
  let current = ""
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const char = line[i]
    if (char === '"') {
      inQuotes = !inQuotes
    } else if (char === "," && !inQuotes) {
      result.push(current.trim().replace(/"/g, ""))
      current = ""
    } else {
      current += char
    }
  }
  result.push(current.trim().replace(/"/g, ""))
  return result
}

// ─── Component ──────────────────────────────────────────────────

interface ProposalBuilderProps {
  vendorId: string
  facilities: { id: string; name: string }[]
  editingProposalId?: string | null
  onClose?: () => void
}

export function ProposalBuilder({ vendorId, facilities, editingProposalId, onClose }: ProposalBuilderProps) {
  const createMutation = useCreateProposal()
  const [score, setScore] = useState<DealScore | null>(null)

  // Custom facilities and categories
  const [customFacilities, setCustomFacilities] = useState<{ id: string; name: string }[]>([])
  const [customCategories, setCustomCategories] = useState<string[]>([])
  const [showAddFacility, setShowAddFacility] = useState(false)
  const [showAddCategory, setShowAddCategory] = useState(false)
  const [newFacilityName, setNewFacilityName] = useState("")
  const [newCategoryName, setNewCategoryName] = useState("")

  // Combined lists
  const allFacilities = [
    ...facilities,
    ...customFacilities,
  ]
  const allCategories = [...PRODUCT_CATEGORIES, ...customCategories]

  // File upload loading states
  const [fileUploadProgress, setFileUploadProgress] = useState<{
    isLoading: boolean
    type: "usage" | "pricing" | null
    progress: number
    message: string
  }>({ isLoading: false, type: null, progress: 0, message: "" })

  // AI generation state
  const [isGeneratingAI, setIsGeneratingAI] = useState(false)
  const [aiProductDescription, setAiProductDescription] = useState("")

  // AI suggestions state
  const [aiSuggestions, setAiSuggestions] = useState<{
    isLoading: boolean
    data: {
      negotiationAdvice?: string[]
      suggestedTerms?: { type: string; description: string; rationale: string }[]
      riskFactors?: string[]
      competitiveStrategy?: string | null
      urgencyAssessment?: string
      dealStrength?: "strong" | "moderate" | "weak"
      recommendedDiscount?: string | null
    } | null
  }>({ isLoading: false, data: null })

  // Track last analyzed state
  const lastAnalyzedRef = useRef<string>("")

  // New proposal form state
  const [newProposal, setNewProposal] = useState({
    facilityId: "",
    facilityName: "",
    isMultiFacility: false,
    facilities: [] as ProspectiveFacility[],
    productCategory: "",
    productCategories: [] as string[],
    isGrouped: false,
    groupName: "",
    contractLength: 24,
    projectedSpend: 0,
    projectedVolume: 0,
    totalOpportunity: 0,
    terms: [] as ProspectiveTerm[],
    products: [] as ProposalProduct[],
    marketShareCommitment: 50,
    gpoFee: 3,
    aiNotes: "",
  })

  // ─── Term helpers ──────────────────────────────────────────────

  const addTerm = () => {
    const newTerm: ProspectiveTerm = {
      id: `term-${Date.now()}`,
      termType: "spend_rebate",
      name: "",
      targetType: "spend",
      targetValue: 0,
      rebatePercent: 0,
      tiers: [],
    }
    setNewProposal(prev => ({ ...prev, terms: [...prev.terms, newTerm] }))
  }

  const removeTerm = (termId: string) => {
    setNewProposal(prev => ({ ...prev, terms: prev.terms.filter(t => t.id !== termId) }))
  }

  const updateTerm = (termId: string, updates: Partial<ProspectiveTerm>) => {
    setNewProposal(prev => ({
      ...prev,
      terms: prev.terms.map(t => t.id === termId ? { ...t, ...updates } : t),
    }))
  }

  // ─── Product helpers ───────────────────────────────────────────

  const removeProductFromProposal = (benchmarkId: string) => {
    setNewProposal(prev => {
      const product = prev.products.find(p => p.benchmarkId === benchmarkId)
      return {
        ...prev,
        products: prev.products.filter(p => p.benchmarkId !== benchmarkId),
        projectedSpend: prev.projectedSpend - (product ? product.proposedPrice * product.projectedVolume : 0),
        projectedVolume: prev.projectedVolume - (product?.projectedVolume || 0),
      }
    })
  }

  // ─── Pricing file upload ───────────────────────────────────────

  const handlePricingFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    setFileUploadProgress({ isLoading: true, type: "pricing", progress: 0, message: "Reading pricing file..." })

    const reader = new FileReader()
    reader.onload = (event) => {
      try {
        setFileUploadProgress({ isLoading: true, type: "pricing", progress: 30, message: "Parsing pricing data..." })

        const text = event.target?.result as string
        const lines = text.split("\n").filter(line => line.trim())
        const headers = parseCSVLine(lines[0]).map(h => h.toLowerCase().trim())

        const nameIdx = headers.findIndex(h =>
          h === "product name" ||
          h === "description" ||
          h === "product description" ||
          h === "productdescription" ||
          h === "item description" ||
          h === "name" ||
          h === "product"
        )
        const refIdx = headers.findIndex(h => {
          const normalized = h.replace(/[\s\-_]/g, "")
          const exactMatches = [
            "product ref number", "productrefnumber", "product ref",
            "ref number", "refnumber", "ref", "reference",
            "sku", "item number", "itemnumber", "item no", "itemno",
            "item #", "vendor item no", "vendoritemno",
            "catalog number", "catalognumber", "cat no", "catno",
            "part number", "partnumber", "part no", "partno",
            "inventory number", "inventorynumber", "inv no",
            "product code", "productcode", "code",
            "material number", "materialnumber",
          ]
          return exactMatches.some(m => h === m || normalized === m.replace(/[\s\-_]/g, ""))
        })
        const priceIdx = headers.findIndex(h =>
          h === "price" ||
          h === "proposed price" ||
          h === "unit price" ||
          h === "unit cost" ||
          h === "cost" ||
          h.includes("price")
        )
        const qtyIdx = headers.findIndex(h =>
          h === "quantity" || h === "qty" || h === "volume" || h === "units"
        )
        const costIdx = headers.findIndex(h =>
          h === "cost basis" || h === "cog" || h === "cost of goods" || h === "vendor cost"
        )
        const categoryIdx = headers.findIndex(h =>
          h.includes("category") || h.includes("type") || h.includes("class")
        )

        if (nameIdx === -1 && refIdx === -1) {
          setFileUploadProgress({ isLoading: false, type: null, progress: 0, message: "" })
          toast.error("Pricing file must have a product name or reference number column")
          return
        }

        setFileUploadProgress({ isLoading: true, type: "pricing", progress: 60, message: "Loading products..." })

        const products: ProposalProduct[] = []
        let totalSpend = 0
        let totalVolume = 0
        let detectedCategory: string | null = null
        const categoryCounts: Record<string, number> = {}

        for (let i = 1; i < lines.length; i++) {
          const values = parseCSVLine(lines[i])
          const productName = nameIdx !== -1 ? values[nameIdx]?.trim() : (refIdx !== -1 ? values[refIdx]?.trim() : "")
          if (!productName) continue

          const refNumber = refIdx !== -1 ? values[refIdx]?.trim() : undefined
          const price = priceIdx !== -1 ? parseFloat(values[priceIdx]?.replace(/[$,]/g, "")) || 0 : 0
          const qty = qtyIdx !== -1 ? parseInt(values[qtyIdx]?.replace(/,/g, "")) || 0 : 0
          const costBasis = costIdx !== -1 ? parseFloat(values[costIdx]?.replace(/[$,]/g, "")) || undefined : undefined
          const category = categoryIdx !== -1 ? values[categoryIdx]?.trim() : undefined

          if (category) {
            categoryCounts[category] = (categoryCounts[category] || 0) + 1
          }

          products.push({
            benchmarkId: `pricing-${Date.now()}-${products.length}`,
            productName,
            refNumber,
            proposedPrice: price,
            projectedVolume: qty,
            costBasis,
            fromPricingFile: true,
          })

          totalSpend += price * qty
          totalVolume += qty
        }

        if (Object.keys(categoryCounts).length > 0) {
          detectedCategory = Object.entries(categoryCounts).sort((a, b) => b[1] - a[1])[0][0]
        }

        if (products.length === 0) {
          setFileUploadProgress({ isLoading: false, type: null, progress: 0, message: "" })
          toast.error("No valid products found in pricing file")
          return
        }

        setNewProposal(prev => {
          // If usage data already loaded, try to merge
          if (prev.products.length > 0 && prev.products.some(p => !p.fromPricingFile)) {
            const existingUsage = prev.products.filter(p => !p.fromPricingFile)

            const normalizeRef = (ref: string): string => {
              return (ref || "").toString().trim().toLowerCase()
                .replace(/^0+/, "").replace(/[-_.\s]/g, "").replace(/[^a-z0-9]/g, "")
            }

            let matched = 0
            for (const product of products) {
              const usageMatch = existingUsage.find(u => {
                const usageRef = normalizeRef(u.refNumber || "")
                const pricingRef = normalizeRef(product.refNumber || "")
                if (usageRef && pricingRef && (usageRef === pricingRef || usageRef.includes(pricingRef) || pricingRef.includes(usageRef))) return true
                const pNameLower = product.productName.toLowerCase()
                const uNameLower = u.productName.toLowerCase()
                return pNameLower === uNameLower || pNameLower.includes(uNameLower) || uNameLower.includes(pNameLower)
              })
              if (usageMatch) {
                product.projectedVolume = usageMatch.projectedVolume || product.projectedVolume
                product.historicalAvgPrice = usageMatch.historicalAvgPrice
                product.historicalAvgVolume = usageMatch.historicalAvgVolume
                product.monthlyUsage = usageMatch.monthlyUsage
                product.refNumber = product.refNumber || usageMatch.refNumber
                matched++
              }
            }

            toast.success(`Merged pricing with usage: ${matched} matched of ${products.length} products`)
          }

          return {
            ...prev,
            products: products,
            projectedSpend: totalSpend,
            projectedVolume: totalVolume,
            productCategory: prev.productCategory || detectedCategory || prev.productCategory,
          }
        })

        setFileUploadProgress({ isLoading: false, type: null, progress: 100, message: "" })
        toast.success(`Loaded ${products.length} products from pricing file`)
      } catch (err) {
        console.error("Pricing file parse error:", err)
        setFileUploadProgress({ isLoading: false, type: null, progress: 0, message: "" })
        toast.error("Failed to parse pricing file")
      }
    }
    reader.readAsText(file)
    e.target.value = ""
  }

  // ─── Usage file upload ─────────────────────────────────────────

  const handleUsageFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    setFileUploadProgress({ isLoading: true, type: "usage", progress: 0, message: "Reading file..." })

    const reader = new FileReader()
    reader.onload = async (event) => {
      try {
        setFileUploadProgress({ isLoading: true, type: "usage", progress: 10, message: "Parsing CSV..." })

        const text = event.target?.result as string
        const lines = text.split("\n").filter(line => line.trim())
        const headers = parseCSVLine(lines[0]).map(h => h.toLowerCase())

        const vendorIdx = headers.findIndex(h => h.includes("vendor"))
        const dateIdx = headers.findIndex(h => h.includes("date") || h.includes("ordered"))
        const nameIdx = headers.findIndex(h => h.includes("product name") || h.includes("description") || (h.includes("product") && !h.includes("ref")))
        const refIdx = headers.findIndex(h => h.includes("ref") || h.includes("sku") || h.includes("item number") || h.includes("part number"))
        const qtyIdx = headers.findIndex(h => h.includes("quantity") || h.includes("qty"))
        const unitCostIdx = headers.findIndex(h => h.includes("unit cost") || h.includes("unit price") || h.includes("price"))
        const extendedCostIdx = headers.findIndex(h =>
          h.includes("extended") || h.includes("total cost") || h.includes("line total") ||
          h.includes("amount") || h.includes("spend") || h.includes("total price") ||
          h.includes("ext cost") || h.includes("ext price") || h.includes("line amount") ||
          h.includes("invoice amount") || h.includes("cost total") || h.includes("price total") ||
          h === "total" || h === "cost" || h === "revenue"
        )
        const categoryIdx = headers.findIndex(h => h.includes("category") || h.includes("type") || h.includes("class"))

        if (nameIdx === -1) {
          setFileUploadProgress({ isLoading: false, type: null, progress: 0, message: "" })
          toast.error("Usage file must have a product name column")
          return
        }

        const productUsageMap: Record<string, {
          productName: string
          refNumber?: string
          vendor?: string
          category?: string
          transactions: {
            date: Date
            month: string
            quantity: number
            unitCost: number
            extendedCost: number
          }[]
        }> = {}

        let processedLines = 0
        const maxLines = Math.min(lines.length, 50000)
        const totalLines = maxLines - 1

        for (let i = 1; i < maxLines; i++) {
          if (i % 1000 === 0) {
            const progress = 10 + Math.round((i / totalLines) * 60)
            setFileUploadProgress({
              isLoading: true,
              type: "usage",
              progress,
              message: `Processing ${i.toLocaleString()} of ${totalLines.toLocaleString()} lines...`,
            })
            await new Promise(resolve => setTimeout(resolve, 0))
          }

          const values = parseCSVLine(lines[i])
          const productName = values[nameIdx]?.trim()
          if (!productName) continue

          const refNumber = refIdx !== -1 ? values[refIdx]?.trim() : undefined
          const key = (refNumber || productName).toLowerCase()

          if (!productUsageMap[key]) {
            productUsageMap[key] = {
              productName,
              refNumber,
              vendor: vendorIdx !== -1 ? values[vendorIdx]?.trim() : undefined,
              category: categoryIdx !== -1 ? values[categoryIdx]?.trim() : undefined,
              transactions: [],
            }
          }

          let date = new Date()
          let month = ""
          if (dateIdx !== -1 && values[dateIdx]) {
            const dateStr = values[dateIdx].trim()
            const mdyMatch = dateStr.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/)
            if (mdyMatch) {
              date = new Date(parseInt(mdyMatch[3]), parseInt(mdyMatch[1]) - 1, parseInt(mdyMatch[2]))
              month = `${mdyMatch[3]}-${mdyMatch[1].padStart(2, "0")}`
            } else {
              const ymdMatch = dateStr.match(/(\d{4})-(\d{1,2})-(\d{1,2})/)
              if (ymdMatch) {
                date = new Date(parseInt(ymdMatch[1]), parseInt(ymdMatch[2]) - 1, parseInt(ymdMatch[3]))
                month = `${ymdMatch[1]}-${ymdMatch[2].padStart(2, "0")}`
              }
            }
          }
          if (!month) {
            month = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`
          }

          const quantity = qtyIdx !== -1 ? parseInt(values[qtyIdx]?.replace(/,/g, "")) || 0 : 1
          const unitCost = unitCostIdx !== -1 ? parseFloat(values[unitCostIdx]?.replace(/[$,]/g, "")) || 0 : 0
          const extendedCost = extendedCostIdx !== -1 ? parseFloat(values[extendedCostIdx]?.replace(/[$,]/g, "")) || (unitCost * quantity) : (unitCost * quantity)

          productUsageMap[key].transactions.push({
            date,
            month,
            quantity,
            unitCost,
            extendedCost,
          })
          processedLines++
        }

        const products: ProposalProduct[] = []
        let totalVolume = 0
        let totalRevenue = 0
        const categoryCounts: Record<string, number> = {}

        for (const [, data] of Object.entries(productUsageMap)) {
          const monthlyAggregates: Record<string, { volume: number; revenue: number; totalUnitCost: number; count: number }> = {}

          for (const tx of data.transactions) {
            if (!monthlyAggregates[tx.month]) {
              monthlyAggregates[tx.month] = { volume: 0, revenue: 0, totalUnitCost: 0, count: 0 }
            }
            monthlyAggregates[tx.month].volume += tx.quantity
            monthlyAggregates[tx.month].revenue += tx.extendedCost
            monthlyAggregates[tx.month].totalUnitCost += tx.unitCost
            monthlyAggregates[tx.month].count++
          }

          const monthlyUsage: MonthlyUsage[] = Object.entries(monthlyAggregates)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([m, agg]) => ({
              month: m,
              volume: agg.volume,
              revenue: agg.revenue,
              avgPrice: agg.count > 0 ? agg.totalUnitCost / agg.count : 0,
            }))

          const totalVol = monthlyUsage.reduce((sum, m) => sum + m.volume, 0)
          const totalRev = monthlyUsage.reduce((sum, m) => sum + m.revenue, 0)
          const avgPrice = monthlyUsage.length > 0
            ? monthlyUsage.reduce((sum, m) => sum + m.avgPrice, 0) / monthlyUsage.length
            : 0

          if (data.category) {
            categoryCounts[data.category] = (categoryCounts[data.category] || 0) + 1
          }

          products.push({
            benchmarkId: `usage-${Date.now()}-${products.length}`,
            productName: data.productName,
            refNumber: data.refNumber,
            proposedPrice: 0,
            fromPricingFile: false,
            projectedVolume: totalVol,
            historicalAvgPrice: avgPrice,
            historicalAvgVolume: totalVol,
            monthlyUsage: monthlyUsage.length > 0 ? monthlyUsage : undefined,
          })

          totalVolume += totalVol
          totalRevenue += totalRev
        }

        let detectedCategory: string | null = null
        if (Object.keys(categoryCounts).length > 0) {
          detectedCategory = Object.entries(categoryCounts).sort((a, b) => b[1] - a[1])[0][0]
        }

        if (products.length === 0) {
          setFileUploadProgress({ isLoading: false, type: null, progress: 0, message: "" })
          toast.error("No valid product data found in usage file")
          return
        }

        setFileUploadProgress({ isLoading: true, type: "usage", progress: 90, message: "Matching with pricing data..." })

        products.sort((a, b) => {
          const aRev = a.monthlyUsage?.reduce((sum, m) => sum + m.revenue, 0) || 0
          const bRev = b.monthlyUsage?.reduce((sum, m) => sum + m.revenue, 0) || 0
          return bRev - aRev
        })

        let matchedWithPricing = 0
        let addedNew = 0

        setNewProposal(prev => {
          if (prev.products.length > 0) {
            const updatedProducts = [...prev.products]

            const normalizeRef = (ref: string): string => {
              return (ref || "").toString().trim().toLowerCase()
                .replace(/^0+/, "").replace(/[-_.\s]/g, "").replace(/[^a-z0-9]/g, "")
            }

            for (const usageProduct of products) {
              const existingIdx = updatedProducts.findIndex(p => {
                const usageRef = normalizeRef(usageProduct.refNumber || "")
                const pricingRef = normalizeRef(p.refNumber || "")
                if (usageRef && pricingRef && (usageRef === pricingRef || usageRef.includes(pricingRef) || pricingRef.includes(usageRef))) return true
                const pNameLower = p.productName.toLowerCase()
                const usageNameLower = usageProduct.productName.toLowerCase()
                return pNameLower === usageNameLower || pNameLower.includes(usageNameLower) || usageNameLower.includes(pNameLower)
              })

              if (existingIdx !== -1) {
                updatedProducts[existingIdx] = {
                  ...updatedProducts[existingIdx],
                  projectedVolume: usageProduct.projectedVolume,
                  historicalAvgPrice: usageProduct.historicalAvgPrice,
                  historicalAvgVolume: usageProduct.historicalAvgVolume,
                  monthlyUsage: usageProduct.monthlyUsage,
                  refNumber: updatedProducts[existingIdx].refNumber || usageProduct.refNumber,
                }
                matchedWithPricing++
              } else {
                addedNew++
              }
            }

            return {
              ...prev,
              products: updatedProducts,
              projectedSpend: prev.projectedSpend + totalRevenue,
              projectedVolume: prev.projectedVolume + totalVolume,
              totalOpportunity: prev.totalOpportunity + totalRevenue,
              productCategory: prev.productCategory || detectedCategory || prev.productCategory,
            }
          } else {
            addedNew = products.length
            return {
              ...prev,
              products: [...prev.products, ...products],
              projectedSpend: prev.projectedSpend + totalRevenue,
              projectedVolume: prev.projectedVolume + totalVolume,
              totalOpportunity: prev.totalOpportunity + totalRevenue,
              productCategory: prev.productCategory || detectedCategory || prev.productCategory,
            }
          }
        })

        setFileUploadProgress({ isLoading: false, type: null, progress: 100, message: "" })

        if (lines.length > maxLines) {
          toast.warning(`File truncated: processed first ${maxLines - 1} lines of ${lines.length - 1}`)
        }

        const matchInfo = matchedWithPricing > 0 ? ` Matched ${matchedWithPricing} products with pricing data.` : ""
        const skippedInfo = addedNew > 0 ? ` (${addedNew} usage-only products not in pricing file)` : ""
        toast.success(
          `Processed ${products.length} products from ${processedLines.toLocaleString()} transactions.` +
          matchInfo + skippedInfo
        )
      } catch (err) {
        console.error("Usage file parse error:", err)
        setFileUploadProgress({ isLoading: false, type: null, progress: 0, message: "" })
        toast.error("Failed to parse usage file")
      }
    }
    reader.readAsText(file)
    e.target.value = ""
  }

  // ─── AI product generation ─────────────────────────────────────

  const generateProductsFromAI = useCallback(async () => {
    if (!aiProductDescription.trim()) {
      toast.error("Enter a product description first")
      return
    }

    setIsGeneratingAI(true)
    await new Promise(resolve => setTimeout(resolve, 1500))

    const descriptionLines = aiProductDescription.split("\n").filter(l => l.trim())
    const products: ProposalProduct[] = []
    let totalSpend = 0
    let totalVolume = 0

    const fullText = aiProductDescription.toLowerCase()
    const categoryKeywords: Record<string, string[]> = {
      "Ortho-Spine": ["hip", "knee", "spine", "spinal", "orthopedic", "joint", "arthroplasty", "fusion", "implant"],
      "Cardiovascular": ["stent", "pacemaker", "cardiac", "heart", "vascular", "catheter", "angioplasty"],
      "Biologics": ["graft", "tissue", "biologic", "prp", "regenerat", "bone substitute", "allograft"],
      "General Surgery": ["surgical", "instrument", "stapler", "suture", "laparoscop"],
      "Disposables": ["glove", "gown", "mask", "syringe", "bandage", "gauze"],
    }
    let detectedCategory: string | null = null
    let maxMatches = 0
    for (const [category, keywords] of Object.entries(categoryKeywords)) {
      const matches = keywords.filter(kw => fullText.includes(kw)).length
      if (matches > maxMatches) {
        maxMatches = matches
        detectedCategory = category
      }
    }

    for (const line of descriptionLines) {
      const priceMatch = line.match(/\$?([\d,]+(?:\.\d{2})?)/g)
      const volumeMatch = line.match(/(\d+)\s*(?:units?|qty|quantity|pcs?|pieces?)/i)

      let productName = line
        .replace(/\$?[\d,]+(?:\.\d{2})?/g, "")
        .replace(/\d+\s*(?:units?|qty|quantity|pcs?|pieces?)/gi, "")
        .replace(/[-@:]/g, "")
        .trim()

      if (productName.length > 3) {
        const price = priceMatch ? parseFloat(priceMatch[0].replace(/[$,]/g, "")) || 5000 : 5000
        const volume = volumeMatch ? parseInt(volumeMatch[1]) : 50

        products.push({
          benchmarkId: `ai-${Date.now()}-${products.length}`,
          productName: productName.substring(0, 50),
          proposedPrice: price,
          projectedVolume: volume,
        })
        totalSpend += price * volume
        totalVolume += volume
      }
    }

    if (products.length === 0) {
      products.push({
        benchmarkId: `ai-${Date.now()}`,
        productName: aiProductDescription.substring(0, 50),
        proposedPrice: 5000,
        projectedVolume: 50,
      })
      totalSpend = 250000
      totalVolume = 50
    }

    setNewProposal(prev => ({
      ...prev,
      products: [...prev.products, ...products],
      projectedSpend: prev.projectedSpend + totalSpend,
      projectedVolume: prev.projectedVolume + totalVolume,
      productCategory: prev.productCategory || detectedCategory || prev.productCategory,
    }))

    setIsGeneratingAI(false)
    setAiProductDescription("")
    const categoryMsg = detectedCategory && !newProposal.productCategory ? ` (Category: ${detectedCategory})` : ""
    toast.success(`Generated ${products.length} product${products.length > 1 ? "s" : ""} from description${categoryMsg}`)
  }, [aiProductDescription, newProposal.productCategory])

  // ─── Estimated rebate ──────────────────────────────────────────

  const calculateEstimatedRebate = () => {
    let total = 0
    newProposal.terms.forEach(term => {
      if (term.termType === "spend_rebate" && newProposal.projectedSpend >= term.targetValue) {
        total += newProposal.projectedSpend * (term.rebatePercent / 100)
      } else if (term.termType === "volume_rebate" && newProposal.projectedVolume >= term.targetValue) {
        total += newProposal.projectedSpend * (term.rebatePercent / 100)
      }
    })
    return total
  }

  // ─── Submit ────────────────────────────────────────────────────

  const handleResetAndClose = () => {
    setNewProposal({
      facilityId: "",
      facilityName: "",
      isMultiFacility: false,
      facilities: [],
      productCategory: "",
      productCategories: [],
      isGrouped: false,
      groupName: "",
      contractLength: 24,
      projectedSpend: 0,
      projectedVolume: 0,
      totalOpportunity: 0,
      terms: [],
      products: [],
      marketShareCommitment: 50,
      gpoFee: 3,
      aiNotes: "",
    })
    setAiProductDescription("")
    onClose?.()
  }

  const submitProposal = async () => {
    if (!newProposal.facilityId && !newProposal.isMultiFacility) {
      // Allow submission without facility selection (manual entry)
    }

    if (!newProposal.productCategory && newProposal.productCategories.length === 0) {
      toast.error("Please select at least one product category")
      return
    }

    // Build facilityIds
    const facilityIds: string[] = []
    if (newProposal.facilityId) facilityIds.push(newProposal.facilityId)
    if (newProposal.isMultiFacility) {
      for (const f of newProposal.facilities) {
        if (!facilityIds.includes(f.id)) facilityIds.push(f.id)
      }
    }

    // Convert products to ProposedPricingItem format
    const pricingItems: ProposedPricingItem[] = newProposal.products
      .filter(p => p.proposedPrice > 0)
      .map(p => ({
        vendorItemNo: p.refNumber || p.benchmarkId,
        description: p.productName,
        proposedPrice: p.proposedPrice,
        quantity: p.projectedVolume || 1,
      }))

    if (pricingItems.length === 0) {
      toast.error("Please add at least one product with pricing")
      return
    }

    try {
      await createMutation.mutateAsync({
        vendorId,
        facilityIds: facilityIds.length > 0 ? facilityIds : ["none"],
        pricingItems,
        terms: {
          contractLength: newProposal.contractLength,
          startDate: new Date().toISOString().split("T")[0],
          notes: newProposal.aiNotes || undefined,
        },
      })
      handleResetAndClose()
    } catch {
      // Error toast handled by mutation
    }
  }

  // ─── Analyze deal (placeholder) ────────────────────────────────

  const analyzeTheDeal = useCallback(async () => {
    toast.error("AI features require Vercel billing setup. Add a credit card to enable AI analysis.")
  }, [])

  // ─── Render ────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
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

      <div className="space-y-6">
        {/* Multi-facility and Grouped Options */}
        <div className="grid grid-cols-2 gap-4 p-4 rounded-lg border bg-muted/30">
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

        <Separator />

        {/* AI Notes for Deal Analysis */}
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            <Label className="text-base font-semibold">AI Deal Notes</Label>
            <Badge variant="outline" className="text-xs">Optional</Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            Add context about this deal - competitor info, customer priorities, urgency, relationship history.
            AI will analyze these notes to generate deal terms and scoring insights.
          </p>
          <Textarea
            placeholder="Example: Customer is evaluating a competing offer from MedTech Corp at 15% lower pricing. They're interested in a 3-year exclusive partnership if we can match the price. Decision needed by end of month. Strong relationship with their orthopedic department - they've been a customer for 5 years."
            value={newProposal.aiNotes}
            onChange={(e) => setNewProposal(prev => ({ ...prev, aiNotes: e.target.value }))}
            className="min-h-[100px] resize-none"
          />

          <p className="text-xs text-muted-foreground">
            Enter deal context then click the button below to generate terms automatically.
          </p>

          {/* Generate AI Terms Button */}
          {newProposal.aiNotes.trim() ? (
            <Button
              variant="default"
              className="mt-3 gap-2 w-full"
              onClick={() => {
                const notes = newProposal.aiNotes.toLowerCase()
                const generatedTerms: ProspectiveTerm[] = []

                // Parse notes and generate actual deal terms
                const spendMatch = newProposal.aiNotes.match(/\$?([\d,.]+)\s*(million|m|k|thousand)?\s*(annual\s*)?(spend|revenue)?/i)

                if (spendMatch || notes.includes("spend") || notes.includes("annual")) {
                  let targetValue = newProposal.projectedSpend || 500000
                  if (spendMatch && spendMatch[1]) {
                    const num = parseFloat(spendMatch[1].replace(/,/g, ""))
                    const multiplier = spendMatch[2]?.toLowerCase()
                    if (multiplier === "million" || multiplier === "m") {
                      targetValue = num * 1000000
                    } else if (multiplier === "k" || multiplier === "thousand") {
                      targetValue = num * 1000
                    } else {
                      targetValue = num
                    }
                  }
                  generatedTerms.push({
                    id: `ai-spend-${Date.now()}`,
                    termType: "spend_rebate",
                    name: "Annual Spend Rebate",
                    targetType: "spend",
                    targetValue,
                    rebatePercent: 3,
                    tiers: [],
                  })
                }

                // Market share commitment
                const shareMatch = newProposal.aiNotes.match(/(\d+)\s*%?\s*(?:market\s*)?share/i)
                if (shareMatch || notes.includes("market share") || notes.includes("exclusive") || notes.includes("primary") || notes.includes("partnership")) {
                  const sharePercent = shareMatch ? parseInt(shareMatch[1]) : 70
                  generatedTerms.push({
                    id: `ai-share-${Date.now()}`,
                    termType: "market_share_rebate",
                    name: "Market Share Commitment",
                    targetType: "market_share",
                    targetValue: sharePercent,
                    rebatePercent: 2,
                    tiers: [],
                  })
                  setNewProposal(prev => ({ ...prev, marketShareCommitment: sharePercent }))
                }

                // Contract length from notes
                const yearMatch = newProposal.aiNotes.match(/(\d+)\s*-?\s*year/i)
                if (yearMatch) {
                  const years = parseInt(yearMatch[1])
                  setNewProposal(prev => ({ ...prev, contractLength: years * 12 }))
                }

                // Growth incentive
                if (notes.includes("growth") || notes.includes("increase") || notes.includes("expand")) {
                  generatedTerms.push({
                    id: `ai-growth-${Date.now()}`,
                    termType: "volume_rebate",
                    name: "Growth Incentive Rebate",
                    targetType: "volume",
                    targetValue: 10,
                    rebatePercent: 2,
                    tiers: [],
                  })
                }

                // Tiered volume rebate
                if (notes.includes("tier") || notes.includes("volume") || notes.includes("incentive")) {
                  generatedTerms.push({
                    id: `ai-tiered-${Date.now()}`,
                    termType: "volume_rebate",
                    name: "Tiered Volume Rebate",
                    targetType: "volume",
                    targetValue: newProposal.projectedVolume || 100,
                    rebatePercent: 0,
                    tiers: [
                      { threshold: 100, rebatePercent: 1 },
                      { threshold: 250, rebatePercent: 2 },
                      { threshold: 500, rebatePercent: 3 },
                    ],
                  })
                }

                if (generatedTerms.length > 0) {
                  setNewProposal(prev => {
                    const existingTypes = prev.terms.map(t => t.termType)
                    const newTerms = generatedTerms.filter(t => !existingTypes.includes(t.termType))
                    return {
                      ...prev,
                      terms: [...prev.terms, ...newTerms],
                    }
                  })
                  toast.success(`AI generated ${generatedTerms.length} deal term(s) from your notes. Review them in the Terms section below.`)
                } else {
                  setNewProposal(prev => ({
                    ...prev,
                    terms: [...prev.terms, {
                      id: `ai-default-${Date.now()}`,
                      termType: "spend_rebate",
                      name: "Standard Spend Rebate",
                      targetType: "spend",
                      targetValue: prev.projectedSpend || 500000,
                      rebatePercent: 2.5,
                      tiers: [],
                    }],
                  }))
                  toast.info("Generated a standard spend rebate term. Add more details to your notes for specific terms.")
                }
              }}
            >
              <Sparkles className="h-4 w-4" />
              Generate Deal Terms from Notes
            </Button>
          ) : (
            <Button
              variant="outline"
              className="mt-3 gap-2 w-full"
              disabled
            >
              <Sparkles className="h-4 w-4" />
              Enter notes above to generate terms
            </Button>
          )}

          {/* Auto-analysis hint */}
          {newProposal.products.filter(p => p.proposedPrice > 0).length === 0 && (
            <p className="text-xs text-muted-foreground mt-2">
              Upload pricing and usage files to get AI-powered deal analysis and negotiation suggestions.
            </p>
          )}

          {/* AI Analysis Loading State */}
          {aiSuggestions.isLoading && (
            <div className="mt-3 p-4 rounded-lg bg-muted/50 border border-dashed">
              <div className="flex items-center gap-3">
                <Loader2 className="h-5 w-5 text-primary animate-spin" />
                <div>
                  <p className="text-sm font-medium">Analyzing your deal...</p>
                  <p className="text-xs text-muted-foreground">Generating negotiation strategies and term suggestions</p>
                </div>
              </div>
            </div>
          )}

          {/* AI Suggestions Display */}
          {aiSuggestions.data && !aiSuggestions.isLoading && (
            <div className="mt-3 space-y-3">
              {/* Deal Strength Header */}
              <div className={`p-3 rounded-lg border ${
                aiSuggestions.data.dealStrength === "strong"
                  ? "bg-green-50 dark:bg-green-950/30 border-green-300 dark:border-green-700"
                  : aiSuggestions.data.dealStrength === "weak"
                  ? "bg-red-50 dark:bg-red-950/30 border-red-300 dark:border-red-700"
                  : "bg-amber-50 dark:bg-amber-950/30 border-amber-300 dark:border-amber-700"
              }`}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Sparkles className={`h-4 w-4 ${
                      aiSuggestions.data.dealStrength === "strong"
                        ? "text-green-600"
                        : aiSuggestions.data.dealStrength === "weak"
                        ? "text-red-600"
                        : "text-amber-600"
                    }`} />
                    <span className="text-sm font-semibold">
                      Deal Strength: {(aiSuggestions.data.dealStrength || "moderate").charAt(0).toUpperCase() + (aiSuggestions.data.dealStrength || "moderate").slice(1)}
                    </span>
                  </div>
                  {aiSuggestions.data.recommendedDiscount && (
                    <Badge variant="outline" className="text-xs">
                      Suggested Discount: {aiSuggestions.data.recommendedDiscount}
                    </Badge>
                  )}
                </div>
              </div>

              {/* Negotiation Advice */}
              {aiSuggestions.data.negotiationAdvice && aiSuggestions.data.negotiationAdvice.length > 0 && (
                <div className="p-3 rounded-lg bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800">
                  <p className="text-xs font-semibold text-blue-700 dark:text-blue-400 mb-2 flex items-center gap-1">
                    <Target className="h-3 w-3" />
                    Negotiation Tactics
                  </p>
                  <ul className="text-xs text-blue-600 dark:text-blue-300 space-y-1">
                    {aiSuggestions.data.negotiationAdvice.map((advice: string, i: number) => (
                      <li key={i} className="flex items-start gap-2">
                        <span className="text-blue-400">&bull;</span>
                        <span>{advice}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Suggested Terms */}
              {aiSuggestions.data.suggestedTerms && aiSuggestions.data.suggestedTerms.length > 0 && (
                <div className="p-3 rounded-lg bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800">
                  <p className="text-xs font-semibold text-green-700 dark:text-green-400 mb-2 flex items-center gap-1">
                    <FileText className="h-3 w-3" />
                    Suggested Terms
                  </p>
                  <div className="space-y-2">
                    {aiSuggestions.data.suggestedTerms.map((term, i) => (
                      <div key={i} className="text-xs">
                        <p className="font-medium text-green-700 dark:text-green-300">{term.type}</p>
                        <p className="text-green-600 dark:text-green-400">{term.description}</p>
                        <p className="text-green-500 dark:text-green-500 italic text-[10px]">{term.rationale}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Urgency & Timeline */}
              {aiSuggestions.data.urgencyAssessment && (
                <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800">
                  <p className="text-xs font-semibold text-amber-700 dark:text-amber-400 mb-1 flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    Timeline Assessment
                  </p>
                  <p className="text-xs text-amber-600 dark:text-amber-300">{aiSuggestions.data.urgencyAssessment}</p>
                </div>
              )}

              {/* Competitive Strategy */}
              {aiSuggestions.data.competitiveStrategy && (
                <div className="p-3 rounded-lg bg-purple-50 dark:bg-purple-950/30 border border-purple-200 dark:border-purple-800">
                  <p className="text-xs font-semibold text-purple-700 dark:text-purple-400 mb-1 flex items-center gap-1">
                    <Users className="h-3 w-3" />
                    Competitive Strategy
                  </p>
                  <p className="text-xs text-purple-600 dark:text-purple-300">{aiSuggestions.data.competitiveStrategy}</p>
                </div>
              )}

              {/* Risk Factors */}
              {aiSuggestions.data.riskFactors && aiSuggestions.data.riskFactors.length > 0 && (
                <div className="p-3 rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800">
                  <p className="text-xs font-semibold text-red-700 dark:text-red-400 mb-1 flex items-center gap-1">
                    <AlertTriangle className="h-3 w-3" />
                    Risk Factors
                  </p>
                  <ul className="text-xs text-red-600 dark:text-red-300 space-y-1">
                    {aiSuggestions.data.riskFactors.map((risk: string, i: number) => (
                      <li key={i}>&bull; {risk}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Re-analyze button */}
              <Button
                variant="ghost"
                size="sm"
                className="w-full text-xs"
                onClick={() => {
                  lastAnalyzedRef.current = ""
                  analyzeTheDeal()
                }}
              >
                Re-analyze with updated notes
              </Button>
            </div>
          )}
        </div>

        <Separator />

        {/* Products Section */}
        <div>
          <div className="flex items-center justify-between mb-4">
            <Label className="text-base font-semibold">Products / Pricing</Label>
            <div className="flex items-center gap-2">
              <Badge variant="outline">{newProposal.products.length} products</Badge>
            </div>
          </div>

          {/* File Upload Progress Indicator */}
          {fileUploadProgress.isLoading && (
            <div className="mb-4 p-4 rounded-lg bg-primary/5 border border-primary/20 animate-pulse">
              <div className="flex items-center gap-3 mb-2">
                <Loader2 className="h-5 w-5 text-primary animate-spin" />
                <span className="font-medium text-sm">
                  {fileUploadProgress.type === "usage" && "Processing Usage History"}
                  {fileUploadProgress.type === "pricing" && "Processing Pricing File"}
                </span>
              </div>
              <div className="w-full bg-muted rounded-full h-2 mb-2">
                <div
                  className="bg-primary h-2 rounded-full transition-all duration-300"
                  style={{ width: `${fileUploadProgress.progress}%` }}
                />
              </div>
              <p className="text-xs text-muted-foreground">{fileUploadProgress.message}</p>
            </div>
          )}

          {/* Workflow Guide */}
          {!fileUploadProgress.isLoading && (
            <div className="mb-4 p-3 rounded-lg bg-muted/50 border">
              <p className="text-xs font-medium text-foreground mb-2">Recommended Workflow:</p>
              <ol className="text-xs text-muted-foreground space-y-1 list-decimal list-inside">
                <li>Load <strong>Usage History</strong> (12-month PO data with pricing, volume, ref numbers)</li>
                <li>Load <strong>Proposed Pricing</strong> (your new prices for this deal)</li>
                <li>Add <strong>AI Notes</strong> describing the deal situation</li>
              </ol>
            </div>
          )}

          {/* Load Products Options */}
          <div className="grid gap-4 sm:grid-cols-2 mb-4">
            {/* Usage File Upload */}
            <div className="p-4 border rounded-lg border-dashed bg-blue-50/50 dark:bg-blue-950/10">
              <div className="flex items-center gap-2 mb-2">
                <History className="h-4 w-4 text-blue-600" />
                <span className="font-medium text-sm">Upload Usage History</span>
                <Badge variant="secondary" className="text-xs">Recommended</Badge>
              </div>
              <p className="text-xs text-muted-foreground mb-3">
                Load 12-month historical usage with product names, ref numbers, pricing, and volume. This provides the baseline for deal analysis.
              </p>
              <div className="relative">
                <Input
                  type="file"
                  accept=".csv,.txt,.xlsx,.xls"
                  onChange={handleUsageFileUpload}
                  className="cursor-pointer"
                  disabled={fileUploadProgress.isLoading}
                />
              </div>
              {newProposal.products.some(p => p.monthlyUsage && p.monthlyUsage.length > 0) && (
                <div className="mt-2 p-2 rounded bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800">
                  <p className="text-xs text-blue-700 dark:text-blue-400 flex items-center gap-1">
                    <CheckCircle2 className="h-3 w-3" />
                    {newProposal.products.filter(p => p.monthlyUsage && p.monthlyUsage.length > 0).length} products with historical data
                  </p>
                  <p className="text-xs text-blue-600 dark:text-blue-500 mt-1">
                    Avg {Math.round(newProposal.products.filter(p => p.monthlyUsage).reduce((sum, p) => sum + (p.monthlyUsage?.length || 0), 0) / Math.max(1, newProposal.products.filter(p => p.monthlyUsage).length))} months of history per product
                  </p>
                </div>
              )}
            </div>

            {/* Proposed Pricing File Upload */}
            <div className="p-4 border rounded-lg border-dashed">
              <div className="flex items-center gap-2 mb-2">
                <Upload className="h-4 w-4 text-primary" />
                <span className="font-medium text-sm">Upload Proposed Pricing</span>
              </div>
              <p className="text-xs text-muted-foreground mb-3">
                Load your proposed pricing for this deal. Will merge with usage data if product names match.
              </p>
              <div className="relative">
                <Input
                  type="file"
                  accept=".csv,.txt,.xlsx,.xls"
                  onChange={handlePricingFileUpload}
                  className="cursor-pointer"
                  disabled={fileUploadProgress.isLoading}
                />
              </div>
              {newProposal.products.some(p => p.proposedPrice > 0) && (
                <div className="mt-2 p-2 rounded bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-800">
                  <p className="text-xs text-green-700 dark:text-green-400 flex items-center gap-1">
                    <CheckCircle2 className="h-3 w-3" />
                    {newProposal.products.filter(p => p.proposedPrice > 0).length} products loaded from pricing file
                  </p>
                  {(() => {
                    const pricingProducts = newProposal.products.filter(p => p.proposedPrice > 0)
                    const matchedWithUsage = pricingProducts.filter(p => p.projectedVolume > 0).length
                    const avgPrice = pricingProducts.reduce((sum, p) => sum + p.proposedPrice, 0) / pricingProducts.length
                    return (
                      <>
                        <p className="text-xs text-green-600 dark:text-green-500 mt-1">
                          {matchedWithUsage} matched with usage data ({Math.round((matchedWithUsage / pricingProducts.length) * 100)}%)
                        </p>
                        <p className="text-xs text-green-600 dark:text-green-500">
                          Avg price: ${avgPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </p>
                      </>
                    )
                  })()}
                </div>
              )}
            </div>

            {/* AI Generation */}
            <div className="p-4 border rounded-lg border-dashed">
              <div className="flex items-center gap-2 mb-2">
                <Sparkles className="h-4 w-4 text-primary" />
                <span className="font-medium text-sm">Generate with AI</span>
              </div>
              <p className="text-xs text-muted-foreground mb-3">
                Describe products in natural language, one per line
              </p>
              <div className="space-y-2">
                <Textarea
                  placeholder={"Primary Hip System $8,500 50 units\nRevision Hip System $12,000 30 units\nSpinal Fusion Kit $15,000"}
                  value={aiProductDescription}
                  onChange={(e) => setAiProductDescription(e.target.value)}
                  className="text-sm h-20 resize-none"
                />
                <Button
                  size="sm"
                  variant="outline"
                  className="w-full"
                  onClick={generateProductsFromAI}
                  disabled={isGeneratingAI || !aiProductDescription.trim()}
                >
                  {isGeneratingAI ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Generating...
                    </>
                  ) : (
                    <>
                      <Sparkles className="mr-2 h-4 w-4" />
                      Generate Products
                    </>
                  )}
                </Button>
              </div>
            </div>
          </div>

          {/* Products List */}
          {newProposal.products.length === 0 ? (
            <div className="text-center py-6 text-muted-foreground border rounded-lg">
              <Package className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p>No products added yet</p>
              <p className="text-sm">Upload a pricing file or use AI to add products</p>
            </div>
          ) : (() => {
            const pricingProducts = newProposal.products.filter(p => p.proposedPrice > 0)
            const usageOnlyProducts = newProposal.products.filter(p => p.proposedPrice === 0 && p.projectedVolume > 0)

            return (
              <>
                {/* Proposed Pricing Products */}
                {pricingProducts.length > 0 && (
                  <div className="space-y-2 max-h-64 overflow-y-auto">
                    <p className="text-xs font-medium text-muted-foreground mb-2">
                      Proposed Pricing ({pricingProducts.length} products)
                    </p>
                    {[...pricingProducts]
                      .sort((a, b) => {
                        const aSpend = a.projectedVolume > 0 ? a.proposedPrice * a.projectedVolume : 0
                        const bSpend = b.projectedVolume > 0 ? b.proposedPrice * b.projectedVolume : 0
                        if (aSpend > 0 && bSpend > 0) return bSpend - aSpend
                        if (aSpend > 0 && bSpend === 0) return -1
                        if (aSpend === 0 && bSpend > 0) return 1
                        return b.proposedPrice - a.proposedPrice
                      })
                      .map((product, idx) => (
                        <div key={`${product.benchmarkId}-${idx}`} className="flex items-center justify-between p-3 border rounded-lg bg-muted/30">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              {product.refNumber && (
                                <span className="text-xs font-mono bg-muted px-1.5 py-0.5 rounded">{product.refNumber}</span>
                              )}
                              <p className="font-medium text-sm truncate">{product.productName}</p>
                            </div>
                            <div className="flex items-center gap-3 text-xs text-muted-foreground mt-1">
                              <span className="font-semibold text-foreground">${product.proposedPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}/unit</span>
                              {product.projectedVolume > 0 ? (
                                <>
                                  <span>{product.projectedVolume.toLocaleString()} units used</span>
                                  <span className="text-primary font-medium">
                                    {formatCurrencyShort(product.proposedPrice * product.projectedVolume)}
                                  </span>
                                </>
                              ) : (
                                <span className="text-amber-600">No usage data</span>
                              )}
                            </div>
                          </div>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 shrink-0"
                            onClick={() => removeProductFromProposal(product.benchmarkId)}
                          >
                            <Trash2 className="h-4 w-4 text-muted-foreground" />
                          </Button>
                        </div>
                      ))}
                  </div>
                )}

                {/* Usage-only products */}
                {usageOnlyProducts.length > 0 && (
                  <div className="mt-4 p-3 rounded-lg bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800">
                    <p className="text-xs font-medium text-amber-700 dark:text-amber-400 mb-2">
                      Additional Opportunity ({usageOnlyProducts.length} products not in pricing)
                    </p>
                    <p className="text-xs text-amber-600 dark:text-amber-500 mb-2">
                      These products were used by the facility but are not in your proposed pricing.
                      Total spend: {formatCurrencyShort(usageOnlyProducts.reduce((sum, p) => {
                        const historicalSpend = p.monthlyUsage?.reduce((s, m) => s + m.revenue, 0) ||
                                               (p.historicalAvgPrice || 0) * p.projectedVolume
                        return sum + historicalSpend
                      }, 0))}
                    </p>
                    <details className="text-xs">
                      <summary className="cursor-pointer text-amber-700 dark:text-amber-400 hover:underline">
                        View {usageOnlyProducts.length} unmatched products
                      </summary>
                      <div className="mt-2 space-y-1 max-h-32 overflow-y-auto">
                        {usageOnlyProducts.slice(0, 20).map((product, idx) => (
                          <div key={`usage-${product.benchmarkId}-${idx}`} className="flex justify-between text-amber-600 dark:text-amber-500">
                            <span className="truncate">{product.refNumber || product.productName}</span>
                            <span>{product.projectedVolume.toLocaleString()} units</span>
                          </div>
                        ))}
                        {usageOnlyProducts.length > 20 && (
                          <p className="text-amber-500">...and {usageOnlyProducts.length - 20} more</p>
                        )}
                      </div>
                    </details>
                  </div>
                )}
              </>
            )
          })()}

          {/* Products Summary */}
          {newProposal.products.length > 0 && (() => {
            const pricingProducts = newProposal.products.filter(p => p.proposedPrice > 0)
            const usageOnlyProducts = newProposal.products.filter(p => p.proposedPrice === 0 && p.projectedVolume > 0)
            const hasPricing = pricingProducts.length > 0
            const productsWithVolume = newProposal.products.filter(p => p.proposedPrice > 0 && p.projectedVolume > 0)
            const totalProducts = pricingProducts.length
            const totalVolume = productsWithVolume.reduce((sum, p) => sum + p.projectedVolume, 0)
            const proposedValue = productsWithVolume.reduce((sum, p) => sum + p.proposedPrice * p.projectedVolume, 0)
            const additionalOpportunity = usageOnlyProducts.reduce((sum, p) => {
              const historicalSpend = p.monthlyUsage?.reduce((s, m) => s + m.revenue, 0) ||
                                     (p.historicalAvgPrice || 0) * p.projectedVolume
              return sum + historicalSpend
            }, 0)
            const totalOpportunity = newProposal.totalOpportunity

            return (
              <div className="mt-4 p-3 rounded-lg bg-primary/5 border border-primary/20">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-center text-sm">
                  <div>
                    <p className="text-xs text-muted-foreground">Proposed Products</p>
                    <p className="font-semibold">{hasPricing ? totalProducts.toLocaleString() : "-"}</p>
                    {hasPricing && productsWithVolume.length > 0 && (
                      <p className="text-[10px] text-muted-foreground">{productsWithVolume.length.toLocaleString()} with volume</p>
                    )}
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Volume</p>
                    <p className="font-semibold">{hasPricing ? totalVolume.toLocaleString() : "-"}</p>
                    {!hasPricing && (
                      <p className="text-[10px] text-muted-foreground">Load pricing file</p>
                    )}
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Proposed Value</p>
                    <p className="font-semibold text-primary">
                      {hasPricing ? formatCurrencyShort(proposedValue) : "-"}
                    </p>
                    {hasPricing && totalOpportunity > 0 && (
                      <p className="text-[10px] text-muted-foreground">
                        {((proposedValue / totalOpportunity) * 100).toFixed(0)}% of opportunity
                      </p>
                    )}
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Total Opportunity</p>
                    <p className="font-semibold text-green-600">
                      {totalOpportunity > 0 ? formatCurrencyShort(totalOpportunity) : "-"}
                    </p>
                    {hasPricing && additionalOpportunity > 0 && (
                      <p className="text-[10px] text-amber-600">+{formatCurrencyShort(additionalOpportunity)} unpriced</p>
                    )}
                  </div>
                </div>
              </div>
            )
          })()}
        </div>

        <Separator />

        {/* Contract Terms */}
        <div>
          <div className="flex items-center justify-between mb-4">
            <Label className="text-base font-semibold">Proposed Terms</Label>
            <Button variant="outline" size="sm" onClick={addTerm}>
              <Plus className="mr-2 h-4 w-4" />
              Add Term
            </Button>
          </div>

          {newProposal.terms.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground border rounded-lg border-dashed">
              <Calculator className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p>No terms added yet</p>
              <p className="text-sm">Add rebate or pricing terms to your proposal</p>
            </div>
          ) : (
            <div className="space-y-4">
              {newProposal.terms.map((term, index) => (
                <div key={term.id} className="p-4 border rounded-lg space-y-3">
                  <div className="flex items-center justify-between">
                    <Badge variant="secondary">Term {index + 1}</Badge>
                    <Button variant="ghost" size="icon" onClick={() => removeTerm(term.id)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-3">
                    <div className="space-y-1">
                      <Label className="text-xs flex items-center gap-1">
                        Term Type
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <HelpCircle className="h-3 w-3 text-muted-foreground cursor-help" />
                          </TooltipTrigger>
                          <TooltipContent side="right" className="max-w-xs">
                            <p className="font-medium mb-1">Contract Term Types</p>
                            <p className="text-xs">Choose how rebates are calculated. Each type uses different metrics (spend, volume, or market share) to determine rebate amounts.</p>
                          </TooltipContent>
                        </Tooltip>
                      </Label>
                      <Select
                        value={term.termType}
                        onValueChange={(v) => updateTerm(term.id, { termType: v as ProspectiveTerm["termType"] })}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="max-h-[350px]">
                          {TERM_TYPES.map(t => (
                            <SelectItem key={t.value} value={t.value} className="py-2">
                              <div className="flex flex-col gap-0.5">
                                <div className="flex items-center gap-2">
                                  <t.icon className="h-3 w-3 shrink-0" />
                                  <span className="font-medium">{t.label}</span>
                                </div>
                                <span className="text-xs text-muted-foreground pl-5">{t.description}</span>
                              </div>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Target Value</Label>
                      <Input
                        type="number"
                        value={term.targetValue}
                        onChange={(e) => updateTerm(term.id, { targetValue: parseInt(e.target.value) || 0 })}
                        placeholder="Threshold"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Rebate %</Label>
                      <Input
                        type="number"
                        step="0.1"
                        value={term.rebatePercent}
                        onChange={(e) => updateTerm(term.id, { rebatePercent: parseFloat(e.target.value) || 0 })}
                        placeholder="e.g., 3.5"
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Estimated Impact */}
        {newProposal.terms.length > 0 && (
          <Card className="bg-green-50 dark:bg-green-950/20 border-green-200 dark:border-green-800">
            <CardContent className="pt-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Estimated Annual Rebate</p>
                  <p className="text-2xl font-bold text-green-600">{formatCurrencyShort(calculateEstimatedRebate())}</p>
                </div>
                <TrendingUp className="h-8 w-8 text-green-600" />
              </div>
            </CardContent>
          </Card>
        )}

        {/* Deal Score */}
        {score && <DealScoreView score={score} />}

        {/* Actions */}
        <div className="flex justify-end gap-3">
          <Button variant="outline" onClick={handleResetAndClose}>
            Cancel
          </Button>
          <Button onClick={submitProposal} disabled={createMutation.isPending}>
            {createMutation.isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Submitting...
              </>
            ) : editingProposalId ? (
              <>
                <Check className="mr-2 h-4 w-4" />
                Save Changes
              </>
            ) : (
              <>
                <Plus className="mr-2 h-4 w-4" />
                Save Proposal
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  )
}
