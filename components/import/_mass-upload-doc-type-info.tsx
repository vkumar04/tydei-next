"use client"

import {
  FileTextIcon,
  FileQuestionIcon,
  ReceiptIcon,
  FileSignatureIcon,
  PackageIcon,
} from "lucide-react"
import type { DocumentType } from "./_mass-upload-types"

export const DOCUMENT_TYPE_INFO: Record<
  DocumentType,
  { label: string; icon: React.ReactNode; color: string }
> = {
  contract: {
    label: "Contract",
    icon: <FileSignatureIcon className="h-4 w-4" />,
    color: "bg-blue-500",
  },
  amendment: {
    label: "Amendment",
    icon: <FileTextIcon className="h-4 w-4" />,
    color: "bg-purple-500",
  },
  invoice: {
    label: "Invoice",
    icon: <ReceiptIcon className="h-4 w-4" />,
    color: "bg-green-500",
  },
  purchase_order: {
    label: "Purchase Order",
    icon: <PackageIcon className="h-4 w-4" />,
    color: "bg-orange-500",
  },
  pricing_schedule: {
    label: "Pricing Schedule",
    icon: <FileTextIcon className="h-4 w-4" />,
    color: "bg-cyan-500",
  },
  cog_report: {
    label: "COG Report",
    icon: <FileTextIcon className="h-4 w-4" />,
    color: "bg-yellow-500",
  },
  cog_data: {
    label: "COG Data",
    icon: <FileTextIcon className="h-4 w-4" />,
    color: "bg-yellow-500",
  },
  pricing_file: {
    label: "Pricing File",
    icon: <FileTextIcon className="h-4 w-4" />,
    color: "bg-cyan-500",
  },
  case_data: {
    label: "Case Data",
    icon: <FileTextIcon className="h-4 w-4" />,
    color: "bg-pink-500",
  },
  case_procedures: {
    label: "Case Procedures",
    icon: <FileTextIcon className="h-4 w-4" />,
    color: "bg-rose-500",
  },
  case_supplies: {
    label: "Case Supplies",
    icon: <FileTextIcon className="h-4 w-4" />,
    color: "bg-fuchsia-500",
  },
  unknown: {
    label: "Unknown",
    icon: <FileQuestionIcon className="h-4 w-4" />,
    color: "bg-gray-500",
  },
}

// Map the classify-document API's wider classification enum to our DocumentType.
export function normalizeApiType(t: string | null | undefined): DocumentType {
  switch (t) {
    case "contract":
      return "contract"
    case "amendment":
      return "amendment"
    case "cog_data":
      return "cog_data"
    case "cog_report":
      return "cog_report"
    case "pricing_file":
      return "pricing_file"
    case "pricing_schedule":
      return "pricing_schedule"
    case "invoice":
      return "invoice"
    case "purchase_order":
      return "purchase_order"
    case "case_data":
      return "case_data"
    case "case_procedures":
      return "case_procedures"
    case "case_supplies":
      return "case_supplies"
    default:
      return "unknown"
  }
}
