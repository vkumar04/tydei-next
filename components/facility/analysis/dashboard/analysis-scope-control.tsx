"use client"

/**
 * Facility Analysis dashboard — data-scope control.
 *
 * Lets the CFO choose the COG window the Current State model reads from
 * (preset ranges or a custom date span) and which categories count toward it
 * (choose from the window's categories, or add one that isn't in the data
 * yet — it renders as a zero-spend planning row).
 *
 * Purely presentational: emits the new {@link AnalysisScope} and the parent
 * refetches `getFacilityAnalysisData` with it.
 */

import { useState } from "react"
import { CalendarRange, ChevronDown, Loader2, Plus, Tags } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

export type AnalysisRangePreset = "12m" | "6m" | "3m" | "ytd" | "custom"

export interface AnalysisScope {
  preset: AnalysisRangePreset
  /** yyyy-mm-dd bounds; only read when preset is "custom". */
  start: string
  end: string
  /** Included categories (canonical names). null = all categories. */
  categories: string[] | null
}

export const DEFAULT_ANALYSIS_SCOPE: AnalysisScope = {
  preset: "12m",
  start: "",
  end: "",
  categories: null,
}

const PRESET_LABELS: Record<AnalysisRangePreset, string> = {
  "12m": "Last 12 months",
  "6m": "Last 6 months",
  "3m": "Last 3 months",
  ytd: "Year to date",
  custom: "Custom range",
}

/**
 * Resolve a scope's date bounds to ISO strings for the loader. Returns null
 * when the scope is the default trailing-12 (loader default) or a custom
 * range that isn't fully specified yet.
 */
export function resolveScopeDates(
  scope: AnalysisScope,
): { start: string; end: string } | null {
  const now = new Date()
  if (scope.preset === "custom") {
    if (!scope.start || !scope.end) return null
    // Interpret the picked days in local time, end-inclusive.
    return {
      start: new Date(`${scope.start}T00:00:00`).toISOString(),
      end: new Date(`${scope.end}T23:59:59.999`).toISOString(),
    }
  }
  if (scope.preset === "12m") return null
  if (scope.preset === "ytd") {
    return {
      start: new Date(now.getFullYear(), 0, 1).toISOString(),
      end: now.toISOString(),
    }
  }
  const months = scope.preset === "6m" ? 6 : 3
  const start = new Date(now)
  start.setMonth(start.getMonth() - months)
  return { start: start.toISOString(), end: now.toISOString() }
}

export function describeScopeRange(scope: AnalysisScope): string {
  if (scope.preset !== "custom") return PRESET_LABELS[scope.preset]
  if (!scope.start || !scope.end) return "Custom range"
  const fmt = (iso: string) =>
    new Date(`${iso}T00:00:00`).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    })
  return `${fmt(scope.start)} – ${fmt(scope.end)}`
}

export function AnalysisScopeControl({
  scope,
  onScopeChange,
  availableCategories,
  customCategories,
  onAddCategory,
  disabled = false,
  isLoading = false,
}: {
  scope: AnalysisScope
  onScopeChange: (scope: AnalysisScope) => void
  /** Categories present in the window's COG data (spend-desc). */
  availableCategories: string[]
  /** User-added categories with no COG data (zero-spend planning rows). */
  customCategories: string[]
  onAddCategory: (name: string) => void
  disabled?: boolean
  isLoading?: boolean
}) {
  const [newCategory, setNewCategory] = useState("")

  const allNames = [
    ...availableCategories,
    ...customCategories.filter((c) => !availableCategories.includes(c)),
  ]
  const selected = scope.categories
  const isChecked = (name: string) => selected === null || selected.includes(name)
  const selectedCount = selected === null ? allNames.length : selected.length

  function toggleCategory(name: string) {
    const current = selected === null ? allNames : selected
    const next = current.includes(name)
      ? current.filter((c) => c !== name)
      : [...current, name]
    // Both extremes collapse to null (= no filter): "everything selected"
    // trivially, and "nothing selected" too — the server treats an empty
    // list as unfiltered, so labeling it "0 of N" would lie about the data.
    const isAll =
      next.length >= allNames.length && allNames.every((c) => next.includes(c))
    onScopeChange({ ...scope, categories: isAll || next.length === 0 ? null : next })
  }

  function handleAdd() {
    const name = newCategory.trim()
    if (!name) return
    onAddCategory(name)
    setNewCategory("")
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {isLoading && (
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      )}

      {/* ── Date range ─────────────────────────────────────── */}
      <Select
        value={scope.preset}
        onValueChange={(preset) =>
          onScopeChange({ ...scope, preset: preset as AnalysisRangePreset })
        }
        disabled={disabled}
      >
        <SelectTrigger size="sm" className="w-[168px]">
          <CalendarRange className="h-4 w-4 text-muted-foreground" />
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {(Object.keys(PRESET_LABELS) as AnalysisRangePreset[]).map((p) => (
            <SelectItem key={p} value={p}>
              {PRESET_LABELS[p]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {scope.preset === "custom" && (
        <div className="flex items-center gap-1.5">
          <Input
            type="date"
            aria-label="Range start"
            className="h-8 w-[140px] text-xs"
            value={scope.start}
            max={scope.end || undefined}
            onChange={(e) => onScopeChange({ ...scope, start: e.target.value })}
            disabled={disabled}
          />
          <span className="text-xs text-muted-foreground">to</span>
          <Input
            type="date"
            aria-label="Range end"
            className="h-8 w-[140px] text-xs"
            value={scope.end}
            min={scope.start || undefined}
            onChange={(e) => onScopeChange({ ...scope, end: e.target.value })}
            disabled={disabled}
          />
        </div>
      )}

      {/* ── Categories ─────────────────────────────────────── */}
      <Popover>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            disabled={disabled}
          >
            <Tags className="h-4 w-4" />
            {selected === null
              ? "All categories"
              : `${selectedCount} of ${allNames.length} categories`}
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-72 p-0">
          <div className="max-h-64 space-y-0.5 overflow-y-auto p-2">
            {allNames.length === 0 ? (
              <p className="px-2 py-3 text-sm text-muted-foreground">
                No categories in this window yet.
              </p>
            ) : (
              allNames.map((name) => (
                <label
                  key={name}
                  className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted"
                >
                  <Checkbox
                    checked={isChecked(name)}
                    onCheckedChange={() => toggleCategory(name)}
                  />
                  <span className="min-w-0 flex-1 truncate capitalize">
                    {name}
                  </span>
                  {customCategories.includes(name) &&
                    !availableCategories.includes(name) && (
                      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                        added
                      </span>
                    )}
                </label>
              ))
            )}
          </div>
          <div className="flex items-center gap-1.5 border-t p-2">
            <Input
              placeholder="Add category…"
              className="h-8 text-xs"
              value={newCategory}
              onChange={(e) => setNewCategory(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault()
                  handleAdd()
                }
              }}
            />
            <Button
              size="sm"
              variant="outline"
              className="h-8 px-2"
              onClick={handleAdd}
              disabled={!newCategory.trim()}
            >
              <Plus className="h-4 w-4" />
            </Button>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  )
}
