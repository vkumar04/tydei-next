"use client"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Upload } from "lucide-react"

export function UploadTab() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Upload Capital Contract</CardTitle>
        <CardDescription>
          Upload a capital contract PDF to automatically extract and
          analyze financial terms
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="border-2 border-dashed rounded-lg p-8 text-center border-muted-foreground/25 hover:border-primary/50 hover:bg-muted/50 transition-colors cursor-pointer">
          <div className="space-y-3">
            <div className="flex justify-center">
              <Upload className="h-10 w-10 text-muted-foreground" />
            </div>
            <p className="font-medium">
              Drag &amp; drop a capital contract PDF
            </p>
            <p className="text-sm text-muted-foreground">
              or click to browse files
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
