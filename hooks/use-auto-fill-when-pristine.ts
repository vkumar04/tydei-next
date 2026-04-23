"use client"

import { useEffect } from "react"
import type {
  FieldValues,
  Path,
  PathValue,
  UseFormReturn,
} from "react-hook-form"

/**
 * Write derived values into RHF fields **only** when the user hasn't
 * manually edited them yet. Prevents the class of bugs where a
 * useEffect(() => form.setValue(...)) stomps user input every time a
 * dependency changes.
 *
 * The guard is RHF's `dirtyFields`: a field becomes dirty only when
 * the user changes it via input, not when we call setValue with the
 * default `shouldDirty: false`. So "dirty === user override" holds
 * for this use case.
 *
 * @param form       The RHF form instance.
 * @param derive     Async producer. Returns partial values keyed by
 *                   field name. Falsy values are skipped.
 * @param deps       Effect deps. Re-runs derive + fill when they change.
 * @param enabled    Optional gate. When false, the effect is a no-op.
 *
 * @example
 *   useAutoFillWhenPristine(
 *     form,
 *     async () => {
 *       const r = await deriveContractTotalFromCOG(vendorId, { ... })
 *       return { totalValue: r.totalValue, annualValue: r.annualValue }
 *     },
 *     [vendorId, effectiveDate, expirationDate],
 *   )
 */
export function useAutoFillWhenPristine<TFormValues extends FieldValues>(
  form: UseFormReturn<TFormValues>,
  derive: () => Promise<Partial<TFormValues>>,
  deps: ReadonlyArray<unknown>,
  enabled: boolean = true,
): void {
  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    ;(async () => {
      let patch: Partial<TFormValues>
      try {
        patch = await derive()
      } catch {
        // Silent — callers own their error surfaces; a failed derive
        // shouldn't block the form.
        return
      }
      if (cancelled) return
      const dirty = form.formState.dirtyFields as Record<string, unknown>
      for (const key of Object.keys(patch) as Array<Path<TFormValues>>) {
        const value = patch[key as keyof typeof patch]
        // Skip fields the user has already touched, plus skip
        // null/undefined/0-ish values so we never overwrite a real
        // user entry with an empty derived result.
        if (dirty[key as string]) continue
        if (value === undefined || value === null) continue
        if (typeof value === "number" && value === 0) continue
        form.setValue(key, value as PathValue<TFormValues, Path<TFormValues>>)
      }
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, ...deps])
}
