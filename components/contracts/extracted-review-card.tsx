"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { CheckCircle2, FileText } from "lucide-react"
import type { UseFormReturn } from "react-hook-form"

interface Props {
  form: UseFormReturn<any>
  terms: { termName: string }[]
  onEdit: () => void
}

export function ExtractedReviewCard({ form, terms, onEdit }: Props) {
  const v = form.getValues()
  return (
    <Card className="border-emerald-500/40 bg-emerald-500/5">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-emerald-700 dark:text-emerald-400">
          <CheckCircle2 className="h-5 w-5" />
          Extracted — review before saving
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <dl className="grid gap-2 sm:grid-cols-2 text-sm">
          <div><dt className="text-muted-foreground">Vendor</dt><dd>{v.vendorId ? "Linked" : "Unlinked"}</dd></div>
          <div><dt className="text-muted-foreground">Contract Name</dt><dd>{v.name || "—"}</dd></div>
          <div><dt className="text-muted-foreground">Effective</dt><dd>{v.effectiveDate || "—"}</dd></div>
          <div><dt className="text-muted-foreground">Expiration</dt><dd>{v.expirationDate || "—"}</dd></div>
          <div><dt className="text-muted-foreground">Total Value</dt><dd>{v.totalValue ? `$${Number(v.totalValue).toLocaleString()}` : "—"}</dd></div>
          <div><dt className="text-muted-foreground">Terms</dt><dd>{terms.length}</dd></div>
        </dl>
        <div className="flex gap-2 pt-2">
          <Button onClick={onEdit} variant="default">
            <FileText className="mr-2 h-4 w-4" /> Edit & Save
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
