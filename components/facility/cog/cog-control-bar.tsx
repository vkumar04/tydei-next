"use client"

import {
  CalendarIcon,
  FileStack,
  Plus,
  RefreshCw,
  Trash2,
  Upload,
} from "lucide-react"
import { format, parseISO } from "date-fns"
import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { Separator } from "@/components/ui/separator"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

/**
 * Horizontal control bar for the COG Data page. Consolidates the previous
 * standalone date-range card + header-button stack into one toolbar:
 *
 *   [Date From] [Date To] [Clear] │ [Mass Upload] [Match] [Re-run] [Import] [Add] [Clear All]
 *
 * Destructive "Clear All Data" is demoted to a subtle outline-destructive
 * button on the right so it doesn't dominate the toolbar.
 */
export interface CogControlBarProps {
  dateFrom: string
  onDateFromChange: (next: string) => void
  dateTo: string
  onDateToChange: (next: string) => void

  onMassUpload: () => void
  onMatchPricing: () => void
  matchPending: boolean
  onRerunMatch: () => void
  rerunPending: boolean
  onImport: () => void
  onManualEntry: () => void
  onClearAll: () => void
}

export function CogControlBar({
  dateFrom,
  onDateFromChange,
  dateTo,
  onDateToChange,
  onMassUpload,
  onMatchPricing,
  matchPending,
  onRerunMatch,
  rerunPending,
  onImport,
  onManualEntry,
  onClearAll,
}: CogControlBarProps) {
  const hasDateFilter = Boolean(dateFrom || dateTo)
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-card px-4 py-3 shadow-xs">
      <div className="flex items-center gap-2">
        <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
          Date range
        </span>
        <Popover>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className={cn(
                "w-[140px] justify-start text-left font-normal",
                !dateFrom && "text-muted-foreground",
              )}
            >
              <CalendarIcon className="mr-2 h-4 w-4" />
              {dateFrom ? format(parseISO(dateFrom), "MM/dd/yyyy") : "From"}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <Calendar
              mode="single"
              selected={dateFrom ? parseISO(dateFrom) : undefined}
              onSelect={(date) =>
                onDateFromChange(date ? format(date, "yyyy-MM-dd") : "")
              }
            />
          </PopoverContent>
        </Popover>
        <span className="text-muted-foreground">–</span>
        <Popover>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className={cn(
                "w-[140px] justify-start text-left font-normal",
                !dateTo && "text-muted-foreground",
              )}
            >
              <CalendarIcon className="mr-2 h-4 w-4" />
              {dateTo ? format(parseISO(dateTo), "MM/dd/yyyy") : "To"}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <Calendar
              mode="single"
              selected={dateTo ? parseISO(dateTo) : undefined}
              onSelect={(date) =>
                onDateToChange(date ? format(date, "yyyy-MM-dd") : "")
              }
            />
          </PopoverContent>
        </Popover>
        {hasDateFilter && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              onDateFromChange("")
              onDateToChange("")
            }}
          >
            Clear
          </Button>
        )}
      </div>

      <Separator orientation="vertical" className="hidden h-6 sm:block" />

      <div className="ml-auto flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" onClick={onMassUpload}>
          <FileStack className="mr-2 h-4 w-4" />
          Mass Upload
        </Button>
        {/*
         * Charles 2026-04-24 (Bug 8): "Match" and "Re-run" do different
         * things and were confusing users. Match Pricing resolves vendor
         * NAMES → vendor IDs via the fuzzy resolver FIRST (picks up COG
         * rows where `vendorName = "Stryker Corp"` with no vendorId yet),
         * then recomputes matchStatus. Re-run only recomputes for rows
         * that already have a vendorId on a contracted vendor. Tooltips
         * now spell out the difference so the two buttons aren't
         * read as duplicates.
         */}
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                disabled={matchPending}
                onClick={onMatchPricing}
              >
                <RefreshCw
                  className={cn("mr-2 h-4 w-4", matchPending && "animate-spin")}
                />
                {matchPending ? "Matching..." : "Match Pricing"}
              </Button>
            </TooltipTrigger>
            <TooltipContent className="max-w-[300px] text-xs">
              Resolves vendor names → vendor IDs on unmatched rows, THEN
              recomputes on-contract status. Use this first when new COG
              rows come in.
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                disabled={rerunPending}
                onClick={onRerunMatch}
              >
                <RefreshCw
                  className={cn("mr-2 h-4 w-4", rerunPending && "animate-spin")}
                />
                Re-run match
              </Button>
            </TooltipTrigger>
            <TooltipContent className="max-w-[300px] text-xs">
              Recomputes on-contract / price-variance status for rows that
              already have a vendor ID. Faster than Match Pricing; use
              after you change contract terms or add a new contract.
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
        <Button variant="outline" size="sm" onClick={onImport}>
          <Upload className="mr-2 h-4 w-4" />
          Import
        </Button>
        <Button size="sm" onClick={onManualEntry}>
          <Plus className="mr-2 h-4 w-4" />
          Add Entry
        </Button>
        <Separator orientation="vertical" className="hidden h-6 sm:block" />
        <Button
          variant="outline"
          size="sm"
          onClick={onClearAll}
          className="text-destructive hover:bg-destructive/10 hover:text-destructive"
        >
          <Trash2 className="mr-2 h-4 w-4" />
          Clear All
        </Button>
      </div>
    </div>
  )
}
