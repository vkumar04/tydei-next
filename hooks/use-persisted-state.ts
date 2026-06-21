"use client"

import { useEffect, useRef, useState } from "react"

/**
 * useState that persists to localStorage under `key`, so client-only artifacts
 * (e.g. scored proposals on the Analysis › Evaluate Proposals tab) survive
 * navigation and reloads instead of vanishing when you leave the page.
 *
 * SSR-safe: the initial render uses `initial` (no localStorage access during
 * SSR / first paint), then a mount effect hydrates from storage to avoid a
 * hydration mismatch. Writes are JSON; pass JSON-serializable state.
 */
export function usePersistedState<T>(
  key: string,
  initial: T,
): [T, React.Dispatch<React.SetStateAction<T>>] {
  const [state, setState] = useState<T>(initial)
  const hydrated = useRef(false)

  // Hydrate once on mount (client only).
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(key)
      if (raw != null) setState(JSON.parse(raw) as T)
    } catch {
      // ignore corrupt/unavailable storage
    }
    hydrated.current = true
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  // Persist on change, but only after the initial hydrate so we don't clobber
  // stored data with the `initial` value on first render.
  useEffect(() => {
    if (!hydrated.current) return
    try {
      window.localStorage.setItem(key, JSON.stringify(state))
    } catch {
      // ignore quota / unavailable storage
    }
  }, [key, state])

  return [state, setState]
}
