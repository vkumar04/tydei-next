/**
 * Charles W1.W-E1 — in-memory idempotency cache.
 *
 * Swap to Redis when horizontal scaling is needed. For single-instance
 * deployments, this is enough to dedupe double-clicks on server actions
 * that aren't covered by the client-side `disabled={mutation.isPending}`
 * (e.g. a form submission that races with an in-flight HMR reload).
 *
 * Usage:
 *   const existing = idempotencyGet<{ contractId: string }>("create-contract", key)
 *   if (existing) return existing
 *   const result = await doWork()
 *   idempotencyPut("create-contract", key, result)
 *
 * Default TTL: 30s — long enough to absorb a double-click, short enough
 * that a user genuinely re-submitting the same form a minute later
 * still goes through.
 */

interface Entry<T> {
  value: T
  expiresAt: number
}

const store = new Map<string, Entry<unknown>>()

// Periodically evict expired entries every 5 minutes so a long-running
// server instance doesn't leak memory. Mirrors `lib/rate-limit.ts`.
if (typeof globalThis !== "undefined") {
  const CLEANUP_INTERVAL = 5 * 60 * 1000
  const timer = setInterval(() => {
    const now = Date.now()
    for (const [k, entry] of store) {
      if (entry.expiresAt <= now) store.delete(k)
    }
  }, CLEANUP_INTERVAL)
  if (timer && typeof timer === "object" && "unref" in timer) {
    timer.unref()
  }
}

function compositeKey(scope: string, key: string): string {
  return `${scope}:${key}`
}

export function idempotencyGet<T>(scope: string, key: string): T | undefined {
  const entry = store.get(compositeKey(scope, key))
  if (!entry) return undefined
  if (entry.expiresAt <= Date.now()) {
    store.delete(compositeKey(scope, key))
    return undefined
  }
  return entry.value as T
}

export function idempotencyPut<T>(
  scope: string,
  key: string,
  value: T,
  ttlMs = 30_000,
): void {
  store.set(compositeKey(scope, key), {
    value,
    expiresAt: Date.now() + ttlMs,
  })
}

/** Test-only helper: drop all cached entries so tests don't leak state. */
export function idempotencyResetForTests(): void {
  store.clear()
}
