"use client"

import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { getCptCodesForFacility } from "@/lib/actions/case-costing/cases-list"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"

/** Charles W1.X-A6 — Comma/whitespace-separated CPT code entry with chip
 *  display. Charles 2026-04-26 (Image #74): CPT options now sourced
 *  live from the facility's Case Costing data via
 *  `getCptCodesForFacility`. Datalist powers native autocomplete; the
 *  available-codes row lets users one-click add codes that already have
 *  case data, instead of guessing what's billed. Free-text entry still
 *  works for codes not yet in the case ledger. */
export function CptCodeList({
  values,
  onChange,
}: {
  values: string[]
  onChange: (next: string[]) => void
}) {
  const [draft, setDraft] = useState("")
  const { data: caseCptCodes } = useQuery({
    queryKey: ["contract-terms", "cpt-options"] as const,
    queryFn: () => getCptCodesForFacility(),
    staleTime: 5 * 60_000,
  })
  const datalistId = "cpt-options-from-cases"
  const suggestions = (caseCptCodes ?? []).filter((c) => !values.includes(c))

  function commit(raw: string) {
    const tokens = raw
      .split(/[\s,]+/)
      .map((t) => t.trim().toUpperCase())
      .filter(Boolean)
    if (tokens.length === 0) return
    const next = [...values]
    for (const t of tokens) if (!next.includes(t)) next.push(t)
    onChange(next)
    setDraft("")
  }
  function addCode(code: string) {
    if (!values.includes(code)) onChange([...values, code])
  }
  return (
    <div className="space-y-2">
      <Input
        list={datalistId}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === ",") {
            e.preventDefault()
            commit(draft)
          }
        }}
        onBlur={() => {
          if (draft.trim()) commit(draft)
        }}
        placeholder={
          suggestions.length > 0
            ? "Pick from Case Costing or type to add"
            : "e.g. 27447, 27130 (Enter to add)"
        }
      />
      <datalist id={datalistId}>
        {(caseCptCodes ?? []).map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>
      {suggestions.length > 0 && (
        <div className="space-y-1">
          <p className="text-[11px] text-muted-foreground">
            From Case Costing
          </p>
          <div className="flex flex-wrap gap-1">
            {suggestions.slice(0, 24).map((code) => (
              <button
                key={code}
                type="button"
                onClick={() => addCode(code)}
                className="rounded border border-dashed px-2 py-0.5 text-xs font-mono text-muted-foreground hover:border-primary hover:text-primary"
              >
                + {code}
              </button>
            ))}
          </div>
        </div>
      )}
      {values.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {values.map((code) => (
            <Badge key={code} variant="secondary" className="pr-1">
              <span className="text-xs font-mono">{code}</span>
              <button
                type="button"
                className="ml-1 rounded hover:bg-accent px-1"
                aria-label={`Remove ${code}`}
                onClick={() => onChange(values.filter((c) => c !== code))}
              >
                ×
              </button>
            </Badge>
          ))}
        </div>
      )}
    </div>
  )
}
