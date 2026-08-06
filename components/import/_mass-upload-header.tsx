"use client"

import { FileStackIcon, UploadIcon } from "lucide-react"
import {
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

interface MassUploadHeaderProps {
  title: string
  description: string
}

/** Main dialog header: title, description, and the payor-contracts entry point. */
export function MassUploadHeader({ title, description }: MassUploadHeaderProps) {
  return (
    <DialogHeader>
      <DialogTitle className="flex items-center gap-2">
        <FileStackIcon className="h-5 w-5" /> {title}
      </DialogTitle>
      <DialogDescription>{description}</DialogDescription>
      {/* bugs.rtfd 2026-06-14 ("need a place to upload pdf payor
          contracts ... it should just be with uploading of data"):
          payor contracts have their own PDF→CPT-rate extraction +
          add/erase file list under Case Costing → Payor Contracts.
          Surface that entry point from the global data-upload modal so
          it's discoverable here. */}
      <a
        href="/dashboard/case-costing?tab=payor-contracts"
        className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline"
      >
        <UploadIcon className="h-3.5 w-3.5" />
        Uploading a payor contract? Add & manage them under Case Costing →
        Payor Contracts
      </a>
    </DialogHeader>
  )
}
