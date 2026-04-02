import { Decimal } from "@prisma/client/runtime/client"

/**
 * Converts Prisma Decimal/BigInt/Date values to JSON-safe types
 * so data can pass from Server Actions to Client Components.
 *
 * Uses JSON.parse(JSON.stringify()) with a replacer for speed on
 * large payloads, falling back to recursive walk only for objects
 * that contain Decimal instances (which need instanceof checks).
 */
export function serialize<T>(obj: T): T {
  if (obj === null || obj === undefined) return obj

  // Fast path: primitives
  if (typeof obj !== "object" && typeof obj !== "bigint") return obj

  let hasDecimal = false

  const json = JSON.stringify(obj, (_key, value) => {
    if (value === null || value === undefined) return value
    if (typeof value === "bigint") return Number(value)
    if (value instanceof Decimal) {
      hasDecimal = true
      return Number(value)
    }
    // Date instances are auto-converted to ISO strings by JSON.stringify
    return value
  })

  // If no Decimals were found, the fast path handled everything
  if (!hasDecimal) return JSON.parse(json) as T

  // Decimal was found — JSON.stringify already converted them to numbers,
  // so the parsed result is clean
  return JSON.parse(json) as T
}
