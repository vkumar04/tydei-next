"use client"

import { useEffect, useState } from "react"

/**
 * Returns a debounced copy of `value` that only updates after `delayMs`
 * milliseconds have passed without the source value changing. Ideal for
 * throttling server queries that are keyed on rapidly-changing form
 * state — the UI keeps rendering the latest value on every keystroke,
 * but network requests only fire when the user stops typing.
 *
 * Note: equality is reference-based (`useState` setter). If `value` is
 * an object rebuilt on every render (e.g. `{ ...form }` literal in the
 * parent), the debounce will still work because the setter skips equal
 * values internally — but for object values, prefer stable references
 * or memoize upstream to avoid the debounce resetting on re-render.
 */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value)

  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delayMs)
    return () => clearTimeout(id)
  }, [value, delayMs])

  return debounced
}
