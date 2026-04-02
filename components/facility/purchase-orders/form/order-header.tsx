"use client"

import { FileText, Building2 } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"

interface Vendor {
  id: string
  name: string
}

export interface OrderHeaderProps {
  vendors: Vendor[]
  vendorId: string
  orderDate: string
  procedureDate: string
  onVendorChange: (vendorId: string) => void
  onOrderDateChange: (date: string) => void
  onProcedureDateChange: (date: string) => void
}

export function OrderHeader({
  vendors,
  vendorId,
  orderDate,
  procedureDate,
  onVendorChange,
  onOrderDateChange,
  onProcedureDateChange,
}: OrderHeaderProps) {
  return (
    <div>
      <h4 className="font-medium mb-3 flex items-center gap-2">
        <FileText className="h-4 w-4" />
        Order Header
      </h4>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="space-y-2">
          <Label>Select Vendor *</Label>
          <Select value={vendorId} onValueChange={onVendorChange}>
            <SelectTrigger>
              <SelectValue placeholder="Choose a vendor" />
            </SelectTrigger>
            <SelectContent>
              {vendors.map((vendor) => (
                <SelectItem key={vendor.id} value={vendor.id}>
                  <div className="flex items-center gap-2">
                    <Building2 className="h-4 w-4" />
                    {vendor.name}
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label>PO Date *</Label>
          <Input
            type="date"
            value={orderDate}
            onChange={(e) => onOrderDateChange(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label>Procedure Date</Label>
          <Input
            type="date"
            value={procedureDate}
            onChange={(e) => onProcedureDateChange(e.target.value)}
          />
        </div>
      </div>
    </div>
  )
}
