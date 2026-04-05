"use client"

import { useState } from "react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { FileText, FileStack } from "lucide-react"
import { AIExtractDialog } from "@/components/contracts/ai-extract-dialog"
import { MassUpload } from "@/components/import/mass-upload"
import type { ExtractedContractData } from "@/lib/ai/schemas"

interface ContractImportModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  facilityId: string
  onImported?: (data: ExtractedContractData) => void
}

export function ContractImportModal({
  open,
  onOpenChange,
  facilityId,
  onImported,
}: ContractImportModalProps) {
  const [mode, setMode] = useState<"single" | "batch">("single")

  // When in single mode, delegate to AIExtractDialog
  if (open && mode === "single") {
    return (
      <>
        {/* Mode-selection dialog renders beneath; the AIExtractDialog takes over */}
        <AIExtractDialog
          open={open}
          onOpenChange={(nextOpen) => {
            if (!nextOpen) {
              onOpenChange(false)
            }
          }}
          onExtracted={(data, _s3Key, _fileName) => {
            onImported?.(data)
            onOpenChange(false)
          }}
        />
      </>
    )
  }

  // When in batch mode, delegate to MassUpload
  if (open && mode === "batch") {
    return (
      <MassUpload
        facilityId={facilityId}
        open={open}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) {
            onOpenChange(false)
          }
        }}
      />
    )
  }

  // Default: mode selection dialog (shown when `open` is true but we need to pick)
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Import Contract</DialogTitle>
          <DialogDescription>
            Choose how you want to import contract documents.
          </DialogDescription>
        </DialogHeader>

        <Tabs
          value={mode}
          onValueChange={(v) => setMode(v as "single" | "batch")}
          className="w-full"
        >
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="single" className="gap-2">
              <FileText className="h-4 w-4" />
              Single Upload
            </TabsTrigger>
            <TabsTrigger value="batch" className="gap-2">
              <FileStack className="h-4 w-4" />
              Batch Upload
            </TabsTrigger>
          </TabsList>

          <TabsContent value="single" className="mt-4">
            <p className="text-sm text-muted-foreground">
              Upload a single contract PDF and AI will extract all the details
              automatically.
            </p>
          </TabsContent>

          <TabsContent value="batch" className="mt-4">
            <p className="text-sm text-muted-foreground">
              Upload multiple documents at once for batch classification and
              processing.
            </p>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}
