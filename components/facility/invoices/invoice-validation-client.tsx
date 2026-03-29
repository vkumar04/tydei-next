"use client"

import { useState } from "react"
import { Upload } from "lucide-react"
import { PageHeader } from "@/components/shared/page-header"
import { InvoiceValidationTable } from "./invoice-validation-table"
import { InvoiceImportDialog } from "./invoice-import-dialog"
import { Button } from "@/components/ui/button"

interface Vendor {
  id: string
  name: string
}

interface InvoiceValidationClientProps {
  facilityId: string
  vendors: Vendor[]
}

export function InvoiceValidationClient({ facilityId, vendors }: InvoiceValidationClientProps) {
  const [importOpen, setImportOpen] = useState(false)

  return (
    <div className="space-y-6">
      <PageHeader
        title="Invoice Validation"
        description="Validate invoices against contract pricing"
        action={
          <Button onClick={() => setImportOpen(true)}>
            <Upload className="size-4" /> Import Invoice
          </Button>
        }
      />
      <InvoiceValidationTable facilityId={facilityId} />
      <InvoiceImportDialog
        facilityId={facilityId}
        vendors={vendors}
        open={importOpen}
        onOpenChange={setImportOpen}
        onComplete={() => {}}
      />
    </div>
  )
}
