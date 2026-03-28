import type { ContractDocument } from "@prisma/client"
import { FileText, Upload } from "lucide-react"
import { formatDate } from "@/lib/formatting"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"

interface ContractDocumentsListProps {
  documents: ContractDocument[]
  onUpload?: () => void
}

export function ContractDocumentsList({
  documents,
  onUpload,
}: ContractDocumentsListProps) {
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle>Documents</CardTitle>
        {onUpload && (
          <Button variant="outline" size="sm" onClick={onUpload}>
            <Upload className="size-4" /> Upload
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {documents.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No documents uploaded yet
          </p>
        ) : (
          <div className="space-y-2">
            {documents.map((doc) => (
              <div
                key={doc.id}
                className="flex items-center justify-between rounded-md border p-3"
              >
                <div className="flex items-center gap-3">
                  <FileText className="size-4 text-muted-foreground" />
                  <div>
                    <p className="text-sm font-medium">{doc.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatDate(doc.uploadDate)}
                    </p>
                  </div>
                </div>
                <Badge variant="outline" className="capitalize">
                  {doc.type}
                </Badge>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
