"use client"

/**
 * Shared <PricingFileDropzone> — one consistent upload flow for every
 * pricing-shaped file surface (uploader improvements 1+2, 2026-06-13):
 *
 *   file select (button/trigger + drag-drop) → readPricingRows →
 *   resolveMapping(specs) → mapping dialog (auto-detected Selects, the
 *   user can override any column) + 5-row preview → onImport.
 *
 * The dialog ALWAYS shows — when every required field auto-resolves it
 * doubles as the preview/confirm step (green "all columns detected"
 * note); when detection misses, it's the column-mapping fallback that
 * replaces the old dead-end "couldn't find column X" toasts.
 *
 * Telemetry (feature 2): detection misses, manual fixes and abandons
 * are logged fire-and-forget via logUploadHeaderEvent so the canonical
 * alias lists can grow from real-world headers. Fully-clean auto
 * imports are NOT logged (noise).
 */

import {
  useCallback,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type Ref,
} from "react"
import { useImperativeHandle } from "react"
import { toast } from "sonner"
import { Loader2, CheckCircle2, FileSpreadsheet, AlertTriangle } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { readPricingRows } from "./read-tabular-file"
import {
  resolveMapping,
  mappingNeedsAttention,
  type MappingProvenanceMap,
  type ResolvedMapping,
  type UploadFieldSpec,
} from "./field-spec"
import { logUploadHeaderEvent } from "@/lib/actions/upload-telemetry"

/** Radix Select can't carry an empty value — sentinel for "unmapped". */
const NOT_IN_FILE = "__not_in_file__"

export interface PricingFileDropzoneHandle {
  /**
   * Imperative entry for surfaces that keep their own upload visual
   * (e.g. the proposal analyzer's two-card layout) and only need the
   * mapping dialog as a fallback: parses `file` and opens the dialog.
   * Imperative opens ALWAYS log an "auto" telemetry event — the caller
   * only reaches for this after its own happy path failed.
   */
  openWithFile: (file: File) => void
  /** Opens the native file picker (for secondary trigger buttons). */
  openFilePicker: () => void
}

export interface PricingFileDropzoneProps {
  specs: UploadFieldSpec[]
  /** Telemetry surface id, also names the error toasts (e.g. "vendor-benchmarks"). */
  surface: string
  accept?: string
  /**
   * Custom trigger UI. Omit for the default dashed dropzone; pass
   * `null` for a HEADLESS instance driven only via ref.openWithFile
   * (the hidden file input + dialog still render).
   */
  trigger?: ReactNode | null
  /**
   * Import handler. The optional 4th arg `reportProgress(done, total)`
   * (feature 5) lets a chunked importer drive the in-dialog progress bar;
   * surfaces that import in one shot can ignore it.
   */
  onImport: (
    rows: Record<string, string>[],
    mapping: ResolvedMapping,
    meta: { fileName: string; headers: string[] },
    reportProgress: (done: number, total: number) => void,
  ) => Promise<void> | void
  /** Confirm-step copy under the preview (e.g. "N rows parsed, …"). */
  confirmCopy?: (
    rows: Record<string, string>[],
    mapping: ResolvedMapping,
  ) => string
  /**
   * Cross-field validation the per-field `required` flag can't express
   * (e.g. the builder pricing spec's "name OR ref" rule). Returns an
   * error string to show + block Import, or null when valid.
   */
  validate?: (mapping: ResolvedMapping) => string | null
  disabled?: boolean
  /** Default-trigger labels. */
  triggerLabel?: string
  triggerHint?: string
  ref?: Ref<PricingFileDropzoneHandle>
}

