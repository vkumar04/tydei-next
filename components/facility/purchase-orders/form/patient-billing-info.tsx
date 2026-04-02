"use client"

import { User, DollarSign } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"

export interface PatientBillingInfoProps {
  patientMRN: string
  patientInitials: string
  billToAddress: string
  paymentTerms: string
  departmentCode: string
  glCode: string
  onPatientMRNChange: (value: string) => void
  onPatientInitialsChange: (value: string) => void
  onBillToAddressChange: (value: string) => void
  onPaymentTermsChange: (value: string) => void
  onDepartmentCodeChange: (value: string) => void
  onGlCodeChange: (value: string) => void
}

export function PatientBillingInfo({
  patientMRN,
  patientInitials,
  billToAddress,
  paymentTerms,
  departmentCode,
  glCode,
  onPatientMRNChange,
  onPatientInitialsChange,
  onBillToAddressChange,
  onPaymentTermsChange,
  onDepartmentCodeChange,
  onGlCodeChange,
}: PatientBillingInfoProps) {
  return (
    <>
      {/* Patient & Billing Information */}
      <div>
        <h4 className="font-medium mb-3 flex items-center gap-2">
          <User className="h-4 w-4" />
          Patient &amp; Billing Information
        </h4>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="space-y-2">
            <Label>Patient MRN</Label>
            <Input
              value={patientMRN}
              onChange={(e) => onPatientMRNChange(e.target.value)}
              placeholder="Medical Record Number"
            />
          </div>
          <div className="space-y-2">
            <Label>Patient Initials</Label>
            <Input
              value={patientInitials}
              onChange={(e) => onPatientInitialsChange(e.target.value.toUpperCase())}
              placeholder="e.g., JD"
              maxLength={4}
            />
          </div>
          <div className="space-y-2">
            <Label>Bill-To Address</Label>
            <Input
              value={billToAddress}
              onChange={(e) => onBillToAddressChange(e.target.value)}
              placeholder="Billing address"
            />
          </div>
        </div>
        <p className="text-xs text-muted-foreground mt-2">
          Enter either Patient MRN or Initials for Bill Only PO identification
        </p>
      </div>

      {/* Payment & Accounting */}
      <div>
        <h4 className="font-medium mb-3 flex items-center gap-2">
          <DollarSign className="h-4 w-4" />
          Payment &amp; Accounting
        </h4>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="space-y-2">
            <Label>Payment Terms</Label>
            <Select value={paymentTerms} onValueChange={onPaymentTermsChange}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="NET15">Net 15</SelectItem>
                <SelectItem value="NET30">Net 30</SelectItem>
                <SelectItem value="NET45">Net 45</SelectItem>
                <SelectItem value="NET60">Net 60</SelectItem>
                <SelectItem value="2_10_NET30">2/10 Net 30</SelectItem>
                <SelectItem value="DUE_ON_RECEIPT">Due on Receipt</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Department Code</Label>
            <Input
              value={departmentCode}
              onChange={(e) => onDepartmentCodeChange(e.target.value)}
              placeholder="e.g., ORTHO, SURG"
            />
          </div>
          <div className="space-y-2">
            <Label>GL Code / Cost Center</Label>
            <Input
              value={glCode}
              onChange={(e) => onGlCodeChange(e.target.value)}
              placeholder="e.g., 4100-200"
            />
          </div>
        </div>
      </div>
    </>
  )
}
