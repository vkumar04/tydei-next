import { toast } from "sonner"
import type { NewProposalState, ProposalProduct, FileUploadProgressState, AiSuggestionsState } from "./types"

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

export function handlePricingFileUpload(
  e: React.ChangeEvent<HTMLInputElement>,
  setFileUploadProgress: React.Dispatch<React.SetStateAction<FileUploadProgressState>>,
  setNewProposal: React.Dispatch<React.SetStateAction<NewProposalState>>,
  /**
   * Charles 2026-04-26 (#66): when supplied, every distinct category
   * found in the pricing file is appended to the user's custom-
   * category list AND auto-selected on the proposal — so the vendor
   * doesn't have to manually retype categories that the upload
   * already discovered.
   */
  setCustomCategories?: React.Dispatch<React.SetStateAction<string[]>>,
) {
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

      const distinctCategories = Object.keys(categoryCounts).filter(Boolean)
      if (distinctCategories.length > 0) {
        detectedCategory = Object.entries(categoryCounts).sort((a, b) => b[1] - a[1])[0][0]
      }

      if (products.length === 0) {
        setFileUploadProgress({ isLoading: false, type: null, progress: 0, message: "" })
        toast.error("No valid products found in pricing file")
        return
      }

      // Charles 2026-04-26 (#66): append every distinct category from
      // the pricing file to the proposal's selected categories so the
      // vendor doesn't have to re-add them manually.
      if (distinctCategories.length > 0 && setCustomCategories) {
        setCustomCategories((prev) => {
          const existing = new Set(prev.map((c) => c.toLowerCase()))
          const additions = distinctCategories.filter(
            (c) => !existing.has(c.toLowerCase()),
          )
          return additions.length > 0 ? [...prev, ...additions] : prev
        })
      }

      setNewProposal(prev => {
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

        // Auto-select every distinct category from the pricing file
        // alongside whatever the vendor already had selected.
        const mergedCategories = Array.from(
          new Set([...prev.productCategories, ...distinctCategories]),
        )
        return {
          ...prev,
          products: products,
          projectedSpend: totalSpend,
          projectedVolume: totalVolume,
          productCategory:
            prev.productCategory ||
            detectedCategory ||
            mergedCategories[0] ||
            "",
          productCategories: mergedCategories,
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

export function handleUsageFileUpload(
  e: React.ChangeEvent<HTMLInputElement>,
  setFileUploadProgress: React.Dispatch<React.SetStateAction<FileUploadProgressState>>,
  setNewProposal: React.Dispatch<React.SetStateAction<NewProposalState>>,
) {
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

        const monthlyUsage = Object.entries(monthlyAggregates)
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

export async function generateProductsFromAI(
  aiProductDescription: string,
  currentProductCategory: string,
  setIsGeneratingAI: (v: boolean) => void,
  setNewProposal: React.Dispatch<React.SetStateAction<NewProposalState>>,
  setAiProductDescription: (v: string) => void,
) {
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
  const categoryMsg = detectedCategory && !currentProductCategory ? ` (Category: ${detectedCategory})` : ""
  toast.success(`Generated ${products.length} product${products.length > 1 ? "s" : ""} from description${categoryMsg}`)
}

export function generateTermsFromNotes(
  newProposal: NewProposalState,
  setNewProposal: React.Dispatch<React.SetStateAction<NewProposalState>>,
): AiSuggestionsState["data"] {
  const notes = newProposal.aiNotes.toLowerCase()
  const generatedTerms: NewProposalState["terms"] = []
  const suggestedTerms: { type: string; description: string; rationale: string }[] = []
  const negotiationAdvice: string[] = []
  const riskFactors: string[] = []

  // ── Parse context signals from the notes ──────────────────────
  const spendMatch = newProposal.aiNotes.match(/\$?([\d,.]+)\s*(million|m|k|thousand)?\s*(annual\s*)?(spend|revenue)?/i)
  const shareMatch = newProposal.aiNotes.match(/(\d+)\s*%?\s*(?:market\s*)?share/i)
  const yearMatch = newProposal.aiNotes.match(/(\d+)\s*-?\s*year/i)
  const hasCompetitor = notes.includes("compet") || notes.includes("rival") || notes.includes("alternative")
  const hasExclusivity = notes.includes("exclusive") || notes.includes("primary") || notes.includes("sole source")
  const hasUrgency = notes.includes("urgent") || notes.includes("deadline") || notes.includes("end of month") || notes.includes("decision needed")
  const hasGrowth = notes.includes("growth") || notes.includes("increase") || notes.includes("expand")
  const hasTiered = notes.includes("tier") || notes.includes("volume") || notes.includes("incentive")
  const hasRelationship = notes.includes("relationship") || notes.includes("years") || notes.includes("loyal") || notes.includes("customer for")
  const contractYears = yearMatch ? parseInt(yearMatch[1]) : 0
  const sharePercent = shareMatch ? parseInt(shareMatch[1]) : hasExclusivity ? 70 : 0

  // ── Spend rebate ──────────────────────────────────────────────
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
    const rebatePct = targetValue >= 1000000 ? 3.5 : targetValue >= 500000 ? 3 : 2.5
    generatedTerms.push({
      id: `ai-spend-${Date.now()}`,
      termType: "spend_rebate",
      name: "Annual Spend Rebate",
      targetType: "spend",
      targetValue,
      rebatePercent: rebatePct,
      tiers: [],
    })
    suggestedTerms.push({
      type: "Annual Spend Rebate",
      description: `${rebatePct}% rebate on ${targetValue >= 1000000 ? "$" + (targetValue / 1000000).toFixed(1) + "M" : "$" + (targetValue / 1000).toFixed(0) + "K"} annual spend commitment`,
      rationale: `A spend-based rebate locks in volume commitment. At this spend level, ${rebatePct}% is competitive with market benchmarks while maintaining healthy margins.`,
    })
    negotiationAdvice.push(
      `Push for: A higher spend threshold with a proportionally higher rebate (e.g., ${rebatePct + 0.5}% at 120% of target) to incentivize over-performance.`
    )
  }

  // ── Market share commitment ───────────────────────────────────
  if (shareMatch || hasExclusivity || notes.includes("market share") || notes.includes("partnership")) {
    generatedTerms.push({
      id: `ai-share-${Date.now()}`,
      termType: "market_share_rebate",
      name: "Market Share Commitment",
      targetType: "market_share",
      targetValue: sharePercent,
      rebatePercent: sharePercent >= 60 ? 2.5 : 2,
      tiers: [],
    })
    setNewProposal(prev => ({ ...prev, marketShareCommitment: sharePercent }))
    suggestedTerms.push({
      type: "Market Share Commitment",
      description: `${sharePercent}% share commitment with ${sharePercent >= 60 ? "2.5" : "2"}% compliance rebate`,
      rationale: hasExclusivity
        ? "Exclusivity requests justify a premium rebate — the vendor gains predictable volume while the facility gets pricing certainty."
        : `A ${sharePercent}% share target is achievable and demonstrates commitment without locking the facility into an unrealistic compliance burden.`,
    })
    if (sharePercent >= 70) {
      negotiationAdvice.push(
        "Concede on: Slightly higher rebate percentage for high share commitment — the guaranteed volume more than compensates."
      )
      riskFactors.push(`${sharePercent}% share commitment is aggressive. If the facility can't maintain compliance, rebate clawback could damage the relationship.`)
    }
    negotiationAdvice.push(
      "Push for: Quarterly compliance reporting rather than annual, so course-corrections can happen early."
    )
  }

  // ── Contract length ───────────────────────────────────────────
  if (yearMatch) {
    const years = parseInt(yearMatch[1])
    setNewProposal(prev => ({ ...prev, contractLength: years * 12 }))
    suggestedTerms.push({
      type: "Contract Duration",
      description: `${years}-year agreement with annual price escalator cap of 2-3%`,
      rationale: years >= 3
        ? "A multi-year deal provides revenue stability. Include a price escalator cap to protect against cost inflation while keeping the facility comfortable with long-term commitment."
        : "A shorter contract reduces lock-in risk for both parties. Consider including an auto-renewal clause with a 90-day opt-out window.",
    })
    if (years >= 3) {
      negotiationAdvice.push(
        `Push for: Annual review meetings built into the contract to discuss performance and adjust terms — this keeps the relationship active.`
      )
      negotiationAdvice.push(
        `Concede on: A 90-day termination clause after year 1 — it shows confidence in your value and reduces the facility's perceived risk.`
      )
    }
    if (years >= 5) {
      riskFactors.push("5+ year contracts carry product obsolescence risk. Consider including technology refresh clauses.")
    }
  }

  // ── Growth incentive ──────────────────────────────────────────
  if (hasGrowth) {
    generatedTerms.push({
      id: `ai-growth-${Date.now()}`,
      termType: "volume_rebate",
      name: "Growth Incentive Rebate",
      targetType: "volume",
      targetValue: 10,
      rebatePercent: 2,
      tiers: [],
    })
    suggestedTerms.push({
      type: "Growth Incentive",
      description: "2% bonus rebate for 10%+ year-over-year volume growth",
      rationale: "Growth-based incentives align both parties' interests. The vendor gains market share expansion while the facility is rewarded for consolidating purchases.",
    })
    negotiationAdvice.push(
      "Push for: Growth measured against a rolling baseline rather than a fixed baseline to prevent sandbagging in year 1."
    )
  }

  // ── Tiered volume rebate ──────────────────────────────────────
  if (hasTiered) {
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
    suggestedTerms.push({
      type: "Tiered Volume Rebate",
      description: "Progressive rebate: 1% at 100 units, 2% at 250 units, 3% at 500+ units",
      rationale: "Tiered structures motivate increasing purchases. The facility always benefits from buying more, and each tier is profitable for the vendor at the corresponding volume.",
    })
    negotiationAdvice.push(
      "Concede on: A lower entry tier threshold if the facility has historically low volume — it builds trust and hooks them into the program."
    )
  }

  // ── Competitive context signals ───────────────────────────────
  let competitiveStrategy: string | null = null
  if (hasCompetitor) {
    competitiveStrategy = "A competitor is in the picture. Focus on total value of partnership (service, reliability, clinical support) rather than matching price point-for-point. If you must match pricing, do it through rebate structures that lock in volume rather than straight price reductions that erode your ASP."
    negotiationAdvice.push(
      "Push for: A head-to-head product evaluation or trial period rather than a straight price match — this leverages product quality advantages."
    )
    riskFactors.push("Competing offer present. Avoid a race-to-the-bottom on price — differentiate on service and total cost of ownership.")
  }

  // ── Urgency assessment ────────────────────────────────────────
  let urgencyAssessment: string | null = null
  if (hasUrgency) {
    urgencyAssessment = "The deal has time pressure. This can work in your favor — offer a limited-time signing bonus (e.g., additional 0.5% rebate for signing within 2 weeks) to create urgency while maintaining your standard pricing structure."
    negotiationAdvice.push(
      "Push for: Quick close by offering a time-limited signing incentive rather than permanent price concessions."
    )
    riskFactors.push("Urgency may be artificial negotiation pressure. Verify the timeline before making concessions.")
  }

  // ── Relationship context ──────────────────────────────────────
  if (hasRelationship) {
    negotiationAdvice.push(
      "Leverage the existing relationship — propose a loyalty tier or renewal bonus that rewards continued partnership."
    )
    suggestedTerms.push({
      type: "Loyalty Renewal Bonus",
      description: "0.5% additional rebate applied at contract renewal for continuous partners",
      rationale: "Rewarding long-term customers reduces churn risk and costs less than acquiring new business. This signals that the vendor values the relationship.",
    })
  }

  // ── Determine deal strength ───────────────────────────────────
  let strengthPoints = 0
  if (contractYears >= 2) strengthPoints += 2
  if (sharePercent >= 50) strengthPoints += 2
  if (hasRelationship) strengthPoints += 1
  if (hasExclusivity) strengthPoints += 2
  if (hasCompetitor) strengthPoints -= 1
  if (hasUrgency) strengthPoints -= 1
  const dealStrength: "strong" | "moderate" | "weak" =
    strengthPoints >= 4 ? "strong" : strengthPoints >= 1 ? "moderate" : "weak"

  const recommendedDiscount =
    dealStrength === "strong" ? "2-4% off list"
    : dealStrength === "moderate" ? "5-8% off list"
    : "8-12% off list (competitive situation)"

  // ── Apply terms to proposal ───────────────────────────────────
  if (generatedTerms.length > 0) {
    setNewProposal(prev => {
      const existingTypes = prev.terms.map(t => t.termType)
      const newTerms = generatedTerms.filter(t => !existingTypes.includes(t.termType))
      return {
        ...prev,
        terms: [...prev.terms, ...newTerms],
      }
    })
    toast.success(`AI generated ${generatedTerms.length} deal term(s) with reasoning and negotiation advice. Review below.`)
  } else {
    setNewProposal(prev => ({
      ...prev,
      terms: [...prev.terms, {
        id: `ai-default-${Date.now()}`,
        termType: "spend_rebate" as const,
        name: "Standard Spend Rebate",
        targetType: "spend" as const,
        targetValue: prev.projectedSpend || 500000,
        rebatePercent: 2.5,
        tiers: [],
      }],
    }))
    suggestedTerms.push({
      type: "Standard Spend Rebate",
      description: "2.5% rebate on projected annual spend",
      rationale: "A standard spend rebate is a safe starting point. Add more detail to your notes (spend targets, market share goals, contract length) for more specific recommendations.",
    })
    toast.info("Generated a standard spend rebate term. Add more details to your notes for specific terms.")
  }

  // ── Always add general advice if none was generated ───────────
  if (negotiationAdvice.length === 0) {
    negotiationAdvice.push(
      "Push for: Multi-year commitment in exchange for better rebate tiers.",
      "Concede on: Small administrative items (reporting frequency, payment terms) to build goodwill.",
      "Avoid: Upfront price reductions without volume commitment — use rebates to protect your ASP."
    )
  }
  if (riskFactors.length === 0) {
    riskFactors.push("No significant risk signals detected in the deal notes. Proceed with standard terms.")
  }

  return {
    dealStrength,
    recommendedDiscount,
    negotiationAdvice,
    suggestedTerms,
    riskFactors,
    competitiveStrategy,
    urgencyAssessment: urgencyAssessment ?? undefined,
  }
}