interface PendingFile {
  fileName: string
  headers: string[]
  rows: Record<string, string>[]
  /** auto-detected mapping, frozen for telemetry comparison */
  auto: ResolvedMapping
  /**
   * How each field auto-resolved (feature 3). Frozen at parse time so the
   * "best guess" badge reflects the AUTO decision, not the live mapping
   * the user may have since edited. Cleared per-field once the user
   * overrides that field (a user pick is never a "best guess").
   */
  autoProvenance: MappingProvenanceMap
  missingAutoRequired: string[]
  /**
   * Something needs the user's attention before import: a field failed
   * auto-detect, a field resolved only by fuzzy "best guess", or an
   * imperative open. Drives telemetry + the badge surfacing.
   */
  detectionMiss: boolean
}

const PREVIEW_ROWS = 5

export function PricingFileDropzone({
  specs,
  surface,
  accept = ".csv,.txt,.xlsx,.xls",
  trigger,
  onImport,
  confirmCopy,
  validate,
  disabled = false,
  triggerLabel,
  triggerHint,
  ref,
}: PricingFileDropzoneProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [parsing, setParsing] = useState(false)
  const [importing, setImporting] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const [pending, setPending] = useState<PendingFile | null>(null)
  const [mapping, setMapping] = useState<ResolvedMapping>({})
  // Feature 5: live import progress driven by onImport's reportProgress.
  // null = the importer never reported (single-shot import → no bar).
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(
    null,
  )

  // Named toasts (match existing patterns like "Benchmark import: …")
  // without leaking the telemetry surface id verbatim.
  const toastLabel = useMemo(() => surface.replace(/-/g, " "), [surface])

  const allowedExts = useMemo(
    () =>
      accept
        .split(",")
        .map((a) => a.trim().replace(/^\./, "").toLowerCase())
        .filter(Boolean),
    [accept],
  )

  const fireTelemetry = useCallback(
    (input: {
      fileName: string
      headers: string[]
      auto: ResolvedMapping
      // Feature 3: provenance ships with every event so fuzzy "best guess"
      // hits are harvestable back into the canonical alias lists.
      provenance: MappingProvenanceMap
      finalMapping?: ResolvedMapping | null
      missingRequired: string[]
      outcome: "auto" | "manual_fix" | "abandoned"
    }) => {
      // Fire-and-forget; the action itself never throws, the catch is
      // belt-and-suspenders so telemetry can never break an upload.
      void logUploadHeaderEvent({
        surface,
        fileName: input.fileName,
        headers: input.headers,
        autoMapping: input.auto,
        provenance: input.provenance,
        finalMapping: input.finalMapping ?? null,
        missingRequired: input.missingRequired,
        outcome: input.outcome,
      }).catch(() => {})
    },
    [surface],
  )

  const handleFile = useCallback(
    async (file: File, imperative: boolean) => {
      const ext = file.name.split(".").pop()?.toLowerCase() ?? ""
      if (!allowedExts.includes(ext)) {
        toast.error(
          `${toastLabel}: unsupported file type ".${ext}" — expected ${accept}`,
        )
        return
      }
      setParsing(true)
      try {
        const { headers, rows } = await readPricingRows(file)
        if (headers.length === 0 || rows.length === 0) {
          toast.error(
            `${toastLabel}: the file has no data rows — check it has a header row plus at least one data row.`,
          )
          return
        }
        const {
          mapping: auto,
          missingRequired,
          provenance,
        } = resolveMapping(headers, specs)
        // An absent OPTIONAL column is normal, not a detection problem —
        // flag (amber note + "auto" telemetry with provenance) only on an
        // imperative open, a missing REQUIRED field, or a fuzzy "best
        // guess". 2026-06-13: previously flagged on ANY unmapped field,
        // which fired telemetry on nearly every benchmark upload (11-field
        // spec, mostly optional). mappingNeedsAttention owns this rule.
        const detectionMiss = mappingNeedsAttention({
          imperative,
          missingRequired,
          provenance,
        })
        if (detectionMiss) {
          fireTelemetry({
            fileName: file.name,
            headers,
            auto,
            provenance,
            missingRequired,
            outcome: "auto",
          })
        }
        setMapping(auto)
        setPending({
          fileName: file.name,
          headers,
          rows,
          auto,
          autoProvenance: provenance,
          missingAutoRequired: missingRequired,
          detectionMiss,
        })
      } catch (err) {
        toast.error(
          `${toastLabel}: failed to parse the file — ${
            err instanceof Error ? err.message : "unknown error"
          }`,
        )
      } finally {
        setParsing(false)
      }
    },
    [accept, allowedExts, fireTelemetry, specs, toastLabel],
  )

  useImperativeHandle(
    ref,
    () => ({
      openWithFile: (file: File) => {
        void handleFile(file, true)
      },
      openFilePicker: () => inputRef.current?.click(),
    }),
    [handleFile],
  )

  // ── Derived dialog state ────────────────────────────────────────
  const missingRequiredNow = useMemo(
    () => specs.filter((s) => s.required && mapping[s.key] === null),
    [specs, mapping],
  )
  const validateError = useMemo(
    () => (pending ? (validate?.(mapping) ?? null) : null),
    [pending, validate, mapping],
  )
  const userChangedMapping = useMemo(
    () =>
      pending !== null &&
      specs.some((s) => mapping[s.key] !== pending.auto[s.key]),
    [pending, specs, mapping],
  )
  // Feature 3: any field still showing its fuzzy auto-pick (user hasn't
  // overridden it) — drives the "verify the highlighted rows" note.
  const hasFuzzyBestGuess = useMemo(
    () =>
      pending !== null &&
      specs.some(
        (s) =>
          pending.autoProvenance[s.key] === "fuzzy" &&
          mapping[s.key] === pending.auto[s.key],
      ),
    [pending, specs, mapping],
  )
  const headerOptions = useMemo(
    () =>
      pending
        ? Array.from(new Set(pending.headers.filter((h) => h.trim() !== "")))
        : [],
    [pending],
  )
  const mappedSpecs = useMemo(
    () => specs.filter((s) => mapping[s.key] !== null),
    [specs, mapping],
  )
  const confirmText = useMemo(
    () =>
      pending && confirmCopy ? confirmCopy(pending.rows, mapping) : null,
    [pending, confirmCopy, mapping],
  )
  const blocked = missingRequiredNow.length > 0 || validateError !== null

  const closeDiscarding = useCallback(() => {
    if (pending?.detectionMiss) {
      fireTelemetry({
        fileName: pending.fileName,
        headers: pending.headers,
        auto: pending.auto,
        provenance: pending.autoProvenance,
        finalMapping: mapping,
        missingRequired: pending.missingAutoRequired,
        outcome: "abandoned",
      })
    }
    setPending(null)
  }, [pending, mapping, fireTelemetry])

  const handleImport = useCallback(async () => {
    if (!pending || blocked) return
    setImporting(true)
    setProgress(null)
    try {
      if (userChangedMapping) {
        fireTelemetry({
          fileName: pending.fileName,
          headers: pending.headers,
          auto: pending.auto,
          provenance: pending.autoProvenance,
          finalMapping: mapping,
          missingRequired: pending.missingAutoRequired,
          outcome: "manual_fix",
        })
      }
      await onImport(
        pending.rows,
        mapping,
        { fileName: pending.fileName, headers: pending.headers },
        // Feature 5: chunked importers call this after each chunk; the
        // dialog stays open and renders the Progress bar until resolve.
        (done, total) => setProgress({ done, total }),
      )
      // Programmatic close — does NOT route through onOpenChange, so no
      // spurious "abandoned" event after a successful import. Dialog stays
      // open through reject (the catch leaves `pending` set, error toasts).
      setPending(null)
    } catch (err) {
      toast.error(
        `${toastLabel}: import failed — ${
          err instanceof Error ? err.message : "unknown error"
        }`,
      )
    } finally {
      setImporting(false)
      setProgress(null)
    }
  }, [
    pending,
    blocked,
    userChangedMapping,
    fireTelemetry,
    mapping,
    onImport,
    toastLabel,
  ])

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          // Reset so re-selecting the same file fires onChange again.
          e.target.value = ""
          if (file) void handleFile(file, false)
        }}
      />

      {trigger === null ? null : (
        <div
          role="button"
          tabIndex={disabled ? -1 : 0}
          aria-disabled={disabled || parsing}
          onClick={() => {
            if (!disabled && !parsing) inputRef.current?.click()
          }}
          onKeyDown={(e) => {
            if ((e.key === "Enter" || e.key === " ") && !disabled && !parsing) {
              e.preventDefault()
              inputRef.current?.click()
            }
          }}
          onDragOver={(e) => {
            e.preventDefault()
            if (!disabled && !parsing) setIsDragging(true)
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={(e) => {
            e.preventDefault()
            setIsDragging(false)
            if (disabled || parsing) return
            const file = e.dataTransfer.files[0]
            if (file) void handleFile(file, false)
          }}
          className={trigger !== undefined ? "contents" : undefined}
        >
          {trigger !== undefined ? (
            trigger
          ) : (
            <div
              className={`rounded-lg border-2 border-dashed p-6 text-center transition-colors ${
                isDragging
                  ? "border-primary bg-primary/5"
                  : "border-muted-foreground/25 hover:border-primary/50"
              } ${disabled || parsing ? "opacity-60 cursor-wait" : "cursor-pointer"}`}
            >
              {parsing ? (
                <Loader2 className="mx-auto h-6 w-6 animate-spin text-primary" />
              ) : (
                <div className="space-y-1">
                  <FileSpreadsheet className="mx-auto h-6 w-6 text-muted-foreground" />
                  <p className="text-sm font-medium">
                    {triggerLabel ?? "Upload file"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {triggerHint ?? `drop or click to browse (${accept})`}
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <Dialog
        open={pending !== null}
        onOpenChange={(open) => {
          if (!open && !importing) closeDiscarding()
        }}
      >
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Map columns — {pending?.fileName}</DialogTitle>
            <DialogDescription>
              Match each field to a column from your file, then review the
              preview and import.
            </DialogDescription>
          </DialogHeader>

          {pending ? (
            <div className="space-y-4">
              {pending.missingAutoRequired.length === 0 &&
              !pending.detectionMiss ? (
                <p className="flex items-center gap-1.5 text-sm text-green-700 dark:text-green-400">
                  <CheckCircle2 className="h-4 w-4 shrink-0" />
                  All columns detected automatically — review and import.
                </p>
              ) : pending.missingAutoRequired.length === 0 &&
                hasFuzzyBestGuess ? (
                // Feature 3: every required field resolved, but at least one
                // was a fuzzy "best guess" — ask the user to verify the
                // amber-badged rows before importing.
                <p className="flex items-start gap-1.5 text-sm text-amber-700 dark:text-amber-400">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  Some columns were matched by best guess — verify the
                  highlighted rows below before importing.
                </p>
              ) : pending.missingAutoRequired.length === 0 ? (
                <p className="flex items-center gap-1.5 text-sm text-green-700 dark:text-green-400">
                  <CheckCircle2 className="h-4 w-4 shrink-0" />
                  All required columns detected — review the mapping below.
                </p>
              ) : (
                <p className="flex items-start gap-1.5 text-sm text-amber-700 dark:text-amber-400">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  Some columns couldn&rsquo;t be detected automatically — map
                  them below.
                </p>
              )}

              {/* Mapping table */}
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Field</TableHead>
                      <TableHead>Column in your file</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {specs.map((spec) => {
                      const requiredAndMissing =
                        spec.required && mapping[spec.key] === null
                      // Feature 3: amber "best guess" badge when the field
                      // auto-resolved by fuzzy match AND the user hasn't
                      // overridden it (current value still equals the auto
                      // pick). A manual pick is authoritative — no badge.
                      const isFuzzyBestGuess =
                        pending.autoProvenance[spec.key] === "fuzzy" &&
                        mapping[spec.key] === pending.auto[spec.key]
                      return (
                        <TableRow key={spec.key}>
                          <TableCell className="font-medium">
                            {spec.label}
                            {spec.required ? (
                              <span className="text-destructive"> *</span>
                            ) : null}
                            {isFuzzyBestGuess ? (
                              <span className="mt-1 flex w-fit items-center gap-1 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-950 dark:text-amber-400">
                                <AlertTriangle className="h-3 w-3 shrink-0" />
                                Best guess — verify
                              </span>
                            ) : null}
                          </TableCell>
                          <TableCell>
                            <Select
                              value={mapping[spec.key] ?? NOT_IN_FILE}
                              onValueChange={(v) =>
                                setMapping((prev) => ({
                                  ...prev,
                                  [spec.key]: v === NOT_IN_FILE ? null : v,
                                }))
                              }
                            >
                              <SelectTrigger
                                className={`w-full max-w-xs ${
                                  requiredAndMissing
                                    ? "border-destructive text-destructive"
                                    : ""
                                }`}
                              >
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value={NOT_IN_FILE}>
                                  Not in this file
                                </SelectItem>
                                {headerOptions.map((h) => (
                                  <SelectItem key={h} value={h}>
                                    {h}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            {requiredAndMissing ? (
                              <p className="mt-1 text-xs text-destructive">
                                Required — pick the matching column.
                              </p>
                            ) : null}
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </div>

              {validateError ? (
                <p className="flex items-start gap-1.5 text-sm text-destructive">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  {validateError}
                </p>
              ) : null}

              {/* Preview of the first rows, mapped columns only */}
              {mappedSpecs.length > 0 ? (
                <div>
                  <p className="mb-1.5 text-xs font-medium text-muted-foreground">
                    Preview — first {Math.min(PREVIEW_ROWS, pending.rows.length)}{" "}
                    of {pending.rows.length.toLocaleString()} rows
                  </p>
                  <div className="overflow-x-auto rounded-md border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          {mappedSpecs.map((spec) => (
                            <TableHead key={spec.key} className="whitespace-nowrap">
                              <span className="block">{spec.label}</span>
                              <span className="block text-[10px] font-normal text-muted-foreground">
                                {mapping[spec.key]}
                              </span>
                            </TableHead>
                          ))}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {pending.rows.slice(0, PREVIEW_ROWS).map((row, i) => (
                          <TableRow key={i}>
                            {mappedSpecs.map((spec) => (
                              <TableCell
                                key={spec.key}
                                className="max-w-48 truncate whitespace-nowrap text-xs"
                              >
                                {row[mapping[spec.key] ?? ""] ?? ""}
                              </TableCell>
                            ))}
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              ) : null}

              {confirmText ? (
                <p className="text-sm text-muted-foreground">{confirmText}</p>
              ) : null}

              {/* Feature 5: live chunked-import progress. Only renders once
                  the importer has reported (single-shot imports keep the
                  plain "Importing…" button spinner). */}
              {importing && progress ? (
                <div className="space-y-1.5">
                  <Progress
                    value={
                      progress.total > 0
                        ? (progress.done / progress.total) * 100
                        : 0
                    }
                  />
                  <p className="text-xs text-muted-foreground">
                    Importing… {progress.done.toLocaleString()} of{" "}
                    {progress.total.toLocaleString()} rows
                  </p>
                </div>
              ) : null}
            </div>
          ) : null}

          <DialogFooter>
            <Button
              variant="outline"
              disabled={importing}
              onClick={closeDiscarding}
            >
              Cancel
            </Button>
            <Button disabled={blocked || importing} onClick={handleImport}>
              {importing ? (
                <>
                  <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                  Importing…
                </>
              ) : (
                "Import"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
