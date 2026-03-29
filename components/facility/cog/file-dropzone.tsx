"use client"

import { useCallback, useState } from "react"
import { Upload } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { cn } from "@/lib/utils"

interface FileDropzoneProps {
  accept: string[]
  onFile: (file: File) => void
  label?: string
}

export function FileDropzone({
  accept,
  onFile,
  label = "Drop a CSV or Excel file here, or click to browse",
}: FileDropzoneProps) {
  const [isDragging, setIsDragging] = useState(false)

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setIsDragging(false)
      const file = e.dataTransfer.files[0]
      if (file) onFile(file)
    },
    [onFile]
  )

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      if (file) onFile(file)
    },
    [onFile]
  )

  return (
    <Card
      className={cn(
        "border-2 border-dashed transition-colors cursor-pointer",
        isDragging && "border-primary bg-primary/5"
      )}
      onDragOver={(e) => {
        e.preventDefault()
        setIsDragging(true)
      }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={handleDrop}
    >
      <CardContent className="flex flex-col items-center justify-center py-10">
        <label className="flex flex-col items-center gap-2 cursor-pointer">
          <Upload className="size-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground text-center">{label}</p>
          <p className="text-xs text-muted-foreground">
            Accepted: {accept.join(", ")}
          </p>
          <input
            type="file"
            accept={accept.join(",")}
            onChange={handleChange}
            className="hidden"
          />
        </label>
      </CardContent>
    </Card>
  )
}
