"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
interface ColumnField {
  key: string
  label: string
  required: boolean
}

interface COGColumnMapperProps {
  sourceColumns: string[]
  targetFields: ColumnField[]
  mapping: Record<string, string>
  onChange: (mapping: Record<string, string>) => void
}

export function COGColumnMapper({
  sourceColumns,
  targetFields,
  mapping,
  onChange,
}: COGColumnMapperProps) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Column Mapping</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3 sm:grid-cols-2">
        {targetFields.map((field) => (
          <div key={field.key} className="space-y-1">
            <Label className="text-sm">
              {field.label}
              {field.required && (
                <span className="ml-0.5 text-destructive">*</span>
              )}
            </Label>
            <Select
              value={mapping[field.key] ?? ""}
              onValueChange={(value) =>
                onChange({ ...mapping, [field.key]: value === "__none__" ? "" : value })
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="Select column..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">-- None --</SelectItem>
                {sourceColumns.map((col) => (
                  <SelectItem key={col} value={col}>
                    {col}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}
