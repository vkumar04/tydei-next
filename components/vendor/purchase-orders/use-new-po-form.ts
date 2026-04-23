"use client"

import { useCallback, useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { toast } from "sonner"
import {
  getVendorFacilities,
  getVendorFacilityProducts,
  searchVendorProducts,
} from "@/lib/actions/vendor-purchase-orders"
import type { POLineItem, POType } from "./types"

/**
 * Encapsulates all of the "New PO" dialog state: form fields, the
 * facility/product queries it depends on, and the line-item / scan /
 * exception handlers. Extracted from `purchase-orders-client.tsx` so
 * the page client can stay focused on list orchestration.
 */
export function useNewPOForm(vendorId: string) {
  const [newPOFacility, setNewPOFacility] = useState("")
  const [newPOType, setNewPOType] = useState<POType>("standard")
  const [newPODate, setNewPODate] = useState("")
  const [newPONotes, setNewPONotes] = useState("")
  const [newPOLineItems, setNewPOLineItems] = useState<POLineItem[]>([])
  const [selectedProductToAdd, setSelectedProductToAdd] = useState("")
  const [productSearch, setProductSearch] = useState("")
  const [addMethod, setAddMethod] = useState<"select" | "scan">("select")
  const [scanInput, setScanInput] = useState("")
  const [showExceptionForm, setShowExceptionForm] = useState(false)
  const [exceptionProduct, setExceptionProduct] = useState({
    sku: "",
    name: "",
    description: "",
    lotSn: "",
    unitPrice: "",
    reason: "",
  })

  const { data: facilities = [] } = useQuery({
    queryKey: ["vendorFacilities", vendorId],
    queryFn: () => getVendorFacilities(vendorId),
  })

  const selectedFacilityObj = facilities.find((f) => f.id === newPOFacility)

  const { data: facilityProducts = [] } = useQuery({
    queryKey: ["vendorFacilityProducts", vendorId, newPOFacility],
    queryFn: () => getVendorFacilityProducts({ vendorId, facilityId: newPOFacility }),
    enabled: !!newPOFacility,
  })

  const { data: searchResults = [] } = useQuery({
    queryKey: ["vendorProductSearch", vendorId, newPOFacility, productSearch],
    queryFn: () =>
      searchVendorProducts({
        vendorId,
        facilityId: newPOFacility || undefined,
        query: productSearch,
      }),
    enabled: productSearch.length >= 2,
  })

  const searchTerm = productSearch.toLowerCase().trim()

  const filteredFacilityProducts = useMemo(() => {
    if (!newPOFacility) return []
    if (!searchTerm) return facilityProducts
    return facilityProducts.filter(
      (p) =>
        p.description.toLowerCase().includes(searchTerm) ||
        p.vendorItemNo.toLowerCase().includes(searchTerm) ||
        (p.category ?? "").toLowerCase().includes(searchTerm)
    )
  }, [facilityProducts, searchTerm, newPOFacility])

  const filteredCatalogProducts = useMemo(() => {
    if (searchTerm.length < 2) return []
    const facilityIds = new Set(facilityProducts.map((p) => p.vendorItemNo))
    return searchResults.filter((p) => !facilityIds.has(p.vendorItemNo))
  }, [searchResults, facilityProducts, searchTerm])

  const displayedFacilityProducts = filteredFacilityProducts.slice(0, 50)
  const displayedCatalogProducts = filteredCatalogProducts.slice(
    0,
    Math.max(0, 50 - displayedFacilityProducts.length)
  )

  const newPOTotal = newPOLineItems.reduce(
    (sum, item) => sum + item.unitPrice * item.quantity,
    0
  )

  const handleAddLineItem = useCallback(() => {
    let product = facilityProducts.find((p) => p.id === selectedProductToAdd)
    let isFromCatalog = false

    if (!product) {
      product = searchResults.find((p) => p.id === selectedProductToAdd)
      isFromCatalog = true
    }

    if (!product) return

    if (newPOLineItems.some((item) => item.sku === product.vendorItemNo)) {
      toast.error("Product already added", { description: "Update the quantity instead" })
      return
    }

    const price = product.contractPrice ?? product.listPrice ?? 0

    setNewPOLineItems((prev) => [
      ...prev,
      {
        productId: product.id,
        productName: product.description,
        sku: product.vendorItemNo,
        vendorItemNo: product.vendorItemNo,
        lotSn: "",
        quantity: 1,
        unitPrice: price,
        uom: product.uom,
      },
    ])

    if (isFromCatalog && newPOFacility) {
      toast.info("Product from catalog", {
        description: "This product is not in the facility price file",
      })
    }

    setSelectedProductToAdd("")
    setProductSearch("")
  }, [selectedProductToAdd, facilityProducts, searchResults, newPOLineItems, newPOFacility])

  const handleScanProduct = useCallback(() => {
    if (!scanInput.trim()) return

    const term = scanInput.trim().toUpperCase()
    const allProducts = newPOFacility ? facilityProducts : searchResults

    let product = allProducts.find(
      (p) =>
        p.vendorItemNo.toUpperCase() === term ||
        p.vendorItemNo.toUpperCase().includes(term) ||
        p.description.toUpperCase().includes(term)
    )

    if (!product && newPOFacility) {
      product = searchResults.find(
        (p) =>
          p.vendorItemNo.toUpperCase() === term ||
          p.vendorItemNo.toUpperCase().includes(term) ||
          p.description.toUpperCase().includes(term)
      )
      if (product) {
        toast.info("Product from catalog", {
          description: "This product is not in the facility price file - using list price",
        })
      }
    }

    if (!product) {
      setExceptionProduct({
        sku: scanInput.trim(),
        name: "",
        description: "",
        lotSn: "",
        unitPrice: "",
        reason: "",
      })
      setShowExceptionForm(true)
      toast.info("Product not found", {
        description: "You can add this as a product exception",
      })
      return
    }

    const price = product.contractPrice ?? product.listPrice ?? 0

    const existingIdx = newPOLineItems.findIndex(
      (item) => item.sku === product.vendorItemNo
    )
    if (existingIdx !== -1) {
      const updated = [...newPOLineItems]
      updated[existingIdx].quantity += 1
      setNewPOLineItems(updated)
      toast.success("Quantity updated", {
        description: `${product.description} qty: ${updated[existingIdx].quantity}`,
      })
    } else {
      setNewPOLineItems((prev) => [
        ...prev,
        {
          productId: product.id,
          productName: product.description,
          sku: product.vendorItemNo,
          vendorItemNo: product.vendorItemNo,
          lotSn: "",
          quantity: 1,
          unitPrice: price,
          uom: product.uom,
        },
      ])
      toast.success("Product added", { description: product.description })
    }

    setScanInput("")
  }, [scanInput, facilityProducts, searchResults, newPOLineItems, newPOFacility])

  const handleScanKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault()
      handleScanProduct()
    }
  }

  const handleAddException = () => {
    if (!exceptionProduct.name || !exceptionProduct.unitPrice) {
      toast.error("Missing information", {
        description: "Please enter product name and price",
      })
      return
    }

    const price = parseFloat(exceptionProduct.unitPrice)
    if (isNaN(price) || price <= 0) {
      toast.error("Invalid price", { description: "Please enter a valid price" })
      return
    }

    setNewPOLineItems((prev) => [
      ...prev,
      {
        productId: `exception-${Date.now()}`,
        productName: `${exceptionProduct.name} (Exception)`,
        description: exceptionProduct.description,
        sku: exceptionProduct.sku || `EXC-${Date.now()}`,
        lotSn: exceptionProduct.lotSn,
        quantity: 1,
        unitPrice: price,
        uom: "EA",
        isException: true,
        exceptionReason: exceptionProduct.reason,
      },
    ])

    toast.success("Exception product added", { description: exceptionProduct.name })
    setShowExceptionForm(false)
    setExceptionProduct({ sku: "", name: "", description: "", lotSn: "", unitPrice: "", reason: "" })
    setScanInput("")
  }

  const handleCancelException = () => {
    setShowExceptionForm(false)
    setExceptionProduct({ sku: "", name: "", description: "", lotSn: "", unitPrice: "", reason: "" })
    setScanInput("")
  }

  const handleCameraScan = () => {
    toast.info("Camera scanning", {
      description: "Camera scan would activate here. For demo, use manual entry.",
    })
    setAddMethod("scan")
  }

  const handleUpdateQuantity = (productId: string, quantity: number) => {
    setNewPOLineItems((prev) =>
      prev.map((item) =>
        item.productId === productId ? { ...item, quantity: Math.max(1, quantity) } : item
      )
    )
  }

  const handleUpdateLotSn = (productId: string, lotSn: string) => {
    setNewPOLineItems((prev) =>
      prev.map((item) => (item.productId === productId ? { ...item, lotSn } : item))
    )
  }

  const handleRemoveLineItem = (productId: string) => {
    setNewPOLineItems((prev) => prev.filter((item) => item.productId !== productId))
  }

  const resetForm = () => {
    setNewPOFacility("")
    setNewPOType("standard")
    setNewPODate("")
    setNewPONotes("")
    setNewPOLineItems([])
    setScanInput("")
    setProductSearch("")
    setAddMethod("select")
    setShowExceptionForm(false)
    setSelectedProductToAdd("")
    setExceptionProduct({ sku: "", name: "", description: "", lotSn: "", unitPrice: "", reason: "" })
  }

  return {
    // form fields
    newPOFacility,
    setNewPOFacility,
    newPOType,
    setNewPOType,
    newPODate,
    setNewPODate,
    newPONotes,
    setNewPONotes,
    newPOLineItems,
    newPOTotal,
    selectedFacilityObj,
    // product picker
    facilities,
    facilityProducts,
    displayedFacilityProducts,
    displayedCatalogProducts,
    filteredFacilityProductsCount: filteredFacilityProducts.length,
    filteredCatalogProductsCount: filteredCatalogProducts.length,
    searchTerm,
    selectedProductToAdd,
    setSelectedProductToAdd,
    productSearch,
    setProductSearch,
    addMethod,
    setAddMethod,
    scanInput,
    setScanInput,
    showExceptionForm,
    exceptionProduct,
    setExceptionProduct,
    // handlers
    handleAddLineItem,
    handleScanProduct,
    handleScanKeyPress,
    handleAddException,
    handleCancelException,
    handleCameraScan,
    handleUpdateQuantity,
    handleUpdateLotSn,
    handleRemoveLineItem,
    resetForm,
  }
}
