/**
 * Simple in-memory sliding-window rate limiter.
 *
 * No Redis required — uses a Map that automatically evicts expired entries.
 * Good enough for single-instance deployments. Swap to Upstash Redis adapter
 * when horizontal scaling is needed.
 */

interface RateLimitEntry {
  timestamps: number[]
}

const store = new Map<string, RateLimitEntry>()

// Periodically clean up stale entries every 5 minutes
if (typeof globalThis !== "undefined") {
  const CLEANUP_INTERVAL = 5 * 60 * 1000
  const timer = setInterval(() => {
    const now = Date.now()
    for (const [key, entry] of store) {
      // Remove entries whose newest timestamp is older than any reasonable window
      if (entry.timestamps.length === 0 || entry.timestamps[entry.timestamps.length - 1] < now - 10 * 60 * 1000) {
        store.delete(key)
      }
    }
  }, CLEANUP_INTERVAL)
  // Allow Node to exit even if the timer is still running
  if (timer && typeof timer === "object" && "unref" in timer) {
    timer.unref()
  }
}

export function rateLimit(
  identifier: string,
  limit: number,
  windowMs: number
): { success: boolean; remaining: number; retryAfterMs: number } {
  const now = Date.now()
  const windowStart = now - windowMs

  let entry = store.get(identifier)
  if (!entry) {
    entry = { timestamps: [] }
    store.set(identifier, entry)
  }

  // Discard timestamps outside the current window
  entry.timestamps = entry.timestamps.filter((t) => t > windowStart)

  if (entry.timestamps.length >= limit) {
    // Earliest timestamp still in window determines when the caller can retry
    const oldestInWindow = entry.timestamps[0]
    const retryAfterMs = oldestInWindow + windowMs - now

    return {
      success: false,
      remaining: 0,
      retryAfterMs: Math.max(retryAfterMs, 1000),
    }
  }

  entry.timestamps.push(now)

  return {
    success: true,
    remaining: limit - entry.timestamps.length,
    retryAfterMs: 0,
  }
}
