"use client"

import { useState, useCallback } from "react"

interface ParsedData {
  headers: string[]
  rows: Record<string, string>[]
}

/** Parse a CSV string into headers + rows (all values as strings). */
function parseCsvText(text: string): ParsedData {
  const lines = text.split(/\r?\n/).filter((line) => line.trim() !== "")
  if (lines.length === 0) throw new Error("File contains no data")

  // Simple CSV parsing that handles quoted fields with commas
  function splitCsvLine(line: string): string[] {
    const result: string[] = []
    let current = ""
    let inQuotes = false
    for (let i = 0; i < line.length; i++) {
      const char = line[i]
      if (char === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"'
          i++ // skip escaped quote
        } else {
          inQuotes = !inQuotes
        }
      } else if (char === "," && !inQuotes) {
        result.push(current.trim())
        current = ""
      } else {
        current += char
      }
    }
    result.push(current.trim())
    return result
  }

  const headers = splitCsvLine(lines[0]!)
  if (headers.length === 0 || headers.every((h) => h === ""))
    throw new Error("No headers found in first row")

  const rows: Record<string, string>[] = []
  for (let i = 1; i < lines.length; i++) {
    const values = splitCsvLine(lines[i]!)
    const record: Record<string, string> = {}
    headers.forEach((header, index) => {
      if (!header) return
      record[header] = values[index] ?? ""
    })
    rows.push(record)
  }

  if (rows.length === 0) throw new Error("File contains no data rows")

  return { headers: headers.filter((h) => h !== ""), rows }
}

/** Detect whether a file is CSV by extension or MIME type. */
function isCsvFile(file: File): boolean {
  const ext = file.name.split(".").pop()?.toLowerCase()
  return ext === "csv" || file.type === "text/csv"
}

export function useFileParser() {
  const [data, setData] = useState<ParsedData | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const parseFile = useCallback(async (file: File) => {
    setIsLoading(true)
    setError(null)

    try {
      let parsed: ParsedData

      if (isCsvFile(file)) {
        // CSV: parse client-side (no Node.js dependencies needed)
        const text = await file.text()
        parsed = parseCsvText(text)
      } else {
        // Excel (.xlsx / .xls): send to server-side API route
        const formData = new FormData()
        formData.append("file", file)

        const res = await fetch("/api/parse-file", {
          method: "POST",
          body: formData,
        })

        if (!res.ok) {
          const body = await res.json().catch(() => null)
          throw new Error(
            (body as { error?: string } | null)?.error ?? "Failed to parse file"
          )
        }

        parsed = (await res.json()) as ParsedData
      }

      if (parsed.rows.length === 0) throw new Error("File contains no data rows")

      setData(parsed)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to parse file")
      setData(null)
    } finally {
      setIsLoading(false)
    }
  }, [])

  const reset = useCallback(() => {
    setData(null)
    setError(null)
  }, [])

  return { data, isLoading, error, parseFile, reset }
}
