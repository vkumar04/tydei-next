"use client"

import { useEffect, useRef, useState } from "react"

/**
 * Pure storage helpers (node-testable, no DOM). Tolerate a missing key and
 * corrupt JSON by returning the fallback; never throw on unavailable storage.
 */
export function loadPersisted<T>(
  storage: Pick<Storage, "getItem">,
  key: string,
  fallback: T,
): T {
  try {
    const raw = storage.getItem(key)
    return raw != null ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

export function savePersisted(
  storage: Pick<Storage, "setItem">,
  key: string,
  value: unknown,
): void {
  try {
    storage.setItem(key, JSON.stringify(value))
  } catch {
    // ignore quota / unavailable storage
  }
}

/**
 * useState that persists to localStorage under `key`, so client-only artifacts
 * (e.g. scored proposals on the Analysis › Evaluate Proposals tab) survive
 * navigation and reloads instead of vanishing when you leave the page.
 *
 * SSR-safe: the initial render uses `initial` (no localStorage access during
 * SSR / first paint), then a mount effect hydrates from storage to avoid a
 * hydration mismatch. Writes are JSON; pass JSON-serializable state.
 */
/** Distinguishes "no stored value" from a stored `null`. */
const MISSING = Symbol("persist-missing")

export function usePersistedState<T>(
  key: string,
  initial: T,
): [T, React.Dispatch<React.SetStateAction<T>>] {
  const [state, setState] = useState<T>(initial)
  const firstRender = useRef(true)

  // Hydrate from storage on mount (client only).
  useEffect(() => {
    const stored = loadPersisted<T | typeof MISSING>(
      window.localStorage,
      key,
      MISSING,
    )
    if (stored !== MISSING) setState(stored as T)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  // Persist on change. Skip the mount commit entirely so we never write the
  // `initial` value over stored data before hydration lands (a transient
  // clobber if the component unmounted between the two effect passes).
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false
      return
    }
    savePersisted(window.localStorage, key, state)
  }, [key, state])

  return [state, setState]
}
