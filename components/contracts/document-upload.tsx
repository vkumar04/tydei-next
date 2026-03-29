"use client"

import { useState } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Button } from "@/components/ui/button"
import { FileUpload } from "@/components/shared/file-upload"
import { getUploadUrl } from "@/lib/actions/uploads"
import { Field } from "@/components/shared/forms/field"

interface DocumentUploadProps {
  contractId: string
  onUploaded: (doc: { name: string; type: string; url: string }) => void
  open: boolean
  onOpenChange: (open: boolean) => void
}

const DOC_TYPES = [
  { value: "main", label: "Main Contract" },
  { value: "amendment", label: "Amendment" },
  { value: "addendum", label: "Addendum" },
  { value: "exhibit", label: "Exhibit" },
  { value: "pricing", label: "Pricing Schedule" },
]

export function DocumentUpload({ contractId, onUploaded, open, onOpenChange }: DocumentUploadProps) {
  const [docType, setDocType] = useState("main")

  async function handleUpload(file: File) {
    const { uploadUrl, key } = await getUploadUrl({
      fileName: file.name,
      contentType: file.type,
      folder: "contracts",
    })
    await fetch(uploadUrl, { method: "PUT", body: file, headers: { "Content-Type": file.type } })
    onUploaded({ name: file.name, type: docType, url: key })
    onOpenChange(false)
    return key
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Upload Document</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <Field label="Document Type">
            <Select value={docType} onValueChange={setDocType}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DOC_TYPES.map((t) => (
                  <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <FileUpload
            onUpload={handleUpload}
            accept=".pdf,.doc,.docx,.xls,.xlsx"
            label="Choose document"
          />
        </div>
      </DialogContent>
    </Dialog>
  )
}
