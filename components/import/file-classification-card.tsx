"use client"

import {
  FileText,
  FileSpreadsheet,
  File as FileIcon,
  X,
  Loader2,
  AlertCircle,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { cn } from "@/lib/utils"

export type DocumentClassification =
  | "contract"
  | "amendment"
  | "cog_data"
  | "cog_report"
  | "pricing_file"
  | "pricing_schedule"
  | "invoice"
  | "purchase_order"
  | "unknown"

export interface QueuedFile {
  id: string
  file: File
  status: "pending" | "classifying" | "classified" | "error"
  classification?: DocumentClassification
  confidence?: number
  error?: string
}

const CLASSIFICATION_CONFIG: Record<
  DocumentClassification,
  { label: string; color: string; action: string }
> = {
  contract: {
    label: "Contract",
    color: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300",
    action: "Will extract contract data",
  },
  amendment: {
    label: "Amendment",
    color:
      "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
    action: "Will extract amendment changes",
  },
  cog_data: {
    label: "COG Data",
    color:
      "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300",
    action: "Will import to COG Data",
  },
  cog_report: {
    label: "COG Report",
    color:
      "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
    action: "Will import COG report",
  },
  pricing_file: {
    label: "Pricing File",
    color:
      "bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300",
    action: "Will import as pricing file",
  },
  pricing_schedule: {
    label: "Pricing Schedule",
    color:
      "bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-300",
    action: "Will import pricing schedule",
  },
  invoice: {
    label: "Invoice",
    color:
      "bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300",
    action: "Will process invoice",
  },
  purchase_order: {
    label: "Purchase Order",
    color:
      "bg-cyan-100 text-cyan-800 dark:bg-cyan-900/40 dark:text-cyan-300",
    action: "Will process purchase order",
  },
  unknown: {
    label: "Unknown",
    color: "bg-gray-100 text-gray-800 dark:bg-gray-900/40 dark:text-gray-300",
    action: "Manual classification needed",
  },
}

const ALL_CLASSIFICATIONS = Object.keys(
  CLASSIFICATION_CONFIG
) as DocumentClassification[]

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function FileTypeIcon({ name }: { name: string }) {
  const ext = name.split(".").pop()?.toLowerCase()
  if (ext === "pdf") return <FileText className="h-5 w-5 text-red-500" />
  if (ext === "csv" || ext === "xlsx" || ext === "xls")
    return <FileSpreadsheet className="h-5 w-5 text-green-600" />
  return <FileIcon className="h-5 w-5 text-muted-foreground" />
}

interface FileClassificationCardProps {
  item: QueuedFile
  onRemove: (id: string) => void
  onOverride: (id: string, classification: DocumentClassification) => void
}

export function FileClassificationCard({
  item,
  onRemove,
  onOverride,
}: FileClassificationCardProps) {
  const config = item.classification
    ? CLASSIFICATION_CONFIG[item.classification]
    : null

  return (
    <Card className="relative">
      <CardContent className="flex items-center gap-3 py-3 px-4">
        {/* File icon */}
        <FileTypeIcon name={item.file.name} />

        {/* File info */}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate">{item.file.name}</p>
          <p className="text-xs text-muted-foreground">
            {formatFileSize(item.file.size)}
          </p>
        </div>

        {/* Status / Classification */}
        <div className="flex items-center gap-2 shrink-0">
          {item.status === "pending" && (
            <Badge variant="secondary" className="text-xs">
              Queued
            </Badge>
          )}

          {item.status === "classifying" && (
            <Badge variant="secondary" className="text-xs">
              <Loader2 className="h-3 w-3 animate-spin mr-1" />
              Classifying...
            </Badge>
          )}

          {item.status === "error" && (
            <Badge
              variant="destructive"
              className="text-xs"
            >
              <AlertCircle className="h-3 w-3 mr-1" />
              Error
            </Badge>
          )}

          {item.status === "classified" && config && (
            <>
              <Badge className={cn("text-xs border-0", config.color)}>
                {config.label}
              </Badge>
              {item.confidence !== undefined && (
                <span className="text-xs text-muted-foreground tabular-nums">
                  {Math.round(item.confidence * 100)}%
                </span>
              )}
              {/* Override dropdown */}
              <Select
                value={item.classification}
                onValueChange={(val) =>
                  onOverride(item.id, val as DocumentClassification)
                }
              >
                <SelectTrigger className="h-7 w-[130px] text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ALL_CLASSIFICATIONS.map((c) => (
                    <SelectItem key={c} value={c} className="text-xs">
                      {CLASSIFICATION_CONFIG[c].label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </>
          )}
        </div>

        {/* Remove button */}
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 shrink-0"
          onClick={() => onRemove(item.id)}
        >
          <X className="h-4 w-4" />
          <span className="sr-only">Remove</span>
        </Button>
      </CardContent>
    </Card>
  )
}

export { CLASSIFICATION_CONFIG }
